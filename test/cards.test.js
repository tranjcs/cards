'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Card, Suit, SUITS, RANKS } = require('../src/cards/Card');
const { Deck, STANDARD_DECK_SIZE } = require('../src/cards/Deck');
const { Pile } = require('../src/cards/Pile');
const { Hand } = require('../src/cards/Hand');
const { seededRng } = require('./helpers/seededRng');

const card = (rank, suit = Suit.SPADES) => new Card(rank, suit);

describe('Card', () => {
  it('rejects invalid ranks and suits', () => {
    assert.throws(() => new Card('1', Suit.HEARTS), TypeError);
    assert.throws(() => new Card('A', 'stars'), TypeError);
  });

  it('is immutable', () => {
    const c = card('Q', Suit.HEARTS);
    assert.throws(() => { c.rank = 'K'; }, TypeError);
  });

  it('has an id, colour and label', () => {
    const c = card('10', Suit.HEARTS);
    assert.equal(c.id, '10H');
    assert.equal(c.isRed, true);
    assert.equal(card('K', Suit.CLUBS).isRed, false);
    assert.equal(String(c), '10♥');
    assert.deepEqual(c.toJSON(), { id: '10H', rank: '10', suit: 'hearts' });
  });

  it('matches other cards of the same rank only', () => {
    assert.equal(card('7', Suit.HEARTS).matches(card('7', Suit.CLUBS)), true);
    assert.equal(card('7', Suit.HEARTS).matches(card('8', Suit.HEARTS)), false);
    assert.equal(card('7', Suit.HEARTS).matches(card('7', Suit.HEARTS)), false);
  });

  it('sorts by rank, then suit', () => {
    const sorted = [card('K'), card('A', Suit.HEARTS), card('A', Suit.CLUBS)].sort(Card.compare);
    assert.deepEqual(sorted.map((c) => c.id), ['AC', 'AH', 'KS']);
  });
});

describe('Deck', () => {
  it('has 52 unique cards: 13 ranks in 4 suits', () => {
    const deck = Deck.standard();
    assert.equal(deck.size, STANDARD_DECK_SIZE);
    assert.equal(new Set(deck.cards.map((c) => c.id)).size, 52);
    for (const suit of SUITS) assert.equal(deck.cards.filter((c) => c.suit === suit).length, RANKS.length);
  });

  it('shuffles deterministically with a seeded rng and keeps every card', () => {
    const a = Deck.standard().shuffle(seededRng(1)).cards.map((c) => c.id);
    const b = Deck.standard().shuffle(seededRng(1)).cards.map((c) => c.id);
    const c = Deck.standard().shuffle(seededRng(2)).cards.map((c) => c.id);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.deepEqual([...a].sort(), Deck.standard().cards.map((x) => x.id).sort());
  });
});

describe('Pile', () => {
  it('draws from the top and peeks without removing', () => {
    const pile = new Pile([card('A'), card('2'), card('3')]);
    assert.deepEqual(pile.peek(2).map(String), ['2♠', '3♠']);
    assert.equal(pile.draw().rank, '3');
    assert.equal(pile.size, 2);
    assert.deepEqual(pile.peek(0), []);
  });

  it('returns null when drawing from an empty pile', () => {
    assert.equal(new Pile().draw(), null);
  });

  it('only accepts cards', () => {
    assert.throws(() => new Pile().push({ rank: 'A' }), TypeError);
  });

  it('removes a matching card', () => {
    const pile = new Pile([card('A'), card('Q', Suit.CLUBS)]);
    assert.equal(pile.remove((c) => c.id === 'QC').id, 'QC');
    assert.equal(pile.remove((c) => c.id === 'QC'), null);
    assert.equal(pile.size, 1);
  });
});

describe('Hand', () => {
  it('keeps cards sorted by rank', () => {
    const hand = new Hand([card('K'), card('A'), card('5')]);
    assert.deepEqual(hand.cards.map((c) => c.rank), ['A', '5', 'K']);
  });

  it('removes pairs and leaves the odd one out', () => {
    const hand = new Hand([
      card('7', Suit.HEARTS), card('7', Suit.CLUBS), card('7', Suit.SPADES),
      card('Q', Suit.HEARTS), card('2'), card('2', Suit.DIAMONDS),
    ]);
    const pairs = hand.removePairs();
    assert.equal(pairs.length, 2);
    for (const [a, b] of pairs) assert.ok(a.matches(b));
    assert.deepEqual(hand.cards.map((c) => c.rank).sort(), ['7', 'Q']);
  });

  it('removes two pairs from four of a kind', () => {
    const hand = new Hand(SUITS.map((suit) => card('9', suit)));
    assert.equal(hand.removePairs().length, 2);
    assert.equal(hand.isEmpty, true);
  });

  it('takes random cards and all cards', () => {
    const hand = new Hand([card('A'), card('2'), card('3')]);
    const taken = hand.takeRandom(seededRng(3));
    assert.ok(taken instanceof Card);
    assert.equal(hand.size, 2);
    assert.equal(hand.takeAll().length, 2);
    assert.equal(hand.takeRandom(), null);
  });
});
