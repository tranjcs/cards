'use strict';

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../src/room/Room');
const { Phase, KickReason } = require('../src/constants');
const { ActionError } = require('../src/errors');
const { seededRng } = require('./helpers/seededRng');

describe('Room', () => {
  let room;
  let changes;
  let kicked;

  const create = (options = {}) => {
    changes = 0;
    kicked = [];
    room = new Room({
      onChange: () => { changes += 1; },
      onKick: (id, reason) => kicked.push({ id, reason }),
      rng: seededRng(42),
      ...options,
    });
    return room;
  };
  const joinAll = (...ids) => ids.forEach((id) => room.join(id));
  const publicIdOf = (id) => room.members.get(id).publicId;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    create();
  });

  afterEach(() => {
    room.dispose();
    mock.timers.reset();
  });

  describe('joining', () => {
    it('makes the first person the host and everyone else a guest', () => {
      joinAll('a', 'b', 'c');
      assert.equal(room.hostId, 'a');
      assert.equal(room.stateFor('a').you.isHost, true);
      assert.equal(room.stateFor('b').you.isHost, false);
      assert.equal(room.stateFor('b').host, 'Player 1');
      assert.equal(room.phase, Phase.LOBBY);
      assert.equal(changes, 3);
    });

    it('gives unique names and lets a reconnecting player reclaim theirs', () => {
      room.join('a');
      room.join('b', 'Player 7');
      room.join('c', 'Player 7'); // taken
      room.join('d', '<script>'); // not a server-issued name
      assert.deepEqual(room.stateFor('a').members.map((m) => m.name), ['Player 1', 'Player 7', 'Player 8', 'Player 9']);
    });

    it('ignores a second join from the same connection', () => {
      room.join('a');
      room.join('a');
      assert.equal(room.members.size, 1);
    });

    it('hands the host role to the longest-connected guest when the host leaves', () => {
      joinAll('a', 'b', 'c');
      room.leave('a');
      assert.equal(room.hostId, 'b');
      room.leave('b');
      room.leave('c');
      assert.equal(room.hostId, null);
      room.join('d');
      assert.equal(room.hostId, 'd');
    });

    it('does not reveal connection ids to other clients', () => {
      joinAll('secret-a', 'secret-b');
      assert.equal(JSON.stringify(room.stateFor('secret-b')).includes('secret-a'), false);
    });
  });

  describe('host controls', () => {
    beforeEach(() => joinAll('a', 'b', 'c'));

    it('lets only the host change settings', () => {
      room.updateSettings('a', { cardsPerPlayer: 5 });
      assert.equal(room.stateFor('b').settings.cardsPerPlayer, 5);
      assert.equal(room.stateFor('b').settings.maxCardsPerPlayer, 17);
      assert.throws(() => room.updateSettings('b', { cardsPerPlayer: 3 }), { code: 'not-host' });
      assert.throws(() => room.updateSettings('a', { cardsPerPlayer: 99 }), { code: 'invalid-settings' });
    });

    it('lets only the host start the game, with at least two players', () => {
      assert.throws(() => room.startGame('b'), { code: 'not-host' });
      room.startGame('a');
      assert.equal(room.phase, Phase.PLAYING);
      assert.deepEqual(room.game.playerIds, ['a', 'b', 'c']);
      assert.throws(() => room.startGame('a'), { code: 'game-running' });
      assert.throws(() => room.updateSettings('a', { cardsPerPlayer: 3 }), { code: 'game-running' });
    });

    it('refuses to start alone', () => {
      create();
      room.join('a');
      assert.equal(room.stateFor('a').canStart, false);
      assert.throws(() => room.startGame('a'), ActionError);
    });

    it('deals the chosen number of cards', () => {
      room.updateSettings('a', { cardsPerPlayer: 4 });
      room.startGame('a');
      assert.equal(room.game.drawPile.size, 51 - 12);
    });

    it('can kick a guest, who is removed and disconnected', () => {
      room.kick('a', publicIdOf('b'));
      assert.equal(room.members.has('b'), false);
      assert.deepEqual(kicked, [{ id: 'b', reason: KickReason.HOST }]);
    });

    it('rejects kicks by guests, of yourself, or of unknown players', () => {
      assert.throws(() => room.kick('b', publicIdOf('c')), { code: 'not-host' });
      assert.throws(() => room.kick('a', publicIdOf('a')), { code: 'kick-self' });
      assert.throws(() => room.kick('a', 'p999'), { code: 'no-such-player' });
      assert.deepEqual(kicked, []);
    });

    it('can kick a player mid-game; their cards go to the next player', () => {
      room.startGame('a');
      room.kick('a', publicIdOf('b'));
      const { game } = room;
      assert.equal(game.isSeated('b'), false);
      const held = game.playerIds.reduce((sum, id) => sum + game.handOf(id).size, 0);
      assert.equal(held + game.drawPile.size + game.discardPile.size, 51); // no cards lost
    });

    it('can end a game and start another', () => {
      room.startGame('a');
      room.endGame('a');
      assert.equal(room.phase, Phase.LOBBY);
      assert.throws(() => room.endGame('a'), { code: 'no-game' });
      room.startGame('a');
      assert.equal(room.phase, Phase.PLAYING);
    });
  });

  describe('Go Fish', () => {
    beforeEach(() => {
      joinAll('a', 'b', 'c');
      room.updateSettings('a', { game: 'go-fish' });
    });

    it('starts Go Fish when the host picks it', () => {
      assert.equal(room.stateFor('b').settings.game, 'go-fish');
      room.startGame('a');
      assert.equal(room.stateFor('b').game.type, 'go-fish');
      assert.equal(room.game.drawPile.size, 52 - 21);
    });

    it("plays asks through the room and refuses Old Maid moves", () => {
      room.startGame('a');
      const id = room.game.currentPlayerId;
      assert.throws(() => room.drawFromPile(id), { code: 'wrong-game' });
      const target = room.game.targetsFor(id)[0];
      const rank = room.game.handOf(id).ranks[0];
      const before = room.game.turnCount;
      room.ask(id, { seat: room.game.playerIds.indexOf(target), rank });
      assert.equal(room.game.turnCount, before + 1);
    });

    it('times out turns and finishes', () => {
      room.startGame('a');
      while (!room.game.isOver) mock.timers.tick(room.turnTimeoutMs);
      assert.equal(room.phase, Phase.FINISHED);
      assert.ok(room.stateFor('a').game.result.winners.length >= 1);
    });

    it("refuses Go Fish moves in Old Maid", () => {
      room.updateSettings('a', { game: 'old-maid' });
      room.startGame('a');
      assert.throws(() => room.goFish(room.game.currentPlayerId), { code: 'wrong-game' });
    });
  });

  describe('limits', () => {
    it('refuses to join beyond capacity', () => {
      create({ maxMembers: 2 });
      joinAll('a', 'b');
      assert.throws(() => room.join('c'), { code: 'room-full' });
      room.leave('b');
      room.join('c');
    });

    it('bans a kicked player\'s address for a while', () => {
      create({ kickBanMs: 60000 });
      room.join('a', null, '1.1.1.1');
      room.join('b', null, '2.2.2.2');
      room.kick('a', publicIdOf('b'));
      assert.throws(() => room.join('b2', null, '2.2.2.2'), { code: 'banned' });
      room.join('c', null, '3.3.3.3'); // others unaffected
      mock.timers.tick(60000);
      room.join('b3', null, '2.2.2.2');
      assert.equal(room.members.has('b3'), true);
    });

    it('does not ban an address the host shares', () => {
      room.join('a', null, '1.1.1.1');
      room.join('b', null, '1.1.1.1');
      room.kick('a', publicIdOf('b'));
      room.join('b2', null, '1.1.1.1');
      assert.equal(room.members.has('b2'), true);
    });

    it('does not ban when the ban is turned off', () => {
      create({ kickBanMs: 0 });
      room.join('a', null, '1.1.1.1');
      room.join('b', null, '2.2.2.2');
      room.kick('a', publicIdOf('b'));
      room.join('b2', null, '2.2.2.2');
    });
  });

  describe('voting to kick the host', () => {
    it('counts one vote per address, so extra tabs do not help', () => {
      create({ hostKickVotes: 2 });
      room.join('h', null, '1.1.1.1');
      room.join('g1', null, '2.2.2.2');
      room.join('g1-tab2', null, '2.2.2.2');
      room.voteKickHost('g1');
      room.voteKickHost('g1-tab2');
      assert.equal(room.hostId, 'h');
      assert.equal(room.stateFor('g1').hostVote.votes, 1);
      room.join('g2', null, '3.3.3.3');
      room.voteKickHost('g2');
      assert.equal(room.hostId, 'g1');
    });

    it('needs at least 5 votes by default', () => {
      joinAll('h', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6');
      for (const id of ['g1', 'g2', 'g3', 'g4']) room.voteKickHost(id);
      assert.equal(room.hostId, 'h');
      assert.deepEqual(room.stateFor('g1').hostVote, { votes: 4, needed: 5, youVoted: true });
      room.voteKickHost('g5');
      assert.equal(room.members.has('h'), false);
      assert.deepEqual(kicked, [{ id: 'h', reason: KickReason.VOTE }]);
      assert.equal(room.hostId, 'g1');
      assert.equal(room.stateFor('g1').hostVote.votes, 0); // votes reset for the new host
    });

    it('lets a guest withdraw their vote', () => {
      joinAll('h', 'g1');
      room.voteKickHost('g1');
      room.voteKickHost('g1');
      assert.equal(room.stateFor('g1').hostVote.votes, 0);
    });

    it('drops the vote of a guest who leaves', () => {
      joinAll('h', 'g1', 'g2');
      room.voteKickHost('g1');
      room.leave('g1');
      assert.equal(room.stateFor('g2').hostVote.votes, 0);
    });

    it('does not let the host vote', () => {
      joinAll('h', 'g1');
      assert.throws(() => room.voteKickHost('h'), { code: 'host-vote' });
    });

    it('uses a configurable threshold', () => {
      create({ hostKickVotes: 2 });
      joinAll('h', 'g1', 'g2');
      room.voteKickHost('g1');
      room.voteKickHost('g2');
      assert.equal(room.hostId, 'g1');
    });

    it('keeps the game going after the host is voted out mid-game', () => {
      create({ hostKickVotes: 1 });
      joinAll('h', 'g1', 'g2');
      room.startGame('h');
      room.voteKickHost('g1');
      assert.equal(room.phase, Phase.PLAYING);
      assert.deepEqual(room.game.playerIds, ['g1', 'g2']);
    });
  });

  describe('playing', () => {
    beforeEach(() => {
      joinAll('a', 'b', 'c');
      room.startGame('a');
    });

    it('passes moves to the game and rejects moves out of turn', () => {
      const current = room.game.currentPlayerId;
      const other = ['a', 'b', 'c'].find((id) => id !== current);
      assert.throws(() => room.drawFromPlayer(other, 0), { code: 'not-your-turn' });
      room.drawFromPlayer(current, 0);
      assert.equal(room.game.turnCount, 1);
    });

    it('seats only people present at the start; later arrivals watch', () => {
      room.join('d');
      const state = room.stateFor('d');
      assert.equal(state.game.isPlaying, false);
      assert.equal(state.members.find((m) => m.isYou).inGame, false);
    });

    it('plays a random card for a player who runs out of time', () => {
      const first = room.game.currentPlayerId;
      assert.ok(room.stateFor('a').game.turnRemainingMs > 0);
      mock.timers.tick(room.turnTimeoutMs);
      assert.equal(room.game.turnCount, 1);
      assert.notEqual(room.game.currentPlayerId, first);
    });

    it('restarts the countdown on every turn', () => {
      mock.timers.tick(room.turnTimeoutMs - 1000);
      room.drawFromPlayer(room.game.currentPlayerId, 0);
      assert.equal(room.stateFor('a').game.turnRemainingMs, room.turnTimeoutMs);
    });

    it('finishes, and the host can start a rematch', () => {
      while (!room.game.isOver) mock.timers.tick(room.turnTimeoutMs);
      assert.equal(room.phase, Phase.FINISHED);
      assert.ok(room.stateFor('a').game.result.loser);
      assert.equal(room.stateFor('a').canStart, true);
      room.startGame('a');
      assert.equal(room.phase, Phase.PLAYING);
    });

    it('still names a player who left in the game log', () => {
      room.leave('b');
      const log = room.stateFor('a').game.log.join('\n');
      assert.match(log, /Player 2 left/);
    });

    it('returns to the lobby when everyone leaves', () => {
      ['a', 'b', 'c'].forEach((id) => room.leave(id));
      assert.equal(room.phase, Phase.LOBBY);
    });
  });

  describe('choosing a game', () => {
    beforeEach(() => joinAll('a', 'b', 'c', 'd', 'e'));

    it('offers Old Maid, Pusoy Dos and Go Fish, with Old Maid by default', () => {
      const state = room.stateFor('b');
      assert.equal(state.settings.game, 'old-maid');
      assert.deepEqual(state.games.map((g) => g.title), ['Old Maid', 'Pusoy Dos', 'Go Fish']);
      assert.throws(() => room.updateSettings('a', { game: 'poker' }), { code: 'invalid-settings' });
    });

    it('starts Pusoy Dos with at most four players; the rest watch', () => {
      room.updateSettings('a', { game: 'pusoy-dos' });
      assert.deepEqual(room.stateFor('a').limits, { minPlayers: 2, maxPlayers: 4 });
      room.startGame('a');
      assert.deepEqual(room.game.playerIds, ['a', 'b', 'c', 'd']);
      assert.equal(room.stateFor('e').game.type, 'pusoy-dos');
      assert.equal(room.stateFor('e').game.isPlaying, false);
      assert.match(room.activity.at(-1), /started a game of Pusoy Dos/);
    });

    it('routes Pusoy Dos moves and rejects the other game\'s moves', () => {
      room.updateSettings('a', { game: 'pusoy-dos' });
      room.startGame('a');
      const { game } = room;
      const leader = game.currentPlayerId;
      assert.throws(() => room.drawFromPile(leader), { code: 'wrong-game' });
      room.playCards(leader, [game.openingCard.id]);
      assert.equal(game.trick.playerId, leader);
      room.pass(game.currentPlayerId);
      assert.equal(game.turnCount, 2);
    });

    it('plays a Pusoy Dos game to the end on timeouts', () => {
      room.updateSettings('a', { game: 'pusoy-dos' });
      room.startGame('a');
      while (!room.game.isOver) mock.timers.tick(room.turnTimeoutMs);
      assert.ok(room.stateFor('a').game.result.winner);
      assert.match(room.activity.join('\n'), /a move was made for them/);
    });
  });
});
