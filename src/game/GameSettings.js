'use strict';

const { ActionError } = require('../errors');

/** `cardsPerPlayer` value meaning "deal the whole deck". */
const DEAL_ALL = 0;
const MAX_CARDS_PER_PLAYER = 51;

/**
 * Options the host picks before a game. Immutable: changes produce a new instance.
 *
 * Only the deal size is configurable for now. Future rule options (how many cards
 * per turn, skips, showing or hiding hands, piles on or off) belong here too.
 */
class GameSettings {
  /**
   * @param {object} [options]
   * @param {number} [options.cardsPerPlayer] - DEAL_ALL (0) deals the whole deck
   */
  constructor({ cardsPerPlayer = DEAL_ALL } = {}) {
    this.cardsPerPlayer = GameSettings.parseCardsPerPlayer(cardsPerPlayer);
    Object.freeze(this);
  }

  /**
   * Validates an untrusted value.
   * @param {unknown} value
   * @returns {number}
   */
  static parseCardsPerPlayer(value) {
    if (!Number.isInteger(value) || value < DEAL_ALL || value > MAX_CARDS_PER_PLAYER) {
      throw new ActionError(
        'invalid-settings',
        `Cards per player must be a whole number from 1 to ${MAX_CARDS_PER_PLAYER}, or "all".`,
      );
    }
    return value;
  }

  /**
   * @param {unknown} changes - untrusted settings from the client
   * @returns {GameSettings}
   */
  with(changes) {
    if (typeof changes !== 'object' || changes === null) {
      throw new ActionError('invalid-settings', 'Settings must be an object.');
    }
    const { cardsPerPlayer = this.cardsPerPlayer } = changes;
    return new GameSettings({ cardsPerPlayer });
  }

  get dealsAll() {
    return this.cardsPerPlayer === DEAL_ALL;
  }

  toJSON() {
    return { cardsPerPlayer: this.cardsPerPlayer };
  }
}

module.exports = { GameSettings, DEAL_ALL, MAX_CARDS_PER_PLAYER };
