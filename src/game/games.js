'use strict';

const { GameType } = require('../constants');
const { OldMaidGame } = require('./OldMaidGame');
const { GoFishGame } = require('./GoFishGame');

/**
 * The games the room can host, by GameType. Each class provides MIN_PLAYERS,
 * MAX_PLAYERS and maxCardsPerPlayer(playerCount).
 */
const GAMES = Object.freeze({
  [GameType.OLD_MAID]: { name: 'Old Maid', Game: OldMaidGame, standardDeal: 'All cards (classic)' },
  [GameType.GO_FISH]: { name: 'Go Fish', Game: GoFishGame, standardDeal: 'Standard (7, or 5 with 4+ players)' },
});

/** @param {string} type */
function gameInfo(type) {
  const info = GAMES[type];
  if (!info) throw new RangeError(`Unknown game: ${type}`);
  return info;
}

module.exports = { GAMES, gameInfo };
