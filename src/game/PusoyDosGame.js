'use strict';

const { Deck } = require('../cards/Deck');
const { CardGame } = require('./CardGame');
const { GameSettings } = require('./GameSettings');
const { ActionError } = require('../errors');
const { identify, beats, compareCards, COMBO_NAMES } = require('./pusoyDosCombos');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const LOG_PREVIEW = 8;
const MAX_PLAY_SIZE = 5;

/** Why a game ended. */
const EndReason = Object.freeze({
  WON: 'won', // a player got rid of all their cards
  NOT_ENOUGH_PLAYERS: 'not-enough-players', // everyone else left
});

/**
 * Pusoy Dos ("Big Two").
 *
 * Cards rank 3 (lowest) to 2 (highest); suits rank clubs, spades, hearts, diamonds.
 * Each player gets 13 cards (17 with three players); the rest are set aside unseen.
 * Whoever holds the lowest card dealt (the 3♣ with four players) leads first, and that
 * first play must include it. A play is a single, a pair, three of a kind or a poker
 * hand of five cards. Going clockwise, each player either beats the cards on the table
 * with a higher play of the same size, or passes. A player who passed may play again
 * when their turn comes back round. When everyone else passes in a row, the last
 * player to play clears the table and leads anything. The first player to get rid of
 * all their cards wins.
 */
class PusoyDosGame extends CardGame {
  static MIN_PLAYERS = MIN_PLAYERS;
  static MAX_PLAYERS = MAX_PLAYERS;

  /** @param {number} playerCount @returns {number} cards dealt to each player */
  static cardsPerPlayer(playerCount) {
    return playerCount === 3 ? 17 : 13;
  }

  /**
   * @param {object} options
   * @param {string[]} options.playerIds - clockwise seating order
   * @param {GameSettings} [options.settings] - nothing is configurable yet
   * @param {import('../random').Rng} [options.rng]
   */
  constructor({ playerIds, settings = new GameSettings(), rng }) {
    super({ playerIds, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, rng, handOrder: compareCards });
    this.settings = settings;
    /**
     * The play on the table, which the next play must beat. Null when the table is clear.
     * @type {{ playerId: string, cards: import('../cards/Card').Card[], combo: ReturnType<typeof identify> }|null}
     */
    this.trick = null;
    /** @type {Set<string>} players who passed since the last play */
    this.passed = new Set();

    // The undealt cards stay in the draw pile, face down and out of play.
    this.drawPile = Deck.standard().shuffle(this.rng);
    this.deal(PusoyDosGame.cardsPerPlayer(this.hands.size));

    const lowest = this.playerIds
      .map((id) => ({ id, card: this.handOf(id).cards[0] }))
      .sort((a, b) => compareCards(a.card, b.card))[0];
    /** @type {import('../cards/Card').Card|null} the card the opening play must include */
    this.openingCard = lowest.card;
    this.turnOrder.currentIndex = this.playerIds.indexOf(lowest.id);
    this.record({ kind: 'start', playerId: lowest.id, card: lowest.card });
  }

  /** Cards set aside at the deal. */
  get setAsideCount() {
    return this.drawPile.size;
  }

  /**
   * Plays cards from the player's hand onto the table.
   * @param {string} id
   * @param {unknown} cardIds - ids of the cards to play (untrusted)
   */
  play(id, cardIds) {
    this.assertTurn(id);
    const hand = this.handOf(id);
    if (
      !Array.isArray(cardIds) ||
      cardIds.length === 0 ||
      cardIds.length > MAX_PLAY_SIZE ||
      !cardIds.every((cardId) => typeof cardId === 'string') ||
      new Set(cardIds).size !== cardIds.length
    ) {
      throw new ActionError('invalid-cards', 'Pick 1, 2, 3 or 5 of your cards to play.');
    }
    const cards = hand.findAll(cardIds);
    if (!cards) throw new ActionError('invalid-cards', "You don't have those cards.");
    if (this.trick && cards.length !== this.trick.combo.size) {
      const n = this.trick.combo.size;
      throw new ActionError('wrong-size', `Play ${n} ${n === 1 ? 'card' : 'cards'} to beat the table, or pass.`);
    }
    const combo = identify(cards);
    if (!combo) {
      throw new ActionError(
        'invalid-combo',
        'Play a single, a pair, three of a kind, or five cards: a straight, flush, full house, four of a kind or straight flush.',
      );
    }
    if (this.openingCard && !cards.includes(this.openingCard)) {
      throw new ActionError('must-open', `The first play must include the ${this.openingCard}.`);
    }
    if (this.trick && !beats(combo, this.trick.combo)) {
      throw new ActionError('too-low', `That doesn't beat the ${COMBO_NAMES[this.trick.combo.type]} on the table.`);
    }

    hand.removeAll(cards);
    this.clearTable();
    this.trick = { playerId: id, cards: [...cards].sort(compareCards), combo };
    this.openingCard = null;
    this.record({ kind: 'play', playerId: id, cards: this.trick.cards, type: combo.type });
    this.turnCount += 1;
    if (hand.isEmpty) {
      this.finish(id, EndReason.WON);
      return;
    }
    this.turnOrder.advance();
    this.settle();
  }

  /** @param {string} id */
  pass(id) {
    this.assertTurn(id);
    if (!this.trick) throw new ActionError('must-lead', "You're leading, so you have to play something.");
    this.passed.add(id);
    this.record({ kind: 'pass', playerId: id });
    this.turnCount += 1;
    this.turnOrder.advance();
    this.settle();
  }

  /** Passes if possible; otherwise leads the lowest card (the opening card on the first turn). */
  autoPlay(id) {
    if (this.trick) {
      this.pass(id);
      return;
    }
    const card = this.openingCard ?? this.handOf(id).cards[0];
    this.play(id, [card.id]);
  }

  /** Their cards are set aside; if the table was theirs, the next player leads. */
  removePlayer(id) {
    if (!this.isSeated(id)) return;
    const cards = this.handOf(id).takeAll();
    if (this.openingCard && cards.includes(this.openingCard)) this.openingCard = null;
    this.drawPile.push(...cards);
    this.turnOrder.remove(id);
    this.hands.delete(id);
    this.passed.delete(id);
    this.record({ kind: 'left', playerId: id });
    if (this.isOver) return;
    if (this.trick?.playerId === id) {
      this.clearTable();
      this.record({ kind: 'cleared' });
    }
    if (this.playerIds.length < MIN_PLAYERS) {
      this.finish(null, EndReason.NOT_ENOUGH_PLAYERS);
      return;
    }
    this.settle();
  }

  /** @private When the turn comes back to whoever played last, everyone else passed. */
  settle() {
    if (this.trick && this.turnOrder.current === this.trick.playerId) {
      this.record({ kind: 'won-round', playerId: this.trick.playerId });
      this.clearTable();
    }
  }

  /** @private Moves the cards on the table to the discard pile. */
  clearTable() {
    if (this.trick) this.discardPile.push(...this.trick.cards);
    this.trick = null;
    this.passed.clear();
  }

  /** @private */
  finish(winnerId, reason) {
    this.result = { winnerId, loserId: null, reason };
    this.record({ kind: 'game-over', playerId: winnerId, reason });
  }

  viewFor(viewerId, nameOf) {
    const seated = viewerId !== null && this.isSeated(viewerId);
    const current = this.currentPlayerId;
    const myTurn = seated && current === viewerId;
    const winnerId = this.result?.winnerId ?? null;
    const over = this.isOver;
    const trick = this.trick;

    return {
      type: 'pusoy-dos',
      seats: this.playerIds.map((id) => ({
        name: nameOf(id),
        cardCount: this.handOf(id).size,
        isYou: id === viewerId,
        isTurn: id === current,
        hasPassed: this.passed.has(id),
        isLeader: trick?.playerId === id,
        isWinner: id === winnerId,
        // Everyone's leftover cards are shown once the game is over.
        hand: over ? this.handOf(id).toJSON() : null,
      })),
      isPlaying: seated,
      hand: seated ? this.handOf(viewerId).toJSON() : null,
      turn: current ? nameOf(current) : null,
      isYourTurn: myTurn,
      table: trick && {
        by: nameOf(trick.playerId),
        byYou: trick.playerId === viewerId,
        type: trick.combo.type,
        name: COMBO_NAMES[trick.combo.type],
        cards: trick.cards.map((card) => card.toJSON()),
      },
      canPass: myTurn && trick !== null,
      mustInclude: this.openingCard && !over ? this.openingCard.toJSON() : null,
      setAside: this.setAsideCount,
      discardPile: { count: this.discardPile.size },
      log: this.log.slice(-LOG_PREVIEW).map((entry) => describe(entry, nameOf)),
      result: this.result && {
        reason: this.result.reason,
        winner: winnerId ? nameOf(winnerId) : null,
        youWon: winnerId !== null && winnerId === viewerId,
      },
    };
  }
}

/**
 * Turns a log entry into a sentence.
 * @param {object} entry
 * @param {(id: string) => string} nameOf
 */
function describe(entry, nameOf) {
  const who = entry.playerId ? nameOf(entry.playerId) : '';
  switch (entry.kind) {
    case 'start':
      return `Cards dealt. ${who} has the ${entry.card} and leads.`;
    case 'play':
      return `${who} played ${entry.type === 'single' ? '' : `a ${COMBO_NAMES[entry.type]}: `}${entry.cards.map(String).join(' ')}.`;
    case 'pass':
      return `${who} passed.`;
    case 'won-round':
      return `Everyone passed. ${who} leads.`;
    case 'cleared':
      return 'The table was cleared.';
    case 'left':
      return `${who} left; their cards were set aside.`;
    case 'game-over':
      return entry.reason === EndReason.WON ? `${who} is out of cards and wins! 🏆` : 'Game over: not enough players.';
    default:
      return '';
  }
}

module.exports = { PusoyDosGame, EndReason };
