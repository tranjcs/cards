'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { OldMaidGame, EndReason } = require('../src/game/OldMaidGame');
const { GameSettings } = require('../src/game/GameSettings');
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

/**
 * A game with hand-picked hands so a scenario is predictable.
 * @param {Record<string, string[]>} hands - player id -> card specs like "QH"
 * @param {object} [options]
 * @param {string[]} [options.drawPile]
 * @param {string} [options.turn]
 */
function rigged(hands, { drawPile = [], turn } = {}) {
  const game = new OldMaidGame({ playerIds: Object.keys(hands), rng: seededRng(1) });
  game.discardPile = new Pile();
  game.drawPile = new Pile(cards(...drawPile));
  game.log = [];
  game.safe = [];
  game.result = null;
  for (const [id, specs] of Object.entries(hands)) {
    game.handOf(id).takeAll();
    game.handOf(id).add(...cards(...specs));
  }
  game.turnOrder.currentIndex = game.playerIds.indexOf(turn ?? game.playerIds[0]);
  return game;
}

/** Plays random legal moves until the game ends. */
function playOut(game) {
  for (let turns = 0; !game.isOver; turns += 1) {
    if (turns > 10000) throw new Error('Game did not finish');
    game.autoPlay(game.currentPlayerId);
  }
}

describe('OldMaidGame setup', () => {
  it('uses the 52-card deck minus the queen of clubs', () => {
    const game = new OldMaidGame({ playerIds: ids(3), rng: seededRng(7) });
    assert.equal(totalCards(game), 51);
    const all = [
      ...game.playerIds.flatMap((id) => game.handOf(id).cards),
      ...game.drawPile.cards,
      ...game.discardPile.cards,
    ];
    assert.equal(all.some((c) => c.id === 'QC'), false);
  });

  it('deals everything by default, so there is no draw pile', () => {
    const game = new OldMaidGame({ playerIds: ids(4), rng: seededRng(2) });
    assert.equal(game.drawPile.size, 0);
  });

  it('deals the chosen number of cards each and leaves the rest as the draw pile', () => {
    const settings = new GameSettings({ cardsPerPlayer: 5 });
    const game = new OldMaidGame({ playerIds: ids(4), settings, rng: seededRng(2) });
    assert.equal(game.drawPile.size, 51 - 20);
    // Pairs are discarded straight away, so hands can be smaller than 5.
    for (const id of game.playerIds) assert.ok(game.handOf(id).size <= 5);
    assert.equal(totalCards(game), 51);
  });

  it('caps the deal at what the deck allows', () => {
    assert.equal(OldMaidGame.maxCardsPerPlayer(2), 25);
    assert.equal(OldMaidGame.maxCardsPerPlayer(10), 5);
    const settings = new GameSettings({ cardsPerPlayer: 51 });
    const game = new OldMaidGame({ playerIds: ids(10), settings, rng: seededRng(2) });
    assert.equal(game.cardsPerPlayer, 5);
    assert.equal(game.drawPile.size, 1);
  });

  it('discards pairs from the deal so nobody starts with a pair', () => {
    const game = new OldMaidGame({ playerIds: ids(3), rng: seededRng(5) });
    for (const id of game.playerIds) {
      const ranks = game.handOf(id).cards.map((c) => c.rank);
      assert.equal(new Set(ranks).size, ranks.length);
    }
    assert.ok(game.discardPile.size > 0);
  });

  it('picks a random first player', () => {
    const starters = new Set();
    for (let seed = 1; seed <= 30; seed += 1) {
      const game = new OldMaidGame({ playerIds: ids(4), rng: seededRng(seed) });
      starters.add(game.log[0].playerId);
    }
    assert.ok(starters.size > 1);
  });

  it('needs 2 to 10 players', () => {
    assert.throws(() => new OldMaidGame({ playerIds: ids(1) }), ActionError);
    assert.throws(() => new OldMaidGame({ playerIds: ids(11) }), ActionError);
  });
});

describe('OldMaidGame turns', () => {
  it('takes a card from the next player clockwise and discards the pair it makes', () => {
    const game = rigged({ a: ['7H', 'KS'], b: ['7C', 'QH'], c: ['KD'] });
    assert.equal(game.targetFor('a'), 'b');
    game.rng = () => 0; // take b's first card (7C)
    game.drawFromPlayer('a', 1);
    assert.deepEqual(game.handOf('a').cards.map(String), ['K♠']);
    assert.deepEqual(game.handOf('b').cards.map(String), ['Q♥']);
    assert.equal(game.discardPile.size, 2);
    assert.equal(game.currentPlayerId, 'b');
  });

  it('skips players with no cards when choosing who to take from', () => {
    const game = rigged({ a: ['7H'], b: [], c: ['7C', 'QH'] }, { drawPile: ['2S'] });
    assert.equal(game.targetFor('a'), 'c');
  });

  it('can draw from the draw pile instead', () => {
    const game = rigged({ a: ['7H'], b: ['8C', 'QH'] }, { drawPile: ['2S', '7S'] });
    game.drawFromPile('a');
    assert.equal(game.handOf('a').size, 0);
    assert.equal(game.drawPile.size, 1);
    assert.equal(game.currentPlayerId, 'b');
  });

  it('rejects moves out of turn, bad picks and an empty draw pile', () => {
    const game = rigged({ a: ['7H'], b: ['8C', 'QH'], c: ['8D'] });
    assert.throws(() => game.drawFromPlayer('b', 0), { code: 'not-your-turn' });
    assert.throws(() => game.drawFromPlayer('a', 2), { code: 'invalid-card' });
    assert.throws(() => game.drawFromPlayer('a', '0'), { code: 'invalid-card' });
    assert.throws(() => game.drawFromPile('a'), { code: 'empty-pile' });
    assert.throws(() => game.drawFromPile('zzz'), { code: 'not-playing' });
  });

  it('lets a player with no cards keep drawing while the pile lasts', () => {
    const game = rigged({ a: ['QH'], b: [] }, { drawPile: ['3S'], turn: 'b' });
    game.settle();
    assert.equal(game.currentPlayerId, 'b');
    const view = game.viewFor('b', nameOf);
    assert.equal(view.canDrawFromPile, true);
    assert.equal(view.target.name, 'Name a');
  });

  it('marks players safe once they have no cards and the pile is empty', () => {
    const game = rigged({ a: ['7H'], b: ['7C', 'QH'], c: ['5D', '5S', 'QS'] });
    game.rng = () => 0;
    game.drawFromPlayer('a', 0); // a takes 7C, pairs, has nothing left
    assert.deepEqual(game.safe, ['a']);
    assert.equal(game.currentPlayerId, 'b');
  });

  it('ends when one player is left holding the odd queen', () => {
    const game = rigged({ a: ['7H'], b: ['7C', 'QH'] });
    game.rng = () => 0;
    game.drawFromPlayer('a', 0);
    assert.equal(game.isOver, true);
    assert.deepEqual(game.result, { loserId: 'b', reason: EndReason.OLD_MAID });
    assert.equal(game.currentPlayerId, null);
    assert.throws(() => game.drawFromPlayer('b', 0), { code: 'game-over' });
  });

  it('always ends with exactly the odd queen left and no cards lost', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const players = 2 + (seed % 9);
      const settings = new GameSettings({ cardsPerPlayer: seed % 4 === 0 ? 0 : seed % 7 });
      const game = new OldMaidGame({ playerIds: ids(players), settings, rng: seededRng(seed) });
      playOut(game);
      const loser = game.result.loserId;
      assert.ok(loser, `seed ${seed}: someone loses`);
      assert.equal(game.handOf(loser).size, 1);
      assert.equal(game.handOf(loser).cards[0].rank, 'Q');
      assert.equal(totalCards(game), 51);
    }
  });
});

describe('OldMaidGame players leaving', () => {
  it('gives a leaving player\'s cards to the next player, who discards new pairs', () => {
    const game = rigged({ a: ['2H'], b: ['7H', 'QH'], c: ['7C', '9D'] }, { turn: 'b' });
    game.removePlayer('b');
    assert.equal(game.isSeated('b'), false);
    assert.deepEqual(game.handOf('c').cards.map(String), ['9♦', 'Q♥']);
    assert.equal(game.discardPile.size, 2);
    assert.equal(game.currentPlayerId, 'c'); // turn passed on clockwise
  });

  it('ends the game when fewer than two players remain', () => {
    const game = rigged({ a: ['2H', 'QH'], b: ['2S'] });
    game.removePlayer('b');
    assert.deepEqual(game.result, { loserId: null, reason: EndReason.NOT_ENOUGH_PLAYERS });
  });

  it('ignores unknown players', () => {
    const game = rigged({ a: ['2H', 'QH'], b: ['2S'] });
    game.removePlayer('zzz');
    assert.equal(game.isOver, false);
  });
});

describe('OldMaidGame views', () => {
  it('shows your own hand but only card counts for others', () => {
    const game = rigged({ a: ['7H', 'KS'], b: ['8C', 'QH'] });
    const view = game.viewFor('a', nameOf);
    assert.deepEqual(view.hand.map((c) => c.id), ['7H', 'KS']);
    assert.equal(view.isYourTurn, true);
    const other = view.seats.find((s) => s.name === 'Name b');
    assert.equal(other.cardCount, 2);
    assert.equal(other.hand, null);
    assert.equal(JSON.stringify(view).includes('QH'), false);
  });

  it('gives spectators no hand', () => {
    const game = rigged({ a: ['7H'], b: ['8C', 'QH'] });
    const view = game.viewFor('spectator', nameOf);
    assert.equal(view.isPlaying, false);
    assert.equal(view.hand, null);
    assert.equal(JSON.stringify(view).includes('QH'), false);
  });

  it('only tells the two players involved which card was taken', () => {
    const game = rigged({ a: ['7H'], b: ['8C', 'QH'], c: ['8D'] });
    game.rng = () => 0.99; // take QH
    game.drawFromPlayer('a', 0);
    assert.deepEqual(game.viewFor('a', nameOf).lastDraw, { you: 'took', card: { id: 'QH', rank: 'Q', suit: 'hearts' }, from: 'Name b' });
    assert.equal(game.viewFor('b', nameOf).lastDraw.you, 'lost');
    assert.equal(game.viewFor('c', nameOf).lastDraw, null);
    assert.equal(JSON.stringify(game.viewFor('c', nameOf)).includes('QH'), false);
  });

  it('reveals the old maid at the end', () => {
    const game = rigged({ a: ['7H'], b: ['7C', 'QH'] });
    game.rng = () => 0;
    game.drawFromPlayer('a', 0);
    const view = game.viewFor('a', nameOf);
    assert.equal(view.result.loser, 'Name b');
    assert.deepEqual(view.seats.find((s) => s.isLoser).hand.map((c) => c.id), ['QH']);
    assert.match(view.log.at(-1), /Name b is stuck with the Old Maid/);
  });
});
