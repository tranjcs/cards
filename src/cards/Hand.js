'use strict';

const { Card } = require('./Card');
const { randomInt } = require('../random');

/** The cards one player holds. Kept sorted by rank so the owner sees an orderly hand. */
class Hand {
  /** @param {Iterable<Card>} [cards] */
  constructor(cards = []) {
    /** @type {Card[]} */
    this.cards = [];
    this.add(...cards);
  }

  get size() {
    return this.cards.length;
  }

  get isEmpty() {
    return this.cards.length === 0;
  }

  /** @param {...Card} cards */
  add(...cards) {
    for (const card of cards) {
      if (!(card instanceof Card)) throw new TypeError('Only cards can go in a hand');
    }
    this.cards.push(...cards);
    this.cards.sort(Card.compare);
  }

  /** Removes and returns a random card, or null if empty. */
  takeRandom(rng) {
    if (this.isEmpty) return null;
    return this.cards.splice(randomInt(this.cards.length, rng), 1)[0];
  }

  /** Removes and returns every card. */
  takeAll() {
    const all = this.cards;
    this.cards = [];
    return all;
  }

  /**
   * Removes every pair of matching ranks. With three of a rank, one stays.
   * @returns {Array<[Card, Card]>} the pairs removed
   */
  removePairs() {
    const byRank = new Map();
    for (const card of this.cards) {
      byRank.set(card.rank, [...(byRank.get(card.rank) ?? []), card]);
    }
    const pairs = [];
    for (const cards of byRank.values()) {
      for (let i = 0; i + 1 < cards.length; i += 2) pairs.push([cards[i], cards[i + 1]]);
    }
    const paired = new Set(pairs.flat());
    this.cards = this.cards.filter((card) => !paired.has(card));
    return pairs;
  }

  toJSON() {
    return this.cards.map((card) => card.toJSON());
  }
}

module.exports = { Hand };
