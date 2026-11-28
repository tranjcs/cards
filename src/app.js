'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const { Room } = require('./room/Room');
const { ActionError } = require('./errors');
const { Events, KickReason } = require('./constants');
const { RateLimiter } = require('./net/RateLimiter');
const { ConnectionLimiter } = require('./net/ConnectionLimiter');
const { clientAddress, isSameOrigin, securityHeaders } = require('./net/requests');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60 * 1000;
// Client messages are tiny (a number, a few card ids or a small object); refuse anything bigger.
const MAX_MESSAGE_BYTES = 4 * 1024;
const RATE_LIMIT = Object.freeze({ capacity: 20, perSecond: 5 });

/**
 * Client events and the Room method each one calls. Every handler receives the
 * sender's connection id and the (untrusted) payload.
 * @type {Record<string, (room: Room, id: string, payload: unknown) => void>}
 */
const ACTIONS = Object.freeze({
  [Events.UPDATE_SETTINGS]: (room, id, settings) => room.updateSettings(id, settings),
  [Events.START_GAME]: (room, id) => room.startGame(id),
  [Events.END_GAME]: (room, id) => room.endGame(id),
  [Events.KICK_PLAYER]: (room, id, publicId) => room.kick(id, publicId),
  [Events.VOTE_KICK_HOST]: (room, id) => room.voteKickHost(id),
  [Events.DRAW_FROM_PLAYER]: (room, id, index) => room.drawFromPlayer(id, index),
  [Events.DRAW_FROM_PILE]: (room, id) => room.drawFromPile(id),
  [Events.PLAY_CARDS]: (room, id, cardIds) => room.playCards(id, cardIds),
  [Events.PASS]: (room, id) => room.pass(id),
  [Events.ASK]: (room, id, request) => room.ask(id, request),
  [Events.GO_FISH]: (room, id) => room.goFish(id),
});

/** Room.join refusals that end the connection, and the reason the client is shown. */
const JOIN_REFUSALS = Object.freeze({
  banned: KickReason.BANNED,
  'room-full': KickReason.ROOM_FULL,
});

/**
 * Creates the HTTP + Socket.IO server without starting it.
 * @param {object} [options]
 * @param {number} [options.turnTimeoutMs]
 * @param {number} [options.hostKickVotes]
 * @param {number} [options.maxRoomSize]
 * @param {number} [options.maxConnectionsPerIp] - 0 for unlimited
 * @param {number} [options.kickBanMs]
 * @param {boolean} [options.oneVotePerIp]
 * @param {number} [options.trustedProxyHops] - proxies in front that append to X-Forwarded-For
 * @param {number} [options.idleTimeoutMs] - disconnect a client that reports no activity for this long
 * @param {number} [options.idleCheckMs] - how often to look for idle clients
 * @param {import('./random').Rng} [options.rng]
 * @returns {{ server: http.Server, io: Server, room: Room }}
 */
function createApp({
  turnTimeoutMs,
  hostKickVotes,
  maxRoomSize,
  maxConnectionsPerIp = 0,
  kickBanMs,
  oneVotePerIp,
  trustedProxyHops = 0,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  idleCheckMs = Math.min(30 * 1000, idleTimeoutMs),
  rng,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.static(PUBLIC_DIR));

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    // Refuse connections opened by other websites from their visitors' browsers.
    allowRequest: (req, callback) => callback(null, isSameOrigin(req)),
  });

  /** Tells a client why it's being removed, then disconnects it. */
  const disconnect = (socketOrId, reason) => {
    const socket = typeof socketOrId === 'string' ? io.sockets.sockets.get(socketOrId) : socketOrId;
    if (!socket) return;
    socket.emit(Events.KICKED, { reason });
    socket.disconnect(true);
  };

  const room = new Room({
    turnTimeoutMs,
    hostKickVotes,
    maxMembers: maxRoomSize,
    kickBanMs,
    oneVotePerAddress: oneVotePerIp,
    rng,
    onKick: disconnect,
    onChange: () => {
      for (const id of room.memberIds) io.to(id).emit(Events.STATE, room.stateFor(id));
    },
  });

  const connections = new ConnectionLimiter(maxConnectionsPerIp);

  /** @type {Map<string, number>} socket id -> Date.now() of the last sign of activity */
  const lastActive = new Map();
  const markActive = (socket) => lastActive.set(socket.id, Date.now());

  const idleSweep = setInterval(() => {
    const cutoff = Date.now() - idleTimeoutMs;
    for (const [id, at] of lastActive) {
      if (at <= cutoff) disconnect(id, KickReason.IDLE);
    }
  }, idleCheckMs);
  idleSweep.unref();

  io.on('connection', (socket) => {
    const address = clientAddress(socket.request, trustedProxyHops);
    if (!connections.tryAcquire(address)) {
      disconnect(socket, KickReason.TOO_MANY_CONNECTIONS);
      return;
    }
    socket.on('disconnect', () => {
      connections.release(address);
      lastActive.delete(socket.id);
      room.leave(socket.id);
    });

    try {
      room.join(socket.id, socket.handshake.auth?.name, address);
    } catch (error) {
      const reason = error instanceof ActionError ? JOIN_REFUSALS[error.code] : undefined;
      if (!reason) throw error;
      disconnect(socket, reason);
      return;
    }
    markActive(socket);

    const limiter = new RateLimiter(RATE_LIMIT);
    socket.use((_packet, next) => {
      if (limiter.tryConsume()) return next();
      socket.emit(Events.ERROR, { code: 'rate-limited', message: 'Slow down a little.' });
      return undefined; // drop the message
    });

    socket.on(Events.ACTIVE, () => markActive(socket));
    for (const [event, action] of Object.entries(ACTIONS)) {
      socket.on(event, (payload) => {
        markActive(socket);
        try {
          action(room, socket.id, payload);
        } catch (error) {
          if (error instanceof ActionError) {
            socket.emit(Events.ERROR, { code: error.code, message: error.message });
          } else {
            // A bug, not bad input: log it, but don't let one client crash the server.
            console.error(`Error handling "${event}":`, error);
            socket.emit(Events.ERROR, { code: 'internal', message: 'Something went wrong.' });
          }
        }
      });
    }
  });

  server.on('close', () => {
    clearInterval(idleSweep);
    room.dispose();
  });

  return { server, io, room };
}

module.exports = { createApp };
