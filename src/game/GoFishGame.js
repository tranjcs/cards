'use strict';

const { Deck } = require('../cards/Deck');
const { RANKS } = require('../cards/Card');
const { CardGame } = require('./CardGame');
const { GameSettings } = require('./GameSettings');
const { ActionError } = require('../errors');
const { randomInt } = require('../random');

const DECK_SIZE = 52;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const BOOK_SIZE = 4;
const LOG_PREVIEW = 8;

/** Why a game ended. */
const EndReason = Object.freeze({
  BOOKS: 'books', // every card is in a book
  NOT_ENOUGH_PLAYERS: 'not-enough-players', // everyone else left
});

/**
 * Go Fish.
 *
 * Each player is dealt 7 cards (5 with four or more players); the rest form the draw
 * pile. On your turn, ask another player for a rank you hold. If they have any, they
 * hand them all over and you go again. If not, "go fish": draw from the pile, and if
 * you draw the rank you asked for, you go again. Four of a kind make a book, laid
 * down automatically. A player with no cards draws one at the start of their turn,
 * and is out once the pile is empty too. When every card is in a book, whoever has
 * the most books wins (ties share the win).
 */
class GoFishGame extends CardGame {
  static MIN_PLAYERS = MIN_PLAYERS;
  static MAX_PLAYERS = MAX_PLAYERS;
  static DECK_SIZE = DECK_SIZE;

  /** @param {number} playerCount @returns {number} the standard deal */
  static standardDeal(playerCount) {
    return playerCount <= 3 ? 7 : 5;
  }

  /**
   * @param {object} options
   * @param {string[]} options.playerIds - clockwise seating order
   * @param {GameSettings} [options.settings] - nothing is configurable yet
   * @param {import('../random').Rng} [options.rng]
   */
  constructor({ playerIds, settings = new GameSettings(), rng }) {
    super({ playerIds, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, rng });
    this.settings = settings;
    /** @type {Map<string, string[]>} player id -> ranks of their books, in the order made */
    this.books = new Map(playerIds.map((id) => [id, []]));
    /**
     * The latest card fished from the pile. `card` is private to the player who drew it
     * unless it was the rank they asked for (then they show it).
     * @type {{ playerId: string, card: import('../cards/Card').Card }|null}
     */
    this.lastFish = null;

    this.drawPile = Deck.standard().shuffle(this.rng);
    this.deal(this.cardsPerPlayer);
    this.record({ kind: 'start', playerId: this.turnOrder.current });
    for (const id of this.playerIds) this.layDownBooks(id);
    this.settle();
  }

  /** Cards dealt to each player: 7, or 5 with four or more players. */
  get cardsPerPlayer() {
    return GoFishGame.standardDeal(this.hands.size);
  }

  /** @param {string} id */
  hasCards(id) {
    return !this.handOf(id).isEmpty;
  }

  /** Still in play: holds cards, or can draw from the pile. */
  isActive(id) {
    return this.hasCards(id) || !this.drawPile.isEmpty;
  }

  /** @param {string} id @returns {string[]} the other players `id` may ask: those holding cards */
  targetsFor(id) {
    return this.playerIds.filter((other) => other !== id && this.hasCards(other));
  }

  /**
   * Asks another player for every card of a rank.
   * @param {string} id
   * @param {unknown} request - untrusted `{ seat, rank }`; `seat` indexes `playerIds`
   */
  ask(id, request) {
    this.assertTurn(id);
    const { seat, rank } = typeof request === 'object' && request !== null ? request : {};
    const targetId = Number.isInteger(seat) ? this.playerIds[seat] : undefined;
    if (!targetId || !this.targetsFor(id).includes(targetId)) {
      throw new ActionError('invalid-target', 'Ask another player who has cards.');
    }
    if (typeof rank !== 'string' || !RANKS.includes(rank) || !this.handOf(id).hasRank(rank)) {
      throw new ActionError('invalid-rank', 'You can only ask for a rank you hold.');
    }

    const given = this.handOf(targetId).takeRank(rank);
    this.record({ kind: 'ask', playerId: id, fromId: targetId, rank, count: given.length });
    this.lastFish = null;
    let goAgain = given.length > 0;
    if (goAgain) {
      this.handOf(id).add(...given);
    } else {
      goAgain = this.fish(id, rank);
    }
    this.finishTurn(id, goAgain);
  }

  /**
   * Draws from the pile when there's nobody to ask (everyone else is out of cards).
   * @param {string} id
   */
  goFish(id) {
    this.assertTurn(id);
    if (this.targetsFor(id).length > 0) throw new ActionError('must-ask', 'Ask another player for a card.');
    if (this.drawPile.isEmpty) throw new ActionError('empty-pile', 'The draw pile is empty.');
    this.lastFish = null;
    this.fish(id, null);
    this.finishTurn(id, false);
  }

  /** Random legal move: ask a random player for a random rank you hold. */
  autoPlay(id) {
    const targets = this.targetsFor(id);
    if (targets.length === 0) {
      this.goFish(id);
      return;
    }
    const ranks = this.handOf(id).ranks;
    const targetId = targets[randomInt(targets.length, this.rng)];
    this.ask(id, { seat: this.playerIds.indexOf(targetId), rank: ranks[randomInt(ranks.length, this.rng)] });
  }

  /** Their cards go to the next player clockwise; their books leave with them. */
  removePlayer(id) {
    if (!this.isSeated(id)) return;
    const cards = this.handOf(id).takeAll();
    const heirId = this.turnOrder.nextAfter(id);
    this.turnOrder.remove(id);
    this.hands.delete(id);
    this.books.delete(id);
    if (this.lastFish?.playerId === id) this.lastFish = null;
    this.record({ kind: 'left', playerId: id, toId: cards.length ? heirId : null });
    if (this.isOver) return;
    if (heirId && cards.length) {
      this.handOf(heirId).add(...cards);
      this.layDownBooks(heirId);
    }
    this.settle();
  }

  /** @param {string} id @returns {string[]} */
  booksOf(id) {
    return this.books.get(id) ?? [];
  }

  /**
   * @private Draws one card. Returns whether it was the rank asked for.
   * @param {string} id
   * @param {string|null} askedRank
   */
  fish(id, askedRank) {
    const card = this.drawPile.draw();
    if (!card) {
      this.record({ kind: 'fish-empty', playerId: id });
      return false;
    }
    this.handOf(id).add(card);
    const lucky = askedRank !== null && card.rank === askedRank;
    this.lastFish = { playerId: id, card };
    this.record({ kind: 'fish', playerId: id, card: lucky ? card : null });
    return lucky;
  }

  /** @private */
  finishTurn(id, goAgain) {
    this.layDownBooks(id);
    this.turnCount += 1;
    if (!goAgain || !this.isActive(id)) this.turnOrder.advance((other) => this.isActive(other));
    this.settle();
  }

  /** @private */
  layDownBooks(id) {
    for (const book of this.handOf(id).removeSets(BOOK_SIZE)) {
      this.discardPile.push(...book);
      this.books.get(id).push(book[0].rank);
      this.record({ kind: 'book', playerId: id, rank: book[0].rank });
    }
  }

  /** @private Ends the game if it's decided; otherwise fixes the turn and refills an empty hand. */
  settle() {
    if (this.isOver) return;
    if (this.playerIds.length < MIN_PLAYERS) {
      this.endGame(EndReason.NOT_ENOUGH_PLAYERS);
      return;
    }
    if (!this.playerIds.some((id) => this.isActive(id))) {
      this.endGame(EndReason.BOOKS);
      return;
    }
    const current = this.turnOrder.settle((other) => this.isActive(other));
    if (current && !this.hasCards(current)) {
      // A player with no cards draws one to start their turn.
      this.handOf(current).add(this.drawPile.draw());
      this.record({ kind: 'refill', playerId: current });
    }
  }

  /** @private */
  endGame(reason) {
    let winnerIds = [];
    if (reason === EndReason.BOOKS) {
      const most = Math.max(...this.playerIds.map((id) => this.booksOf(id).length));
      winnerIds = this.playerIds.filter((id) => this.booksOf(id).length === most);
    }
    this.result = { reason, loserId: null, winnerIds };
    this.record({ kind: 'game-over', reason, winnerIds });
  }

  viewFor(viewerId, nameOf) {
    const seated = viewerId !== null && this.isSeated(viewerId);
    const current = this.currentPlayerId;
    const myTurn = seated && current === viewerId;
    const targets = new Set(myTurn ? this.targetsFor(viewerId) : []);
    const winnerIds = this.result?.winnerIds ?? [];

    return {
      type: 'go-fish',
      seats: this.playerIds.map((id, seat) => ({
        seat,
        name: nameOf(id),
        cardCount: this.handOf(id).size,
        books: [...this.booksOf(id)],
        isYou: id === viewerId,
        isTurn: id === current,
        isTarget: targets.has(id),
        isOut: !this.isOver && !this.isActive(id),
        isWinner: winnerIds.includes(id),
      })),
      isPlaying: seated,
      hand: seated ? this.handOf(viewerId).toJSON() : null,
      turn: current ? nameOf(current) : null,
      isYourTurn: myTurn,
      askableRanks: myTurn && targets.size ? this.handOf(viewerId).ranks : [],
      canGoFish: myTurn && targets.size === 0 && !this.drawPile.isEmpty,
      drawPile: { count: this.drawPile.size },
      lastFish: this.lastFish && this.lastFish.playerId === viewerId ? this.lastFish.card.toJSON() : null,
      log: this.log.slice(-LOG_PREVIEW).map((entry) => describe(entry, nameOf)),
      result: this.result && {
        reason: this.result.reason,
        winners: winnerIds.map(nameOf),
        youWon: seated && winnerIds.includes(viewerId),
      },
    };
  }
}

const RANK_NAMES = Object.freeze({ A: 'aces', J: 'jacks', Q: 'queens', K: 'kings' });

/** "sevens", "kings" */
function rankName(rank) {
  if (RANK_NAMES[rank]) return RANK_NAMES[rank];
  return rank === '6' ? 'sixes' : `${rank}s`;
}

/**
 * Turns a log entry into a sentence. Entries never hold private cards.
 * @param {object} entry
 * @param {(id: string) => string} nameOf
 */
function describe(entry, nameOf) {
  const who = entry.playerId ? nameOf(entry.playerId) : '';
  switch (entry.kind) {
    case 'start':
      return `Cards dealt. ${who} goes first.`;
    case 'ask':
      return entry.count
        ? `${who} asked ${nameOf(entry.fromId)} for ${rankName(entry.rank)} and got ${entry.count}.`
        : `${who} asked ${nameOf(entry.fromId)} for ${rankName(entry.rank)}. Go fish!`;
    case 'fish':
      return entry.card ? `${who} fished the ${String(entry.card)} they asked for and goes again!` : `${who} drew from the pile.`;
    case 'fish-empty':
      return `${who} would go fish, but the pile is empty.`;
    case 'refill':
      return `${who} was out of cards and drew one.`;
    case 'book':
      return `${who} made a book of ${rankName(entry.rank)}.`;
    case 'left':
      return entry.toId ? `${who} left; their cards went to ${nameOf(entry.toId)}.` : `${who} left.`;
    case 'game-over':
      if (entry.reason !== EndReason.BOOKS) return 'Game over: not enough players.';
      return entry.winnerIds.length > 1
        ? `Game over! Tie between ${entry.winnerIds.map(nameOf).join(' and ')}.`
        : `Game over! ${nameOf(entry.winnerIds[0])} wins.`;
    default:
      return '';
  }
}

module.exports = { GoFishGame, EndReason, rankName };
