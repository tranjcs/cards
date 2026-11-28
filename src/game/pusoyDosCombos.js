'use strict';

const { Suit } = require('../cards/Card');

/** Ranks from lowest to highest: 3 is the lowest card, 2 the highest. */
const RANK_ORDER = Object.freeze(['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2']);

/** Suits from lowest to highest: clubs, spades, hearts, diamonds. */
const SUIT_ORDER = Object.freeze([Suit.CLUBS, Suit.SPADES, Suit.HEARTS, Suit.DIAMONDS]);

/** The kinds of play. */
const ComboType = Object.freeze({
  SINGLE: 'single',
  PAIR: 'pair',
  TRIPLE: 'triple',
  STRAIGHT: 'straight',
  FLUSH: 'flush',
  FULL_HOUSE: 'full-house',
  FOUR_OF_A_KIND: 'four-of-a-kind',
  STRAIGHT_FLUSH: 'straight-flush',
});

/** Five-card hands from weakest to strongest. */
const FIVE_CARD_ORDER = Object.freeze([
  ComboType.STRAIGHT,
  ComboType.FLUSH,
  ComboType.FULL_HOUSE,
  ComboType.FOUR_OF_A_KIND,
  ComboType.STRAIGHT_FLUSH,
]);

const COMBO_NAMES = Object.freeze({
  [ComboType.SINGLE]: 'single',
  [ComboType.PAIR]: 'pair',
  [ComboType.TRIPLE]: 'three of a kind',
  [ComboType.STRAIGHT]: 'straight',
  [ComboType.FLUSH]: 'flush',
  [ComboType.FULL_HOUSE]: 'full house',
  [ComboType.FOUR_OF_A_KIND]: 'four of a kind',
  [ComboType.STRAIGHT_FLUSH]: 'straight flush',
});

/** Valid play sizes. */
const PLAY_SIZES = Object.freeze([1, 2, 3, 5]);

/** @param {import('../cards/Card').Card} card @returns {number} 0 (3) to 12 (2) */
function rankValue(card) {
  return RANK_ORDER.indexOf(card.rank);
}

/** @param {import('../cards/Card').Card} card @returns {number} 0 (3♣) to 51 (2♦) */
function cardValue(card) {
  return rankValue(card) * SUIT_ORDER.length + SUIT_ORDER.indexOf(card.suit);
}

/** Orders cards from lowest to highest in Pusoy Dos. */
function compareCards(a, b) {
  return cardValue(a) - cardValue(b);
}

/**
 * Works out what kind of play a set of cards is.
 *
 * - Pairs and singles are compared by their highest card (rank, then suit).
 * - Three of a kind, full houses and four of a kind are compared by the rank of the
 *   three or four matching cards.
 * - Straights, flushes and straight flushes are compared by their highest card. A
 *   straight is five consecutive ranks from 3-4-5-6-7 up to 10-J-Q-K-A: it can't wrap
 *   around, and 2s can't be in a straight.
 *
 * @param {import('../cards/Card').Card[]} cards - distinct cards
 * @returns {{ type: string, size: number, value: number }|null} null if it isn't a valid play
 */
function identify(cards) {
  if (!PLAY_SIZES.includes(cards.length)) return null;
  const sorted = [...cards].sort(compareCards);
  const highest = sorted.at(-1);
  const ranks = sorted.map(rankValue);
  const allSameRank = ranks.every((rank) => rank === ranks[0]);

  if (cards.length < 5) {
    if (!allSameRank) return null;
    const type = [ComboType.SINGLE, ComboType.PAIR, ComboType.TRIPLE][cards.length - 1];
    const value = type === ComboType.TRIPLE ? ranks[0] : cardValue(highest);
    return { type, size: cards.length, value };
  }

  const counts = new Map();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const twoRank = RANK_ORDER.indexOf('2');
  const isStraight = counts.size === 5 && ranks[4] - ranks[0] === 4 && ranks[4] !== twoRank;
  const isFlush = sorted.every((card) => card.suit === sorted[0].suit);

  if (isStraight && isFlush) return { type: ComboType.STRAIGHT_FLUSH, size: 5, value: cardValue(highest) };
  if (groups[0][1] === 4) return { type: ComboType.FOUR_OF_A_KIND, size: 5, value: groups[0][0] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { type: ComboType.FULL_HOUSE, size: 5, value: groups[0][0] };
  if (isFlush) return { type: ComboType.FLUSH, size: 5, value: cardValue(highest) };
  if (isStraight) return { type: ComboType.STRAIGHT, size: 5, value: cardValue(highest) };
  return null;
}

/**
 * @param {{ type: string, size: number, value: number }} play
 * @param {{ type: string, size: number, value: number }} current
 * @returns {boolean} whether `play` may be played on top of `current`
 */
function beats(play, current) {
  if (play.size !== current.size) return false;
  if (play.size === 5 && play.type !== current.type) {
    return FIVE_CARD_ORDER.indexOf(play.type) > FIVE_CARD_ORDER.indexOf(current.type);
  }
  return play.value > current.value;
}

module.exports = {
  RANK_ORDER,
  SUIT_ORDER,
  ComboType,
  COMBO_NAMES,
  FIVE_CARD_ORDER,
  PLAY_SIZES,
  rankValue,
  cardValue,
  compareCards,
  identify,
  beats,
};
