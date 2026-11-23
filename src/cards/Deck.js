'use strict';

const { Card, SUITS, RANKS } = require('./Card');
const { Pile } = require('./Pile');

const STANDARD_DECK_SIZE = SUITS.length * RANKS.length; // 52

/** A deck of playing cards. */
class Deck extends Pile {
  /** @returns {Deck} a fresh, unshuffled standard 52-card deck */
  static standard() {
    const cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push(new Card(rank, suit));
    }
    return new Deck(cards);
  }
}

module.exports = { Deck, STANDARD_DECK_SIZE };
