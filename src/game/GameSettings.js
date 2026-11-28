'use strict';

const { ActionError } = require('../errors');

/** `cardsPerPlayer` value meaning "deal the whole deck". */
const DEAL_ALL = 0;
const MAX_CARDS_PER_PLAYER = 51;

/** `mafiaCount` value meaning "pick a number to suit the table". */
const AUTO_MAFIA = 0;
/** One ace per Mafia member. */
const MAX_MAFIA = 4;
const MIN_DAY_MINUTES = 1;
const MAX_DAY_MINUTES = 10;
const DEFAULT_DAY_MINUTES = 3;

/** The games the host can choose from (see src/game/games.js). */
const GameType = Object.freeze({
  OLD_MAID: 'old-maid',
  PUSOY_DOS: 'pusoy-dos',
  GO_FISH: 'go-fish',
  MAFIA: 'mafia',
});
const GAME_TYPES = Object.freeze(Object.values(GameType));

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {string} message - shown when the value is out of range
 * @returns {number}
 */
function parseInteger(value, min, max, message) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ActionError('invalid-settings', message);
  return /** @type {number} */ (value);
}

/** @param {unknown} value @param {string} message @returns {boolean} */
function parseFlag(value, message) {
  if (typeof value !== 'boolean') throw new ActionError('invalid-settings', message);
  return value;
}

/**
 * Options the host picks before a game. Immutable: changes produce a new instance.
 *
 * `game` picks which game is played. The other options belong to one game each and are
 * kept while another game is chosen: `cardsPerPlayer` is the Old Maid deal size;
 * `mafiaCount`, `doctor`, `detective` and `dayMinutes` set up Mafia. Future rule options
 * (how many cards per turn, skips, showing or hiding hands, piles on or off) belong here too.
 */
class GameSettings {
  /**
   * @param {object} [options]
   * @param {string} [options.game] - one of GAME_TYPES
   * @param {number} [options.cardsPerPlayer] - Old Maid: DEAL_ALL (0) deals the whole deck
   * @param {number} [options.mafiaCount] - Mafia: AUTO_MAFIA (0) or 1 to MAX_MAFIA
   * @param {boolean} [options.doctor] - Mafia: deal a Doctor
   * @param {boolean} [options.detective] - Mafia: deal a Detective
   * @param {number} [options.dayMinutes] - Mafia: how long each day lasts
   */
  constructor({
    game = GameType.OLD_MAID,
    cardsPerPlayer = DEAL_ALL,
    mafiaCount = AUTO_MAFIA,
    doctor = true,
    detective = true,
    dayMinutes = DEFAULT_DAY_MINUTES,
  } = {}) {
    this.game = GameSettings.parseGame(game);
    this.cardsPerPlayer = GameSettings.parseCardsPerPlayer(cardsPerPlayer);
    this.mafiaCount = parseInteger(
      mafiaCount, AUTO_MAFIA, MAX_MAFIA, `Mafia members must be a whole number from 1 to ${MAX_MAFIA}, or "auto".`,
    );
    this.doctor = parseFlag(doctor, 'Doctor must be on or off.');
    this.detective = parseFlag(detective, 'Detective must be on or off.');
    this.dayMinutes = parseInteger(
      dayMinutes, MIN_DAY_MINUTES, MAX_DAY_MINUTES, `A day lasts ${MIN_DAY_MINUTES} to ${MAX_DAY_MINUTES} minutes.`,
    );
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
    return parseInteger(
      value, DEAL_ALL, MAX_CARDS_PER_PLAYER, `Cards per player must be a whole number from 1 to ${MAX_CARDS_PER_PLAYER}, or "all".`,
    );
  }

  /**
   * @param {unknown} changes - untrusted settings from the client; unknown keys are ignored
   * @returns {GameSettings}
   */
  with(changes) {
    if (typeof changes !== 'object' || changes === null) {
      throw new ActionError('invalid-settings', 'Settings must be an object.');
    }
    const {
      game = this.game,
      cardsPerPlayer = this.cardsPerPlayer,
      mafiaCount = this.mafiaCount,
      doctor = this.doctor,
      detective = this.detective,
      dayMinutes = this.dayMinutes,
    } = changes;
    return new GameSettings({ game, cardsPerPlayer, mafiaCount, doctor, detective, dayMinutes });
  }

  get dealsAll() {
    return this.cardsPerPlayer === DEAL_ALL;
  }

  toJSON() {
    const { game, cardsPerPlayer, mafiaCount, doctor, detective, dayMinutes } = this;
    return { game, cardsPerPlayer, mafiaCount, doctor, detective, dayMinutes };
  }
}

module.exports = {
  GameSettings,
  GameType,
  GAME_TYPES,
  DEAL_ALL,
  MAX_CARDS_PER_PLAYER,
  AUTO_MAFIA,
  MAX_MAFIA,
  MIN_DAY_MINUTES,
  MAX_DAY_MINUTES,
};
