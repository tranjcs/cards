'use strict';

const { Card, Suit } = require('../cards/Card');
const { Deck, STANDARD_DECK_SIZE } = require('../cards/Deck');
const { CardGame } = require('./CardGame');
const { GameSettings } = require('./GameSettings');
const { ActionError } = require('../errors');
const { randomInt } = require('../random');

/** Taken out of the 52-card deck so one queen can never be paired: the "old maid". */
const REMOVED_CARD = new Card('Q', Suit.CLUBS);
const DECK_SIZE = STANDARD_DECK_SIZE - 1; // 51

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const DISCARD_PREVIEW = 2;
const LOG_PREVIEW = 8;

/** Why a game ended. */
const EndReason = Object.freeze({
  OLD_MAID: 'old-maid', // one player is left holding the unmatched queen
  NOT_ENOUGH_PLAYERS: 'not-enough-players', // everyone else left
});

/**
 * Old Maid.
 *
 * One queen is removed from a standard deck, so the remaining odd queen can never be
 * paired. Cards are dealt clockwise from a random first player; anything not dealt
 * becomes the draw pile. Everyone discards their pairs. On your turn you take one
 * hidden card from the next player clockwise who still has cards, or the top card of
 * the draw pile, and discard any pair it makes. When the draw pile is empty, players
 * with no cards are safe. The last player holding a card (the odd queen) loses.
 */
class OldMaidGame extends CardGame {
  static MIN_PLAYERS = MIN_PLAYERS;
  static MAX_PLAYERS = MAX_PLAYERS;
  static DECK_SIZE = DECK_SIZE;
  static REMOVED_CARD = REMOVED_CARD;

  /** @param {number} playerCount @returns {number} largest even deal for this many players */
  static maxCardsPerPlayer(playerCount) {
    return Math.floor(DECK_SIZE / Math.max(playerCount, 1));
  }

  /**
   * @param {object} options
   * @param {string[]} options.playerIds - clockwise seating order
   * @param {GameSettings} [options.settings]
   * @param {import('../random').Rng} [options.rng]
   */
  constructor({ playerIds, settings = new GameSettings(), rng }) {
    super({ playerIds, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, rng });
    this.settings = settings;
    /** @type {string[]} players who got rid of all their cards, in order */
    this.safe = [];
    /**
     * The latest draw. `card` is private: only the two players involved see it.
     * @type {{ playerId: string, fromId: string|null, card: Card }|null}
     */
    this.lastDraw = null;

    const deck = Deck.standard();
    deck.remove((card) => card.equals(REMOVED_CARD));
    this.drawPile = deck.shuffle(this.rng);
    this.deal(this.cardsPerPlayer);
    this.record({ kind: 'start', playerId: this.turnOrder.current });
    for (const id of this.playerIds) this.discardPairs(id);
    this.settle();
  }

  /** Cards dealt to each player; the setting is capped to what the deck allows. */
  get cardsPerPlayer() {
    const max = OldMaidGame.maxCardsPerPlayer(this.hands.size);
    return this.settings.dealsAll ? Infinity : Math.min(this.settings.cardsPerPlayer, max);
  }

  /** @param {string} id */
  hasCards(id) {
    return !this.handOf(id).isEmpty;
  }

  /** A player still in play: they hold cards, or can still draw from the pile. */
  isActive(id) {
    return this.hasCards(id) || !this.drawPile.isEmpty;
  }

  /** @returns {string|null} who `id` takes a card from: the next player clockwise with cards */
  targetFor(id) {
    return this.turnOrder.nextAfter(id, (other) => this.hasCards(other));
  }

  /**
   * Takes a hidden card from the target player. Their cards are shuffled first, so
   * `index` is a blind pick.
   * @param {string} id
   * @param {unknown} index - position among the target's face-down cards (untrusted)
   */
  drawFromPlayer(id, index) {
    this.assertTurn(id);
    const targetId = this.targetFor(id);
    if (!targetId) throw new ActionError('no-target', 'Nobody has cards to take from.');
    const targetHand = this.handOf(targetId);
    if (!Number.isInteger(index) || index < 0 || index >= targetHand.size) {
      throw new ActionError('invalid-card', 'Pick one of their cards.');
    }
    this.take(id, targetId, targetHand.takeRandom(this.rng));
  }

  /** @param {string} id */
  drawFromPile(id) {
    this.assertTurn(id);
    if (this.drawPile.isEmpty) throw new ActionError('empty-pile', 'The draw pile is empty.');
    this.take(id, null, this.drawPile.draw());
  }

  /** Random legal move: usually from the next player, otherwise from the pile. */
  autoPlay(id) {
    const targetId = this.targetFor(id);
    const preferPile = !this.drawPile.isEmpty && (!targetId || randomInt(2, this.rng) === 0);
    if (preferPile) this.drawFromPile(id);
    else this.drawFromPlayer(id, 0);
  }

  /** Their cards go to the next player clockwise, who discards any new pairs. */
  removePlayer(id) {
    if (!this.isSeated(id)) return;
    const cards = this.handOf(id).takeAll();
    const heirId = this.turnOrder.nextAfter(id);
    this.turnOrder.remove(id);
    this.hands.delete(id);
    this.safe = this.safe.filter((safeId) => safeId !== id);
    if (this.lastDraw && [this.lastDraw.playerId, this.lastDraw.fromId].includes(id)) this.lastDraw = null;
    this.record({ kind: 'left', playerId: id, toId: cards.length ? heirId : null });
    if (this.isOver) return;
    if (heirId && cards.length) {
      this.handOf(heirId).add(...cards);
      this.discardPairs(heirId);
    }
    this.settle();
  }

  /** @private */
  take(id, fromId, card) {
    this.handOf(id).add(card);
    this.lastDraw = { playerId: id, fromId, card };
    this.record({ kind: 'draw', playerId: id, fromId });
    this.discardPairs(id);
    this.turnCount += 1;
    this.turnOrder.advance((other) => this.isActive(other));
    this.settle();
  }

  /** @private */
  discardPairs(id) {
    for (const pair of this.handOf(id).removePairs()) {
      this.discardPile.push(...pair);
      this.record({ kind: 'pair', playerId: id, cards: pair });
    }
  }

  /** @private Marks newly safe players, ends the game if it's decided, and fixes the turn. */
  settle() {
    if (this.isOver) return;
    for (const id of this.playerIds) {
      if (!this.isActive(id) && !this.safe.includes(id)) {
        this.safe.push(id);
        this.record({ kind: 'safe', playerId: id });
      }
    }
    const holders = this.playerIds.filter((id) => this.hasCards(id));
    if (this.playerIds.length < MIN_PLAYERS) {
      this.end(null, EndReason.NOT_ENOUGH_PLAYERS);
    } else if (this.drawPile.isEmpty && holders.length <= 1) {
      this.end(holders[0] ?? null, EndReason.OLD_MAID);
    } else {
      this.turnOrder.settle((other) => this.isActive(other));
    }
  }

  viewFor(viewerId, nameOf) {
    const seated = viewerId !== null && this.isSeated(viewerId);
    const current = this.currentPlayerId;
    const myTurn = seated && current === viewerId;
    const targetId = myTurn ? this.targetFor(viewerId) : null;
    const loserId = this.result?.loserId ?? null;

    return {
      seats: this.playerIds.map((id) => ({
        name: nameOf(id),
        cardCount: this.handOf(id).size,
        isYou: id === viewerId,
        isTurn: id === current,
        isTarget: id === targetId,
        isSafe: this.safe.includes(id),
        isLoser: id === loserId,
        // The loser's last card is revealed to everyone at the end.
        hand: id === loserId ? this.handOf(id).toJSON() : null,
      })),
      isPlaying: seated,
      hand: seated ? this.handOf(viewerId).toJSON() : null,
      turn: current ? nameOf(current) : null,
      isYourTurn: myTurn,
      target: targetId ? { name: nameOf(targetId), cardCount: this.handOf(targetId).size } : null,
      canDrawFromPile: myTurn && !this.drawPile.isEmpty,
      drawPile: { count: this.drawPile.size },
      discardPile: {
        count: this.discardPile.size,
        top: this.discardPile.peek(DISCARD_PREVIEW).map((card) => card.toJSON()),
      },
      lastDraw: this.lastDrawFor(viewerId, nameOf),
      log: this.log.slice(-LOG_PREVIEW).map((entry) => describe(entry, nameOf)),
      safe: this.safe.map(nameOf),
      result: this.result && {
        reason: this.result.reason,
        loser: loserId ? nameOf(loserId) : null,
        youLost: loserId !== null && loserId === viewerId,
      },
    };
  }

  /** @private Only the drawer and the player who lost the card learn what it was. */
  lastDrawFor(viewerId, nameOf) {
    const draw = this.lastDraw;
    if (!draw || viewerId === null) return null;
    const { playerId, fromId, card } = draw;
    if (viewerId === playerId) {
      return { you: 'took', card: card.toJSON(), from: fromId ? nameOf(fromId) : null };
    }
    if (viewerId === fromId) {
      return { you: 'lost', card: card.toJSON(), to: nameOf(playerId) };
    }
    return null;
  }
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
    case 'draw':
      return entry.fromId
        ? `${who} took a card from ${nameOf(entry.fromId)}.`
        : `${who} drew from the draw pile.`;
    case 'pair':
      return `${who} discarded a pair: ${entry.cards.map(String).join(' ')}.`;
    case 'safe':
      return `${who} is out of cards — safe!`;
    case 'left':
      return entry.toId ? `${who} left; their cards went to ${nameOf(entry.toId)}.` : `${who} left.`;
    case 'game-over':
      return entry.reason === EndReason.OLD_MAID && who
        ? `${who} is stuck with the Old Maid!`
        : 'Game over: not enough players.';
    default:
      return '';
  }
}

module.exports = { OldMaidGame, EndReason };
