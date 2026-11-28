'use strict';

const { ActionError } = require('../errors');
const { GameType } = require('../constants');

/** `cardsPerPlayer` value meaning "the game's standard deal" (the whole deck for Old Maid). */
const DEAL_ALL = 0;
const MAX_CARDS_PER_PLAYER = 51;
const GAME_TYPES = Object.freeze(Object.values(GameType));

/**
 * Options the host picks before a game. Immutable: changes produce a new instance.
 *
 * The game to play and the deal size are configurable. Future rule options (how many
 * cards per turn, skips, showing or hiding hands, piles on or off) belong here too.
 */
class GameSettings {
  /**
   * @param {object} [options]
   * @param {string} [options.game] - one of GameType
   * @param {number} [options.cardsPerPlayer] - DEAL_ALL (0) means the game's standard deal
   */
  constructor({ game = GameType.OLD_MAID, cardsPerPlayer = DEAL_ALL } = {}) {
    this.game = GameSettings.parseGame(game);
    this.cardsPerPlayer = GameSettings.parseCardsPerPlayer(cardsPerPlayer);
    Object.freeze(this);
  }

  /**
   * Validates an untrusted value.
   * @param {unknown} value
   * @returns {string}
   */
  static parseGame(value) {
    if (!GAME_TYPES.includes(value)) throw new ActionError('invalid-settings', 'Pick one of the games.');
    return /** @type {string} */ (value);
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
    const { game = this.game } = changes;
    // A different game starts from its own standard deal unless a size is given too.
    const { cardsPerPlayer = game === this.game ? this.cardsPerPlayer : DEAL_ALL } = changes;
    return new GameSettings({ game, cardsPerPlayer });
  }

  /** True when the host left the deal at the game's standard. */
  get dealsAll() {
    return this.cardsPerPlayer === DEAL_ALL;
  }

  toJSON() {
    return { game: this.game, cardsPerPlayer: this.cardsPerPlayer };
  }
}

module.exports = { GameSettings, DEAL_ALL, MAX_CARDS_PER_PLAYER, GAME_TYPES };
