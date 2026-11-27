'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PusoyDosGame, EndReason } = require('../src/game/PusoyDosGame');
const { identify, beats, compareCards, ComboType } = require('../src/game/pusoyDosCombos');
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
const combo = (...specs) => identify(cards(...specs));
const allCards = (game) => [
  ...game.playerIds.flatMap((id) => game.handOf(id).cards),
  ...game.drawPile.cards,
  ...game.discardPile.cards,
  ...(game.trick?.cards ?? []),
];

/**
 * A game with hand-picked hands.
 * @param {Record<string, string[]>} hands
 * @param {object} [options]
 * @param {string} [options.turn]
 * @param {string|null} [options.opening] - card spec the first play must include
 */
function rigged(hands, { turn, opening = null } = {}) {
  const game = new PusoyDosGame({ playerIds: Object.keys(hands), rng: seededRng(1) });
  game.drawPile = new Pile();
  game.discardPile = new Pile();
  game.log = [];
  for (const [id, specs] of Object.entries(hands)) {
    game.handOf(id).takeAll();
    game.handOf(id).add(...cards(...specs));
  }
  game.openingCard = opening
    ? game.playerIds.flatMap((id) => game.handOf(id).cards).find((c) => c.id === opening)
    : null;
  game.turnOrder.currentIndex = game.playerIds.indexOf(turn ?? game.playerIds[0]);
  return game;
}

describe('Pusoy Dos combinations', () => {
  it('ranks 3 lowest and 2 highest, then clubs < spades < hearts < diamonds', () => {
    const sorted = cards('2C', '3D', 'AS', '3C', '3S', '3H', 'KD').sort(compareCards).map(String);
    assert.deepEqual(sorted, ['3♣', '3♠', '3♥', '3♦', 'K♦', 'A♠', '2♣']);
  });

  it('recognises every kind of play', () => {
    assert.equal(combo('7H').type, ComboType.SINGLE);
    assert.equal(combo('7H', '7C').type, ComboType.PAIR);
    assert.equal(combo('7H', '7C', '7S').type, ComboType.TRIPLE);
    assert.equal(combo('3C', '4D', '5H', '6S', '7C').type, ComboType.STRAIGHT);
    assert.equal(combo('3H', '9H', 'JH', 'KH', '2H').type, ComboType.FLUSH);
    assert.equal(combo('9H', '9C', '9S', '4D', '4C').type, ComboType.FULL_HOUSE);
    assert.equal(combo('9H', '9C', '9S', '9D', '4C').type, ComboType.FOUR_OF_A_KIND);
    assert.equal(combo('5S', '6S', '7S', '8S', '9S').type, ComboType.STRAIGHT_FLUSH);
    assert.equal(combo('10S', 'JD', 'QH', 'KC', 'AC').type, ComboType.STRAIGHT);
  });

  it('rejects plays that are not a valid combination', () => {
    assert.equal(combo('7H', '8H'), null);
    assert.equal(combo('7H', '7C', '8S'), null);
    assert.equal(combo('7H', '7C', '7S', '7D'), null); // four cards
    assert.equal(combo('3C', '4D', '5H', '6S', '8C'), null);
    assert.equal(combo('JC', 'QD', 'KH', 'AS', '2C'), null); // no 2s in straights
    assert.equal(combo('AC', '2D', '3H', '4S', '5C'), null); // no wrap-around
    assert.equal(combo('9H', '9C', '4S', '4D', '5C'), null); // two pair
    assert.equal(identify([]), null);
  });

  it('compares singles and pairs by rank, then by the highest suit', () => {
    assert.ok(beats(combo('2C'), combo('AD')));
    assert.ok(beats(combo('8D'), combo('8H')));
    assert.ok(!beats(combo('8C'), combo('8S')));
    assert.ok(beats(combo('8S', '8D'), combo('8C', '8H')));
    assert.ok(beats(combo('9C', '9S'), combo('8H', '8D')));
  });

  it('only lets a play beat one of the same size', () => {
    assert.ok(!beats(combo('2D', '2H'), combo('3C')));
    assert.ok(!beats(combo('3C'), combo('3S', '3H')));
  });

  it('ranks five-card hands by type, then by their key card', () => {
    const straight = combo('3C', '4D', '5H', '6S', '7C');
    const higherStraight = combo('4C', '5D', '6H', '7S', '8C');
    const flush = combo('3H', '9H', 'JH', 'KH', '2H');
    const fullHouse = combo('3H', '3C', '3S', '4D', '4C');
    const higherFullHouse = combo('4H', '4S', '4D', '3D', '3S');
    const quads = combo('5H', '5C', '5S', '5D', '3C');
    const straightFlush = combo('3S', '4S', '5S', '6S', '7S');
    assert.ok(beats(higherStraight, straight));
    assert.ok(beats(flush, higherStraight));
    assert.ok(beats(fullHouse, flush));
    assert.ok(beats(higherFullHouse, fullHouse));
    assert.ok(beats(quads, higherFullHouse));
    assert.ok(beats(straightFlush, quads));
    assert.ok(!beats(straight, flush));
    // Same-ranked straights: the suit of the top card decides.
    assert.ok(beats(combo('3C', '4C', '5C', '6D', '7D'), combo('3D', '4D', '5D', '6C', '7H')));
  });
});

describe('PusoyDosGame setup', () => {
  it('deals 13 cards each to four players, and the 3♣ leads', () => {
    const game = new PusoyDosGame({ playerIds: ids(4), rng: seededRng(3) });
    for (const id of game.playerIds) assert.equal(game.handOf(id).size, 13);
    assert.equal(game.setAsideCount, 0);
    assert.ok(game.handOf(game.currentPlayerId).cards.some((c) => c.id === '3C'));
    assert.equal(game.openingCard.id, '3C');
  });

  it('deals 17 each to three players and 13 each to two, setting the rest aside', () => {
    const three = new PusoyDosGame({ playerIds: ids(3), rng: seededRng(3) });
    assert.equal(three.handOf('p0').size, 17);
    assert.equal(three.setAsideCount, 1);
    const two = new PusoyDosGame({ playerIds: ids(2), rng: seededRng(3) });
    assert.equal(two.handOf('p0').size, 13);
    assert.equal(two.setAsideCount, 26);
  });

  it('lets whoever holds the lowest dealt card lead when the 3♣ is set aside', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = new PusoyDosGame({ playerIds: ids(2), rng: seededRng(seed) });
      const dealt = game.playerIds.flatMap((id) => game.handOf(id).cards).sort(compareCards);
      assert.equal(game.openingCard, dealt[0]);
      assert.ok(game.handOf(game.currentPlayerId).cards.includes(dealt[0]));
    }
  });

  it('keeps each hand sorted from lowest to highest', () => {
    const game = new PusoyDosGame({ playerIds: ids(4), rng: seededRng(8) });
    const hand = game.handOf('p1').cards;
    assert.deepEqual(hand, [...hand].sort(compareCards));
  });

  it('needs 2 to 4 players', () => {
    assert.throws(() => new PusoyDosGame({ playerIds: ids(1) }), ActionError);
    assert.throws(() => new PusoyDosGame({ playerIds: ids(5) }), ActionError);
  });
});

describe('PusoyDosGame turns', () => {
  it('requires the opening play to include the lowest card', () => {
    const game = rigged({ a: ['3C', '5D', '5H'], b: ['9C', 'KD'] }, { opening: '3C' });
    assert.throws(() => game.play('a', ['5D', '5H']), { code: 'must-open' });
    game.play('a', ['3C']);
    assert.equal(game.trick.playerId, 'a');
    assert.equal(game.currentPlayerId, 'b');
    assert.equal(game.openingCard, null);
  });

  it('validates the cards played', () => {
    const game = rigged({ a: ['3C', '5D', '6H'], b: ['9C', 'KD'] });
    assert.throws(() => game.play('b', ['9C']), { code: 'not-your-turn' });
    assert.throws(() => game.play('a', ['9C']), { code: 'invalid-cards' }); // not theirs
    assert.throws(() => game.play('a', []), { code: 'invalid-cards' });
    assert.throws(() => game.play('a', '3C'), { code: 'invalid-cards' });
    assert.throws(() => game.play('a', ['3C', '3C']), { code: 'invalid-cards' });
    assert.throws(() => game.play('a', [{ id: '3C' }]), { code: 'invalid-cards' });
    assert.throws(() => game.play('a', ['5D', '6H']), { code: 'invalid-combo' });
    assert.throws(() => game.pass('a'), { code: 'must-lead' });
    assert.throws(() => game.play('zzz', ['3C']), { code: 'not-playing' });
  });

  it('only accepts a higher play of the same size', () => {
    const game = rigged({ a: ['8H', 'KS', 'KD'], b: ['8C', '8D', '9C'] });
    game.play('a', ['8H']);
    assert.throws(() => game.play('b', ['8C']), { code: 'too-low' });
    assert.throws(() => game.play('b', ['8C', '8D']), { code: 'wrong-size' });
    game.play('b', ['8D']);
    assert.deepEqual(game.discardPile.cards.map(String), ['8♥']);
    assert.equal(game.trick.cards[0].id, '8D');
  });

  it('gives the lead back to the last player once everyone else passes', () => {
    const game = rigged({ a: ['5H', '9S'], b: ['3C', '4C'], c: ['3D', '4D'] });
    game.play('a', ['5H']);
    game.pass('b');
    assert.ok(game.passed.has('b'));
    game.pass('c');
    assert.equal(game.currentPlayerId, 'a');
    assert.equal(game.trick, null);
    assert.equal(game.passed.size, 0);
    assert.match(game.viewFor('a', nameOf).log.at(-1), /Everyone passed. Name a leads/);
    assert.throws(() => game.pass('a'), { code: 'must-lead' });
  });

  it('lets a player who passed play again later in the round', () => {
    const game = rigged({ a: ['5H', '9S', '3H'], b: ['6C', '2D', '4C'], c: ['7D', '4D'] });
    game.play('a', ['5H']);
    game.pass('b');
    game.play('c', ['7D']);
    game.play('a', ['9S']);
    game.play('b', ['2D']); // b passed earlier this round
    assert.equal(game.trick.playerId, 'b');
  });

  it('ends as soon as a player has no cards left', () => {
    const game = rigged({ a: ['5H', '5D'], b: ['3C', '4C'] });
    game.play('a', ['5H', '5D']);
    assert.equal(game.isOver, true);
    assert.deepEqual(game.result, { winnerId: 'a', loserId: null, reason: EndReason.WON });
    assert.equal(game.currentPlayerId, null);
    assert.throws(() => game.pass('b'), { code: 'game-over' });
  });

  it('times out by passing, or by leading the lowest card', () => {
    const game = rigged({ a: ['3C', '5H'], b: ['4C', '6D'] }, { opening: '3C' });
    game.autoPlay('a');
    assert.equal(game.trick.cards[0].id, '3C');
    game.autoPlay('b');
    assert.ok(game.passed.has('b') || game.trick === null);
    assert.equal(game.currentPlayerId, 'a');
    game.autoPlay('a');
    assert.equal(game.trick.cards[0].id, '5H');
  });

  it('always finishes with random play and never loses a card', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const game = new PusoyDosGame({ playerIds: ids(2 + (seed % 3)), rng: seededRng(seed) });
      for (let turns = 0; !game.isOver; turns += 1) {
        if (turns > 5000) throw new Error('Game did not finish');
        game.autoPlay(game.currentPlayerId);
      }
      assert.equal(game.result.reason, EndReason.WON);
      assert.equal(game.handOf(game.result.winnerId).size, 0);
      assert.equal(new Set(allCards(game)).size, 52);
    }
  });
});

describe('PusoyDosGame players leaving', () => {
  it('sets their cards aside and clears the table if it was theirs', () => {
    const game = rigged({ a: ['5H', '9S'], b: ['3C', '4C'], c: ['3D', '4D'] });
    game.play('a', ['5H']);
    game.removePlayer('a');
    assert.equal(game.trick, null);
    assert.equal(game.drawPile.size, 1);
    assert.equal(game.currentPlayerId, 'b');
    game.play('b', ['3C']); // b may lead anything
  });

  it('ends the round when the leaver was the last one who could still respond', () => {
    const game = rigged({ a: ['5H', '9S'], b: ['3C', '4C'], c: ['3D', '4D'] });
    game.play('a', ['5H']);
    game.pass('b');
    game.removePlayer('c');
    assert.equal(game.currentPlayerId, 'a');
    assert.equal(game.trick, null);
  });

  it('drops the opening requirement if the opener leaves', () => {
    const game = rigged({ a: ['3C', '5H'], b: ['4C', '6D'], c: ['7D'] }, { opening: '3C' });
    game.removePlayer('a');
    assert.equal(game.openingCard, null);
    game.play('b', ['6D']);
  });

  it('ends the game when fewer than two players remain', () => {
    const game = rigged({ a: ['3C', '5H'], b: ['4C', '6D'] });
    game.removePlayer('b');
    assert.deepEqual(game.result, { winnerId: null, loserId: null, reason: EndReason.NOT_ENOUGH_PLAYERS });
  });
});

describe('PusoyDosGame views', () => {
  it('shows your own hand but only card counts for others', () => {
    const game = rigged({ a: ['3C', '5H'], b: ['4C', 'QD'] });
    const view = game.viewFor('a', nameOf);
    assert.equal(view.type, 'pusoy-dos');
    assert.deepEqual(view.hand.map((c) => c.id), ['3C', '5H']);
    assert.equal(view.seats[1].cardCount, 2);
    assert.equal(view.seats[1].hand, null);
    assert.equal(JSON.stringify(view).includes('QD'), false);
    assert.equal(JSON.stringify(game.viewFor('spectator', nameOf)).includes('QD'), false);
  });

  it('shows the cards on the table and who can pass', () => {
    const game = rigged({ a: ['3C', '5H'], b: ['4C', 'QD'] });
    game.play('a', ['5H']);
    const view = game.viewFor('b', nameOf);
    assert.deepEqual(view.table.cards.map((c) => c.id), ['5H']);
    assert.equal(view.table.by, 'Name a');
    assert.equal(view.canPass, true);
    assert.equal(game.viewFor('a', nameOf).canPass, false);
  });

  it('tells the opener which card to include', () => {
    const game = rigged({ a: ['3C', '5H'], b: ['4C', 'QD'] }, { opening: '3C' });
    assert.equal(game.viewFor('a', nameOf).mustInclude.id, '3C');
  });

  it('reveals everyone\'s leftover cards at the end', () => {
    const game = rigged({ a: ['5H'], b: ['4C', 'QD'] });
    game.play('a', ['5H']);
    const view = game.viewFor('a', nameOf);
    assert.equal(view.result.winner, 'Name a');
    assert.equal(view.result.youWon, true);
    assert.deepEqual(view.seats[1].hand.map((c) => c.id), ['4C', 'QD']);
  });
});
