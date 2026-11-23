'use strict';

const { Card } = require('./Card');
const { shuffle } = require('../random');

/**
 * An ordered stack of cards. The last element is the top of the pile.
 * Used for the deck, the draw pile and the discard pile.
 */
class Pile {
  /** @param {Iterable<Card>} [cards] - bottom to top */
  constructor(cards = []) {
    /** @type {Card[]} */
    this.cards = [...cards];
  }

  get size() {
    return this.cards.length;
  }

  get isEmpty() {
    return this.cards.length === 0;
  }

  /** @param {...Card} cards - placed on top, in order */
  push(...cards) {
    for (const card of cards) {
      if (!(card instanceof Card)) throw new TypeError('Only cards can go on a pile');
    }
    this.cards.push(...cards);
  }

  /** Removes and returns the top card, or null if empty. */
  draw() {
    return this.cards.pop() ?? null;
  }

  /**
   * @param {number} [count]
   * @returns {Card[]} the top `count` cards without removing them, bottom to top
   */
  peek(count = 1) {
    return count > 0 ? this.cards.slice(-count) : [];
  }

  /**
   * Removes the first card matching `predicate`.
   * @param {(card: Card) => boolean} predicate
   * @returns {Card|null} the removed card
   */
  remove(predicate) {
    const index = this.cards.findIndex(predicate);
    return index === -1 ? null : this.cards.splice(index, 1)[0];
  }

  /** @param {import('../random').Rng} [rng] */
  shuffle(rng) {
    shuffle(this.cards, rng);
    return this;
  }
}

module.exports = { Pile };
