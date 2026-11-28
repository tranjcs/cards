'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { GoFishGame, EndReason } = require('../src/game/GoFishGame');
const { Card, Suit } = require('../src/cards/Card');
const { Pile } = require('../src/cards/Pile');
const { ActionError } = require('../src/errors');
const { seededRng } = require('./helpers/seededRng');

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);
const nameOf = (id) => `Name ${id}`;
const cards = (...specs) => specs.map((spec) => {
  const rank = spec.slice(0, -1);
  const suit = { C: Suit.CLUBS, D: Suit.DIAMONDS, H: Suit.HEARTS, S: Suit.SPADES }[spec.slice(-1)];
  return new Card(rank, suit);
});
const totalCards = (game) =>
  game.playerIds.reduce((sum, id) => sum + game.handOf(id).size, 0) + game.drawPile.size + game.discardPile.size;
const seatOf = (game, id) => game.playerIds.indexOf(id);

/**
 * A game with hand-picked hands so a scenario is predictable.
 * @param {Record<string, string[]>} hands - player id -> card specs like "QH"
 * @param {object} [options]
 * @param {string[]} [options.drawPile] - bottom to top
 * @param {string} [options.turn]
 */
function rigged(hands, { drawPile = [], turn } = {}) {
  const game = new GoFishGame({ playerIds: Object.keys(hands), rng: seededRng(1) });
  game.discardPile = new Pile();
  game.drawPile = new Pile(cards(...drawPile));
  game.log = [];
  game.result = null;
  game.lastFish = null;
  for (const [id, specs] of Object.entries(hands)) {
    game.handOf(id).takeAll();
    game.handOf(id).add(...cards(...specs));
    game.books.set(id, []);
  }
  game.turnOrder.currentIndex = seatOf(game, turn ?? game.playerIds[0]);
  return game;
}

function playOut(game) {
  for (let turns = 0; !game.isOver; turns += 1) {
    if (turns > 10000) throw new Error('Game did not finish');
    game.autoPlay(game.currentPlayerId);
  }
}

describe('GoFishGame setup', () => {
  it('deals 7 each to 2-3 players and 5 each to more, from a full deck', () => {
    const three = new GoFishGame({ playerIds: ids(3), rng: seededRng(3) });
    assert.equal(three.drawPile.size, 52 - 21);
    assert.equal(totalCards(three), 52);
    const four = new GoFishGame({ playerIds: ids(4), rng: seededRng(3) });
    assert.equal(four.drawPile.size, 52 - 20);
  });

  it('needs 2 to 10 players', () => {
    assert.throws(() => new GoFishGame({ playerIds: ids(1) }), { code: 'player-count' });
    assert.throws(() => new GoFishGame({ playerIds: ids(11) }), { code: 'player-count' });
  });
});

describe('GoFishGame asking', () => {
  it('takes every card of the rank and goes again', () => {
    const game = rigged({ a: ['7H', '2C'], b: ['7S', '7D', '9C'], c: ['3H'] }, { drawPile: ['KH'] });
    game.ask('a', { seat: seatOf(game, 'b'), rank: '7' });
    assert.deepEqual(game.handOf('a').cards.map((c) => c.id), ['2C', '7D', '7H', '7S']);
    assert.deepEqual(game.handOf('b').cards.map((c) => c.id), ['9C']);
    assert.equal(game.currentPlayerId, 'a');
    assert.match(game.viewFor('c', nameOf).log.at(-1), /asked Name b for 7s and got 2/);
  });

  it('goes fishing on a miss and passes the turn', () => {
    const game = rigged({ a: ['7H'], b: ['9C'], c: ['3H'] }, { drawPile: ['KH'] });
    game.ask('a', { seat: seatOf(game, 'c'), rank: '7' });
    assert.deepEqual(game.handOf('a').cards.map((c) => c.id), ['7H', 'KH']);
    assert.equal(game.currentPlayerId, 'b');
    // Only the fisher sees the card they drew.
    assert.deepEqual(game.viewFor('a', nameOf).lastFish, { id: 'KH', rank: 'K', suit: 'hearts' });
    assert.equal(game.viewFor('b', nameOf).lastFish, null);
    assert.doesNotMatch(game.viewFor('b', nameOf).log.join(' '), /K/);
  });

  it('goes again after fishing the rank that was asked for', () => {
    const game = rigged({ a: ['7H'], b: ['9C'] }, { drawPile: ['2C', '7C'] });
    game.ask('a', { seat: seatOf(game, 'b'), rank: '7' });
    assert.equal(game.currentPlayerId, 'a');
    assert.match(game.viewFor('b', nameOf).log.at(-1), /fished the 7♣/);
  });

  it('lays down books of four', () => {
    const game = rigged({ a: ['7H', '7C', '2C'], b: ['7S', '7D', '9C'] }, { drawPile: ['KH'] });
    game.ask('a', { seat: seatOf(game, 'b'), rank: '7' });
    assert.deepEqual(game.booksOf('a'), ['7']);
    assert.deepEqual(game.handOf('a').cards.map((c) => c.id), ['2C']);
    assert.equal(game.discardPile.size, 4);
  });

  it('validates the request', () => {
    const game = rigged({ a: ['7H'], b: ['9C'], c: [] }, { drawPile: ['KH'] });
    const bad = [
      [{ seat: seatOf(game, 'a'), rank: '7' }, 'invalid-target'],
      [{ seat: seatOf(game, 'c'), rank: '7' }, 'invalid-target'], // no cards
      [{ seat: 9, rank: '7' }, 'invalid-target'],
      [{ seat: '1', rank: '7' }, 'invalid-target'],
      [null, 'invalid-target'],
      [{ seat: seatOf(game, 'b'), rank: '9' }, 'invalid-rank'], // not held
      [{ seat: seatOf(game, 'b'), rank: 'Z' }, 'invalid-rank'],
    ];
    for (const [request, code] of bad) {
      assert.throws(() => game.ask('a', request), { code }, JSON.stringify(request));
    }
    assert.throws(() => game.ask('b', { seat: seatOf(game, 'a'), rank: '9' }), { code: 'not-your-turn' });
    assert.throws(() => game.goFish('a'), { code: 'must-ask' });
  });
});

describe('GoFishGame empty hands', () => {
  it("can't ask a player who has no cards", () => {
    const game = rigged({ a: ['7H'], b: [], c: ['2D'] }, { drawPile: ['KS'] });
    assert.throws(() => game.ask('a', { seat: seatOf(game, 'b'), rank: '7' }), { code: 'invalid-target' });
    assert.deepEqual(game.viewFor('a', nameOf).seats.map((s) => s.isTarget), [false, false, true]);
  });

  it('a player with no cards draws one at the start of their turn', () => {
    const game = rigged({ a: ['7H'], b: ['7C'], c: ['2D'] }, { drawPile: ['QS', 'KS'] });
    game.ask('a', { seat: seatOf(game, 'b'), rank: '7' }); // b is now empty; a goes again
    game.ask('a', { seat: seatOf(game, 'c'), rank: '7' }); // miss: fishes KS, turn to b
    assert.equal(game.currentPlayerId, 'b');
    assert.deepEqual(game.handOf('b').cards.map((c) => c.id), ['QS']);
  });

  it('lets a player go fish when nobody else has cards', () => {
    const game = rigged({ a: ['7H'], b: [] }, { drawPile: ['QS', 'KS'] });
    assert.equal(game.viewFor('a', nameOf).canGoFish, true);
    game.goFish('a');
    assert.equal(game.currentPlayerId, 'b');
    assert.equal(game.handOf('b').size, 1); // refilled
  });
});

describe('GoFishGame ending', () => {
  it('ends when every card is in a book; most books wins', () => {
    const game = rigged({ a: ['7H', '7C', '7D', 'KH'], b: ['7S', 'KC', 'KD', 'KS'] });
    game.books.set('a', ['2', '3']);
    game.ask('a', { seat: seatOf(game, 'b'), rank: '7' });
    assert.equal(game.isOver, false);
    game.ask('a', { seat: seatOf(game, 'b'), rank: 'K' });
    assert.equal(game.isOver, true);
    assert.equal(game.result.reason, EndReason.BOOKS);
    assert.deepEqual(game.result.winnerIds, ['a']);
    assert.deepEqual(game.viewFor('a', nameOf).result, { reason: 'books', winners: ['Name a'], youWon: true });
  });

  it('can end in a tie', () => {
    const game = rigged({ a: ['7H', '7C', '7D'], b: ['7S'] });
    game.books.set('b', ['2']);
    game.ask('a', { seat: seatOf(game, 'b'), rank: '7' });
    assert.deepEqual(game.result.winnerIds, ['a', 'b']);
    assert.match(game.log.at(-1).kind, /game-over/);
  });

  it('always finishes with all 13 books when played randomly', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const count of [2, 4, 6]) {
        const game = new GoFishGame({ playerIds: ids(count), rng: seededRng(seed) });
        playOut(game);
        assert.equal(game.result.reason, EndReason.BOOKS);
        const books = game.playerIds.flatMap((id) => game.booksOf(id));
        assert.equal(books.length, 13, `seed ${seed}, ${count} players`);
        assert.equal(totalCards(game), 52);
      }
    }
  });

  it('hands a departing player\'s cards on and ends when one player is left', () => {
    const game = rigged({ a: ['7H'], b: ['7C', '9D'], c: ['2D'] }, { drawPile: ['KS'] });
    game.removePlayer('b');
    assert.deepEqual(game.handOf('c').cards.map((c) => c.id), ['2D', '7C', '9D']);
    game.removePlayer('c');
    assert.equal(game.result.reason, EndReason.NOT_ENOUGH_PLAYERS);
  });

  it('rejects moves after the game ends', () => {
    const game = rigged({ a: ['7H'], b: ['9C'] });
    game.removePlayer('b');
    assert.throws(() => game.ask('a', { seat: 0, rank: '7' }), ActionError);
  });
});
