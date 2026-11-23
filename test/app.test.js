'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../src/app');
const { Events, Phase, KickReason } = require('../src/constants');
const { seededRng } = require('./helpers/seededRng');

/** Resolves with the next `event` payload matching `predicate`. */
function next(socket, event, predicate = () => true) {
  return new Promise((resolve) => {
    const handler = (payload) => {
      if (predicate(payload)) {
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
  });
}

describe('app (Socket.IO integration)', () => {
  let server;
  let io;
  let room;
  let url;
  const sockets = [];

  /** Connects a client and waits for its first state. */
  const join = async () => {
    const socket = connect(url, { forceNew: true, transports: ['websocket'] });
    sockets.push(socket);
    socket.state = await next(socket, Events.STATE);
    socket.on(Events.STATE, (state) => { socket.state = state; });
    return socket;
  };

  before(async () => {
    ({ server, io, room } = createApp({ rng: seededRng(9), hostKickVotes: 2, oneVotePerIp: false }));
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    sockets.forEach((s) => s.disconnect());
    room.dispose();
    await new Promise((resolve) => io.close(resolve));
  });

  it('serves the client page', async () => {
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<title>Old Maid<\/title>/);
  });

  it('runs the lobby, kicks, votes and a game end to end', async () => {
    const host = await join();
    assert.equal(host.state.you.isHost, true);
    const guest1 = await join();
    const guest2 = await join();
    assert.equal(guest1.state.you.isHost, false);
    assert.equal(guest1.state.host, host.state.you.name);

    // Guests can't use host controls.
    guest1.emit(Events.START_GAME);
    assert.equal((await next(guest1, Events.ERROR)).code, 'not-host');

    // Host changes settings; everyone sees them.
    host.emit(Events.UPDATE_SETTINGS, { cardsPerPlayer: 6 });
    await next(guest2, Events.STATE, (s) => s.settings.cardsPerPlayer === 6);

    // Host kicks a guest, who is told why.
    const guest3 = await join();
    const kickedNotice = next(guest3, Events.KICKED);
    host.emit(Events.KICK_PLAYER, guest3.state.you.id);
    assert.deepEqual(await kickedNotice, { reason: KickReason.HOST });

    // Start: everyone is dealt in and someone has the turn.
    host.emit(Events.START_GAME);
    const playing = await next(guest1, Events.STATE, (s) => s.phase === Phase.PLAYING);
    assert.equal(playing.game.seats.length, 3);
    assert.equal(playing.game.drawPile.count, 51 - 18);

    // Whoever's turn it is draws from the pile.
    const players = [host, guest1, guest2];
    await Promise.all(players.map((s) => (s.state.phase === Phase.PLAYING
      ? null : next(s, Events.STATE, (st) => st.phase === Phase.PLAYING))));
    const current = players.find((s) => s.state.game.isYourTurn);
    current.emit(Events.DRAW_FROM_PILE);
    await next(current, Events.STATE, (s) => s.game.drawPile.count === 51 - 18 - 1);

    // Guests vote out the host (threshold 2 in this test); the game carries on.
    const hostKicked = next(host, Events.KICKED);
    const newHostState = next(guest1, Events.STATE, (s) => s.you.isHost);
    guest1.emit(Events.VOTE_KICK_HOST);
    await next(guest2, Events.STATE, (s) => s.hostVote.votes === 1);
    guest2.emit(Events.VOTE_KICK_HOST);
    assert.deepEqual(await hostKicked, { reason: KickReason.VOTE });
    const after = await newHostState;
    assert.equal(after.phase, Phase.PLAYING);
    assert.equal(after.game.seats.length, 2);
    assert.equal(room.members.size, 2);
  });

  it('rejects malformed input without crashing', async () => {
    const socket = await join();
    socket.emit(Events.UPDATE_SETTINGS, null);
    assert.ok((await next(socket, Events.ERROR)).message);
    socket.emit(Events.DRAW_FROM_PLAYER, { evil: true });
    assert.ok((await next(socket, Events.ERROR)).message);
  });
});

describe('app security', () => {
  let server;
  let io;
  let room;
  let url;
  const sockets = [];
  const connectWith = (options = {}) => {
    const socket = connect(url, { forceNew: true, transports: ['websocket'], reconnection: false, ...options });
    sockets.push(socket);
    return socket;
  };

  before(async () => {
    ({ server, io, room } = createApp({ maxConnectionsPerIp: 2 }));
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    sockets.forEach((s) => s.disconnect());
    room.dispose();
    await new Promise((resolve) => io.close(resolve));
  });

  it('sends security headers', async () => {
    const res = await fetch(url);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('refuses connections opened by another website', async () => {
    const socket = connectWith({ extraHeaders: { Origin: 'https://evil.example' } });
    const error = await new Promise((resolve) => socket.on('connect_error', resolve));
    assert.ok(error);
    assert.equal(room.members.size, 0);
  });

  it('accepts connections from its own origin', async () => {
    const socket = connectWith({ extraHeaders: { Origin: url } });
    await next(socket, Events.STATE);
    socket.disconnect();
  });

  it('limits connections per address', async () => {
    await until(() => room.members.size === 0);
    const first = connectWith();
    const second = connectWith();
    await Promise.all([next(first, Events.STATE), next(second, Events.STATE)]);
    const third = connectWith();
    assert.deepEqual(await next(third, Events.KICKED), { reason: KickReason.TOO_MANY_CONNECTIONS });
    assert.equal(room.members.size, 2);
  });

  it('rate-limits a client that floods messages', async () => {
    const socket = sockets.find((s) => s.connected);
    const limited = next(socket, Events.ERROR, (e) => e.code === 'rate-limited');
    for (let i = 0; i < 50; i += 1) socket.emit(Events.DRAW_FROM_PILE);
    assert.equal((await limited).code, 'rate-limited');
  });
});

/** Polls until `condition` is true. */
async function until(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
