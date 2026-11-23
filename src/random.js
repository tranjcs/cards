'use strict';

const crypto = require('node:crypto');

/**
 * A source of randomness: returns a float in [0, 1). Injected everywhere randomness
 * is used so tests can be deterministic.
 * @typedef {() => number} Rng
 */

const UINT32_RANGE = 2 ** 32;

/** @type {Rng} Cryptographically strong default, so deals can't be predicted. */
const secureRandom = () => crypto.randomInt(UINT32_RANGE) / UINT32_RANGE;

/**
 * @param {number} max - exclusive upper bound, > 0
 * @param {Rng} [rng]
 * @returns {number} an integer in [0, max)
 */
function randomInt(max, rng = secureRandom) {
  return Math.floor(rng() * max);
}

/**
 * Shuffles an array in place (Fisher-Yates) and returns it.
 * @template T
 * @param {T[]} items
 * @param {Rng} [rng]
 * @returns {T[]}
 */
function shuffle(items, rng = secureRandom) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1, rng);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

module.exports = { secureRandom, randomInt, shuffle };
