'use strict';

const { ActionError } = require('../errors');

/** `cardsPerPlayer` value meaning "deal the whole deck". */
const DEAL_ALL = 0;
const MAX_CARDS_PER_PLAYER = 51;

/** The games the host can choose from (see src/game/games.js). */
const GameType = Object.freeze({
  OLD_MAID: 'old-maid',
  PUSOY_DOS: 'pusoy-dos',
  GO_FISH: 'go-fish',
});
const GAME_TYPES = Object.freeze(Object.values(GameType));

/**
 * Options the host picks before a game. Immutable: changes produce a new instance.
 *
 * `game` picks which game is played; `cardsPerPlayer` is the Old Maid deal size.
 * Future rule options (how many cards per turn, skips, showing or hiding hands,
 * piles on or off) belong here too.
 */
class GameSettings {
  /**
   * @param {object} [options]
   * @param {string} [options.game] - one of GAME_TYPES
   * @param {number} [options.cardsPerPlayer] - DEAL_ALL (0) deals the whole deck
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
    const { game = this.game, cardsPerPlayer = this.cardsPerPlayer } = changes;
    return new GameSettings({ game, cardsPerPlayer });
  }

  get dealsAll() {
    return this.cardsPerPlayer === DEAL_ALL;
  }

  toJSON() {
    return { game: this.game, cardsPerPlayer: this.cardsPerPlayer };
  }
}

module.exports = { GameSettings, GameType, GAME_TYPES, DEAL_ALL, MAX_CARDS_PER_PLAYER };
