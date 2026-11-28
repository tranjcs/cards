'use strict';

const { Hand } = require('../cards/Hand');
const { Pile } = require('../cards/Pile');
const { TurnOrder } = require('./TurnOrder');
const { ActionError } = require('../errors');
const { randomInt, secureRandom } = require('../random');

const LOG_LIMIT = 50;

/**
 * Shared machinery for card games: seats in clockwise order with a random first player,
 * a hand per player, a draw pile and a discard pile, and a public log. Pure logic, no
 * networking or timers: the room runs the countdown described by `timerKey` and
 * `timeLimitMs`, and calls `timeOut()` when it runs out. Subclasses implement the rules.
 *
 * By default the game is turn-based: each turn is timed, and a player who runs out of
 * time gets a random legal move (`autoPlay`). Games without turns override the timing.
 */
class CardGame {
  /**
   * @param {object} options
   * @param {string[]} options.playerIds - clockwise seating order
   * @param {number} options.minPlayers
   * @param {number} options.maxPlayers
   * @param {import('../random').Rng} [options.rng]
   * @param {(a: import('../cards/Card').Card, b: import('../cards/Card').Card) => number} [options.handOrder]
   */
  constructor({ playerIds, minPlayers, maxPlayers, rng = secureRandom, handOrder }) {
    if (new Set(playerIds).size !== playerIds.length) throw new RangeError('Duplicate player ids');
    if (playerIds.length < minPlayers || playerIds.length > maxPlayers) {
      throw new ActionError(
        'player-count',
        `This game needs ${minPlayers} to ${maxPlayers} players (there are ${playerIds.length}).`,
      );
    }
    this.rng = rng;
    /** @type {Map<string, Hand>} */
    this.hands = new Map(playerIds.map((id) => [id, new Hand([], handOrder)]));
    this.turnOrder = new TurnOrder(playerIds, randomInt(playerIds.length, rng));
    this.drawPile = new Pile();
    this.discardPile = new Pile();
    /** @type {object[]} public events, oldest first */
    this.log = [];
    /** Increases with every completed turn; lets callers notice a new turn. */
    this.turnCount = 0;
    /** @type {{ reason: string, loserId: string|null }|null} set when the game ends */
    this.result = null;
  }

  /** @returns {string[]} seated player ids, clockwise */
  get playerIds() {
    return [...this.turnOrder.seats];
  }

  get currentPlayerId() {
    return this.isOver ? null : this.turnOrder.current;
  }

  get isOver() {
    return this.result !== null;
  }

  /** @param {string} id */
  isSeated(id) {
    return this.turnOrder.has(id);
  }

  /** @param {string} id @returns {Hand} */
  handOf(id) {
    const hand = this.hands.get(id);
    if (!hand) throw new ActionError('not-playing', "You're not playing in this game.");
    return hand;
  }

  /** @param {string} id */
  assertTurn(id) {
    if (this.isOver) throw new ActionError('game-over', 'The game is over.');
    this.handOf(id);
    if (this.turnOrder.current !== id) throw new ActionError('not-your-turn', "It's not your turn.");
  }

  /**
   * Deals from the draw pile one card at a time, clockwise from the first player.
   * @param {number} [perPlayer] - cards for each player; omit to deal every card
   */
  deal(perPlayer = Infinity) {
    const seats = this.turnOrder.seats;
    const start = this.turnOrder.currentIndex;
    for (let round = 0; round < perPlayer; round += 1) {
      for (let i = 0; i < seats.length; i += 1) {
        const card = this.drawPile.draw();
        if (!card) return;
        this.hands.get(seats[(start + i) % seats.length]).add(card);
      }
    }
  }

  /**
   * Names the step being timed (here, the current turn). The room restarts its countdown
   * whenever this changes.
   * @returns {string|null} null when nothing is timed
   */
  get timerKey() {
    return this.isOver ? null : `${this.turnCount}:${this.currentPlayerId}`;
  }

  /** @returns {number|null} how long the current step may take; null for the room's turn time */
  get timeLimitMs() {
    return null;
  }

  /**
   * The countdown ran out: plays a random legal move for whoever's turn it is.
   * @returns {string|null} the player who ran out of time, if it was one player's turn
   */
  timeOut() {
    const id = this.currentPlayerId;
    this.autoPlay(id);
    return id;
  }

  /** @param {object} entry - must not contain private information */
  record(entry) {
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) this.log.shift();
  }

  /**
   * @param {string|null} loserId
   * @param {string} reason
   */
  end(loserId, reason) {
    this.result = { loserId, reason };
    this.record({ kind: 'game-over', playerId: loserId, reason });
  }

  /**
   * Takes a player out of the game (they left or were kicked).
   * @abstract
   * @param {string} id
   */
  // eslint-disable-next-line no-unused-vars
  removePlayer(id) {
    throw new Error('removePlayer() must be implemented by a subclass');
  }

  /**
   * Plays a legal move for a player who ran out of time.
   * @abstract
   * @param {string} id
   */
  // eslint-disable-next-line no-unused-vars
  autoPlay(id) {
    throw new Error('autoPlay() must be implemented by a subclass');
  }

  /**
   * The game as seen by one person, with only what they're allowed to know.
   * @abstract
   * @param {string|null} viewerId - null or an unseated id for spectators
   * @param {(id: string) => string} nameOf
   * @param {(id: string) => string|null} [publicIdOf] - the id clients use to refer to a player
   */
  // eslint-disable-next-line no-unused-vars
  viewFor(viewerId, nameOf, publicIdOf) {
    throw new Error('viewFor() must be implemented by a subclass');
  }
}

module.exports = { CardGame };
