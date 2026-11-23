'use strict';

/** The four suits of a standard deck. */
const Suit = Object.freeze({
  CLUBS: 'clubs',
  DIAMONDS: 'diamonds',
  HEARTS: 'hearts',
  SPADES: 'spades',
});

const SUITS = Object.freeze(Object.values(Suit));

/** Ranks from low to high (ace low). */
const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);

const SUIT_SYMBOLS = Object.freeze({
  [Suit.CLUBS]: '♣',
  [Suit.DIAMONDS]: '♦',
  [Suit.HEARTS]: '♥',
  [Suit.SPADES]: '♠',
});

const RED_SUITS = new Set([Suit.DIAMONDS, Suit.HEARTS]);

/** A single immutable playing card. */
class Card {
  /**
   * @param {string} rank - one of RANKS
   * @param {string} suit - one of SUITS
   */
  constructor(rank, suit) {
    if (!RANKS.includes(rank)) throw new TypeError(`Invalid rank: ${rank}`);
    if (!SUITS.includes(suit)) throw new TypeError(`Invalid suit: ${suit}`);
    this.rank = rank;
    this.suit = suit;
    Object.freeze(this);
  }

  /** Short unique id, e.g. "10H" or "QC". */
  get id() {
    return `${this.rank}${this.suit.charAt(0).toUpperCase()}`;
  }

  get isRed() {
    return RED_SUITS.has(this.suit);
  }

  /** 0 for aces up to 12 for kings; used for sorting. */
  get rankIndex() {
    return RANKS.indexOf(this.rank);
  }

  /** @param {Card} other */
  equals(other) {
    return other instanceof Card && other.rank === this.rank && other.suit === this.suit;
  }

  /** Two different cards of the same rank form a pair. */
  matches(other) {
    return other instanceof Card && other.rank === this.rank && !this.equals(other);
  }

  /** Orders by rank, then suit. */
  static compare(a, b) {
    return a.rankIndex - b.rankIndex || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  }

  toString() {
    return `${this.rank}${SUIT_SYMBOLS[this.suit]}`;
  }

  toJSON() {
    return { id: this.id, rank: this.rank, suit: this.suit };
  }
}

module.exports = { Card, Suit, SUITS, RANKS };
