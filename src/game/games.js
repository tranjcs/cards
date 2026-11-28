'use strict';

const { GameType } = require('../constants');
const { OldMaidGame } = require('./OldMaidGame');
const { MafiaGame } = require('./MafiaGame');

/**
 * Every game the host can pick, by GameType. Each is a CardGame subclass with static
 * TYPE, TITLE, MIN_PLAYERS, MAX_PLAYERS and optionLimits(playerCount).
 */
const GAMES = Object.freeze({
  [GameType.OLD_MAID]: OldMaidGame,
  [GameType.MAFIA]: MafiaGame,
});

module.exports = { GAMES };
