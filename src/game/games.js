'use strict';

const { OldMaidGame } = require('./OldMaidGame');
const { PusoyDosGame } = require('./PusoyDosGame');
const { GoFishGame } = require('./GoFishGame');
const { MafiaGame } = require('./MafiaGame');
const { GameType } = require('./GameSettings');

/**
 * The games the host can pick, by `GameSettings.game`. Each class extends CardGame
 * and has static MIN_PLAYERS and MAX_PLAYERS.
 */
const GAMES = Object.freeze({
  [GameType.OLD_MAID]: { title: 'Old Maid', Game: OldMaidGame },
  [GameType.PUSOY_DOS]: { title: 'Pusoy Dos', Game: PusoyDosGame },
  [GameType.GO_FISH]: { title: 'Go Fish', Game: GoFishGame },
  [GameType.MAFIA]: { title: 'Mafia', Game: MafiaGame },
});

/**
 * @param {string} type
 * @returns {{ title: string, Game: typeof OldMaidGame | typeof PusoyDosGame | typeof GoFishGame | typeof MafiaGame }}
 */
function gameFor(type) {
  return GAMES[type];
}

module.exports = { GAMES, gameFor };
