'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const { Room } = require('./room/Room');
const { ActionError } = require('./errors');
const { Events, KickReason } = require('./constants');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

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
});

/**
 * Creates the HTTP + Socket.IO server without starting it.
 * @param {object} [options]
 * @param {number} [options.turnTimeoutMs]
 * @param {number} [options.hostKickVotes]
 * @param {number} [options.idleTimeoutMs] - disconnect a client that reports no activity for this long
 * @param {number} [options.idleCheckMs] - how often to look for idle clients
 * @param {import('./random').Rng} [options.rng]
 * @returns {{ server: http.Server, io: Server, room: Room }}
 */
function createApp({
  turnTimeoutMs,
  hostKickVotes,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  idleCheckMs = Math.min(30 * 1000, idleTimeoutMs),
  rng,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(PUBLIC_DIR));

  const server = http.createServer(app);
  const io = new Server(server);

  /** Tells a removed client why, then disconnects it. */
  const disconnect = (id, reason) => {
    const socket = io.sockets.sockets.get(id);
    if (!socket) return;
    socket.emit(Events.KICKED, { reason });
    socket.disconnect(true);
  };

  const room = new Room({
    turnTimeoutMs,
    hostKickVotes,
    rng,
    onKick: disconnect,
    onChange: () => {
      for (const id of room.memberIds) io.to(id).emit(Events.STATE, room.stateFor(id));
    },
  });

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
    markActive(socket);
    room.join(socket.id, socket.handshake.auth?.name);
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

    socket.on('disconnect', () => {
      lastActive.delete(socket.id);
      room.leave(socket.id);
    });
  });

  server.on('close', () => {
    clearInterval(idleSweep);
    room.dispose();
  });

  return { server, io, room };
}

module.exports = { createApp };
