'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../src/app');
const { Events, Phase, KickReason } = require('../src/constants');
const { GameType } = require('../src/game/GameSettings');
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
    assert.match(await res.text(), /<title>Cards<\/title>/);
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

describe('app (Pusoy Dos)', () => {
  let server;
  let io;
  let room;
  let url;
  const sockets = [];
  const join = async () => {
    const socket = connect(url, { forceNew: true, transports: ['websocket'] });
    sockets.push(socket);
    socket.state = await next(socket, Events.STATE);
    socket.on(Events.STATE, (state) => { socket.state = state; });
    return socket;
  };

  before(async () => {
    ({ server, io, room } = createApp({ rng: seededRng(4) }));
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    sockets.forEach((s) => s.disconnect());
    room.dispose();
    await new Promise((resolve) => io.close(resolve));
  });

  it('plays Pusoy Dos over the socket', async () => {
    const host = await join();
    const guest = await join();
    const hostSocket = host;
    hostSocket.emit(Events.UPDATE_SETTINGS, { game: 'pusoy-dos' });
    await next(hostSocket, Events.STATE, (s) => s.settings.game === 'pusoy-dos');
    hostSocket.emit(Events.START_GAME);
    await Promise.all([host, guest].map((s) => (s.state.game?.type === 'pusoy-dos' && s.state.phase === Phase.PLAYING
      ? null : next(s, Events.STATE, (st) => st.game?.type === 'pusoy-dos'))));
    const leader = [host, guest].find((s) => s.state.game.isYourTurn);
    const other = [host, guest].find((s) => s !== leader);
    const opening = leader.state.game.mustInclude;
    assert.ok(opening);

    other.emit(Events.PLAY_CARDS, [opening.id]);
    assert.equal((await next(other, Events.ERROR)).code, 'not-your-turn');
    leader.emit(Events.PLAY_CARDS, [opening.id]);
    const seen = await next(other, Events.STATE, (s) => s.game.table !== null);
    assert.deepEqual(seen.game.table.cards, [opening]);
    assert.equal(seen.game.canPass, true);
    other.emit(Events.PASS);
    await next(leader, Events.STATE, (s) => s.game.isYourTurn && s.game.table === null);
  });
});

describe('app (Go Fish over Socket.IO)', () => {
  let server;
  let io;
  let room;
  let url;
  const sockets = [];

  before(async () => {
    ({ server, io, room } = createApp({ rng: seededRng(5) }));
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    sockets.forEach((s) => s.disconnect());
    room.dispose();
    await new Promise((resolve) => io.close(resolve));
  });

  it('lets the host pick Go Fish and players ask each other', async () => {
    const players = [];
    for (let i = 0; i < 2; i += 1) {
      const socket = connect(url, { forceNew: true, transports: ['websocket'] });
      sockets.push(socket);
      socket.on(Events.STATE, (state) => { socket.state = state; });
      await next(socket, Events.STATE);
      players.push(socket);
    }
    const [host, guest] = players;
    host.emit(Events.UPDATE_SETTINGS, { game: 'go-fish' });
    await next(guest, Events.STATE, (s) => s.settings.game === 'go-fish');

    const started = players.map((s) => next(s, Events.STATE, (st) => st.phase === Phase.PLAYING));
    host.emit(Events.START_GAME);
    await Promise.all(started);
    assert.equal(guest.state.game.type, 'go-fish');
    assert.equal(guest.state.game.drawPile.count, 52 - 14);

    const current = players.find((s) => s.state.game.isYourTurn);
    const other = players.find((s) => s !== current);
    // Wrong game's move, then a malformed ask: errors, no crash.
    current.emit(Events.DRAW_FROM_PILE);
    assert.equal((await next(current, Events.ERROR)).code, 'wrong-game');
    current.emit(Events.ASK, { seat: 'x' });
    assert.equal((await next(current, Events.ERROR)).code, 'invalid-target');

    const { game } = current.state;
    const target = game.seats.find((seat) => seat.isTarget);
    const asked = next(other, Events.STATE, (s) => s.game.log.some((line) => line.includes(' asked ')));
    current.emit(Events.ASK, { seat: target.seat, rank: game.askableRanks[0] });
    await asked;
  });
});

describe('app (Mafia over Socket.IO)', () => {
  let server;
  let io;
  let room;
  let url;
  const sockets = [];

  const join = async () => {
    const socket = connect(url, { forceNew: true, transports: ['websocket'] });
    sockets.push(socket);
    socket.state = await next(socket, Events.STATE);
    socket.on(Events.STATE, (state) => { socket.state = state; });
    return socket;
  };

  before(async () => {
    ({ server, io, room } = createApp({ rng: seededRng(3) }));
    await new Promise((resolve) => server.listen(0, resolve));
    url = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    sockets.forEach((s) => s.disconnect());
    room.dispose();
    await new Promise((resolve) => io.close(resolve));
  });

  it('deals secret roles and plays a night through to the day vote', async () => {
    const players = [];
    for (let i = 0; i < 5; i += 1) players.push(await join());
    const [host] = players;
    host.emit(Events.UPDATE_SETTINGS, { game: GameType.MAFIA });
    await next(host, Events.STATE, (s) => s.settings.game === GameType.MAFIA);
    host.emit(Events.START_GAME);
    await Promise.all(players.map((p) => (p.state.phase === Phase.PLAYING
      ? null : next(p, Events.STATE, (s) => s.phase === Phase.PLAYING))));

    // Everyone knows their own role, and only one Mafia member means nobody knows anyone else's.
    for (const p of players) {
      assert.equal(p.state.game.type, GameType.MAFIA);
      assert.ok(p.state.game.you.role);
      assert.equal(p.state.game.seats.filter((seat) => seat.role).length, 1);
    }

    // Everyone picks; the night ends and the day begins.
    const daybreak = Promise.all(players.map((p) => next(p, Events.STATE, (s) => s.game.stage !== 'night')));
    for (const p of players) p.emit(Events.NIGHT_PICK, p.state.game.night.choices[0]);
    const [day] = await daybreak;
    assert.equal(day.game.stage, 'day');
    assert.ok(day.game.headline);

    // A living player votes for nobody; everyone sees it.
    const voter = players.find((p) => p.state.game.day.canVote);
    const tallied = next(host, Events.STATE, (s) => s.game.day?.nobodyVotes === 1);
    voter.emit(Events.DAY_VOTE, null);
    await tallied;

    // Old Maid moves are refused.
    voter.emit(Events.DRAW_FROM_PILE);
    assert.equal((await next(voter, Events.ERROR)).code, 'wrong-game');
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
