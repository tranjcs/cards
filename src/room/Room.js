'use strict';

const { Player } = require('./Player');
const { NameAllocator } = require('./NameAllocator');
const { KickVote } = require('./KickVote');
const { OldMaidGame } = require('../game/OldMaidGame');
const { GameSettings } = require('../game/GameSettings');
const { ActionError } = require('../errors');
const { Phase, KickReason } = require('../constants');

const DEFAULT_HOST_KICK_VOTES = 5;
const DEFAULT_TURN_TIMEOUT_MS = 30000;
const DEFAULT_MAX_MEMBERS = 50;
const DEFAULT_KICK_BAN_MS = 5 * 60 * 1000;
const ACTIVITY_LIMIT = 5;

/**
 * The single room everyone on the site joins.
 *
 * The first person in is the host; everyone else is a guest. When the host leaves,
 * the longest-connected guest becomes host. The host picks the settings, starts the
 * game and can kick anyone. Guests can vote to kick the host; it takes at least
 * `hostKickVotes` votes, counted once per IP address so one person with several tabs
 * can't outvote everyone. A kicked player's address can't rejoin for `kickBanMs`.
 * Everyone in the room when a game starts is dealt in (up to the game's maximum);
 * later arrivals watch until the next game.
 *
 * Independent of Socket.IO so it can be unit tested: `onChange` is called after every
 * change so the caller can push fresh state, and `onKick` to disconnect someone.
 */
class Room {
  /**
   * @param {object} options
   * @param {() => void} options.onChange
   * @param {(id: string, reason: string) => void} [options.onKick]
   * @param {number} [options.hostKickVotes] - votes needed to kick the host
   * @param {number} [options.turnTimeoutMs] - a player who takes longer gets a random move
   * @param {number} [options.maxMembers] - room capacity
   * @param {number} [options.kickBanMs] - how long a kicked player's address is refused; 0 for never
   * @param {boolean} [options.oneVotePerAddress] - count host-kick votes per IP address, not per tab
   * @param {import('../random').Rng} [options.rng]
   */
  constructor({
    onChange,
    onKick = () => {},
    hostKickVotes = DEFAULT_HOST_KICK_VOTES,
    turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
    maxMembers = DEFAULT_MAX_MEMBERS,
    kickBanMs = DEFAULT_KICK_BAN_MS,
    oneVotePerAddress = true,
    rng,
  }) {
    this.onChange = onChange;
    this.onKick = onKick;
    this.turnTimeoutMs = turnTimeoutMs;
    this.maxMembers = maxMembers;
    this.kickBanMs = kickBanMs;
    this.oneVotePerAddress = oneVotePerAddress;
    this.rng = rng;
    /** @type {Map<string, number>} address -> Date.now() until which it may not join */
    this.bans = new Map();
    /** @type {Map<string, Player>} by connection id, in join order */
    this.members = new Map();
    /** @type {string|null} */
    this.hostId = null;
    this.settings = new GameSettings();
    /** @type {OldMaidGame|null} */
    this.game = null;
    this.hostKickVote = new KickVote(hostKickVotes);
    this.names = new NameAllocator();
    this.publicIdCounter = 0;
    /** Names of people who left mid-game, so the game log can still name them. */
    this.departedNames = new Map();
    /** @type {string[]} recent room events, newest last */
    this.activity = [];
    this.turnTimer = null;
    this.turnKey = null;
    /** @type {number|null} Date.now() at which the current turn times out */
    this.turnDeadline = null;
  }

  get phase() {
    if (!this.game) return Phase.LOBBY;
    return this.game.isOver ? Phase.FINISHED : Phase.PLAYING;
  }

  /** @returns {string[]} connection ids of everyone in the room */
  get memberIds() {
    return [...this.members.keys()];
  }

  // ---- joining and leaving -------------------------------------------------

  /**
   * @param {string} id - connection id
   * @param {unknown} [requestedName] - untrusted; the name the client had before reconnecting
   * @param {string} [address] - the client's IP address
   * @returns {Player}
   * @throws {ActionError} 'banned' or 'room-full'
   */
  join(id, requestedName, address = id) {
    const existing = this.members.get(id);
    if (existing) return existing;
    if (this.isBanned(address)) {
      throw new ActionError('banned', 'You were kicked from this room. Try again in a few minutes.');
    }
    if (this.members.size >= this.maxMembers) throw new ActionError('room-full', 'The room is full.');
    const name = this.names.allocate(requestedName, (n) => this.isNameTaken(n));
    this.publicIdCounter += 1;
    const player = new Player({ id, publicId: `p${this.publicIdCounter}`, name, address });
    this.members.set(id, player);
    if (this.hostId === null) {
      this.hostId = id;
      this.announce(`${name} joined and is the host.`);
    } else {
      this.announce(`${name} joined.`);
    }
    this.changed();
    return player;
  }

  /** @param {string} id */
  leave(id) {
    const player = this.members.get(id);
    if (!player) return;
    this.announce(`${player.name} left.`);
    this.remove(player);
    this.changed();
  }

  // ---- host actions --------------------------------------------------------

  /**
   * @param {string} id - must be the host
   * @param {unknown} changes - untrusted, e.g. { cardsPerPlayer: 7 }
   */
  updateSettings(id, changes) {
    this.assertHost(id);
    if (this.phase === Phase.PLAYING) {
      throw new ActionError('game-running', "Settings can't change during a game.");
    }
    this.settings = this.settings.with(changes);
    this.changed();
  }

  /** @param {string} id - must be the host */
  startGame(id) {
    this.assertHost(id);
    if (this.phase === Phase.PLAYING) throw new ActionError('game-running', 'A game is already running.');
    const playerIds = this.memberIds.slice(0, OldMaidGame.MAX_PLAYERS);
    this.departedNames.clear();
    this.game = new OldMaidGame({ playerIds, settings: this.settings, rng: this.rng });
    this.announce(`${this.nameOf(id)} started a game.`);
    this.changed();
  }

  /** Abandons the current game and returns everyone to the lobby. */
  endGame(id) {
    this.assertHost(id);
    if (!this.game) throw new ActionError('no-game', 'There is no game to end.');
    this.game = null;
    this.announce(`${this.nameOf(id)} ended the game.`);
    this.changed();
  }

  /**
   * @param {string} id - must be the host
   * @param {unknown} targetPublicId - untrusted
   */
  kick(id, targetPublicId) {
    this.assertHost(id);
    const target = [...this.members.values()].find((p) => p.publicId === targetPublicId);
    if (!target) throw new ActionError('no-such-player', 'That player is no longer here.');
    if (target.id === id) throw new ActionError('kick-self', "You can't kick yourself.");
    // Players sharing the host's address (same household, or local testing) aren't
    // banned: the ban would lock out the host's own network too.
    if (this.kickBanMs > 0 && target.address !== this.members.get(id).address) {
      this.bans.set(target.address, Date.now() + this.kickBanMs);
    }
    this.announce(`${this.nameOf(id)} kicked ${target.name}.`);
    this.remove(target);
    this.changed();
    this.onKick(target.id, KickReason.HOST);
  }

  // ---- guest actions -------------------------------------------------------

  /**
   * Casts or withdraws the caller's vote to kick the host.
   * @param {string} id - must be a guest
   */
  voteKickHost(id) {
    this.assertMember(id);
    if (id === this.hostId) throw new ActionError('host-vote', "The host can't vote to kick themselves.");
    const key = this.oneVotePerAddress ? this.members.get(id).address : id;
    const voting = this.hostKickVote.toggle(id, key);
    const { count, needed } = this.hostKickVote;
    this.announce(`${this.nameOf(id)} ${voting ? 'voted' : 'withdrew their vote'} to kick the host (${count}/${needed}).`);
    if (this.hostKickVote.passed) {
      const host = this.members.get(this.hostId);
      this.announce(`The guests voted out ${host.name}.`);
      this.remove(host);
      this.changed();
      this.onKick(host.id, KickReason.VOTE);
      return;
    }
    this.changed();
  }

  // ---- game actions --------------------------------------------------------

  /** @param {string} id @param {unknown} index - untrusted */
  drawFromPlayer(id, index) {
    this.requireGame().drawFromPlayer(id, index);
    this.changed();
  }

  /** @param {string} id */
  drawFromPile(id) {
    this.requireGame().drawFromPile(id);
    this.changed();
  }

  /** Plays for whoever ran out of time. */
  timeOutTurn() {
    const game = this.game;
    if (!game || game.isOver) return;
    const id = game.currentPlayerId;
    game.autoPlay(id);
    this.announce(`${this.nameOf(id)} ran out of time; a card was drawn for them.`);
    this.changed();
  }

  // ---- views ---------------------------------------------------------------

  /** Everything one client needs to render, with only what they're allowed to see. */
  stateFor(id) {
    const me = this.members.get(id);
    if (!me) return null;
    const isHost = id === this.hostId;
    const phase = this.phase;
    const playerCount = Math.min(this.members.size, OldMaidGame.MAX_PLAYERS);
    const seated = new Set(this.game ? this.game.playerIds : []);

    return {
      phase,
      you: { id: me.publicId, name: me.name, isHost },
      host: this.hostId ? this.nameOf(this.hostId) : null,
      members: [...this.members.values()].map((p) => ({
        id: p.publicId,
        name: p.name,
        isHost: p.id === this.hostId,
        isYou: p.id === id,
        inGame: seated.has(p.id),
      })),
      settings: {
        ...this.settings.toJSON(),
        maxCardsPerPlayer: OldMaidGame.maxCardsPerPlayer(playerCount),
      },
      limits: { minPlayers: OldMaidGame.MIN_PLAYERS, maxPlayers: OldMaidGame.MAX_PLAYERS },
      canStart: isHost && phase !== Phase.PLAYING && this.members.size >= OldMaidGame.MIN_PLAYERS,
      hostVote: {
        votes: this.hostKickVote.count,
        needed: this.hostKickVote.needed,
        youVoted: this.hostKickVote.hasVoted(id),
      },
      activity: [...this.activity],
      game: this.game && {
        ...this.game.viewFor(id, (gameId) => this.nameOf(gameId)),
        // Relative, so it doesn't depend on the client's clock being right.
        turnRemainingMs: this.turnDeadline ? Math.max(0, this.turnDeadline - Date.now()) : null,
        turnTimeoutMs: this.turnTimeoutMs,
      },
    };
  }

  /** Stops pending timers. Call on shutdown. */
  dispose() {
    this.stopTurnTimer();
  }

  // ---- internals -----------------------------------------------------------

  /** @private Removes a member from the room and any game, handing on the host role. */
  remove(player) {
    const { id } = player;
    this.members.delete(id);
    this.hostKickVote.withdraw(id);
    if (this.game?.isSeated(id)) {
      this.departedNames.set(id, player.name);
      this.game.removePlayer(id);
    }
    if (id === this.hostId) {
      this.hostId = this.memberIds[0] ?? null;
      this.hostKickVote.reset();
      if (this.hostId) this.announce(`${this.nameOf(this.hostId)} is now the host.`);
    }
    if (this.members.size === 0) this.game = null;
  }

  /** @private */
  changed() {
    this.syncTurnTimer();
    this.onChange();
  }

  /** @private Restarts the countdown whenever the turn moves on. */
  syncTurnTimer() {
    const game = this.game;
    if (!game || game.isOver) {
      this.stopTurnTimer();
      return;
    }
    const key = `${game.turnCount}:${game.currentPlayerId}`;
    if (key === this.turnKey) return;
    this.stopTurnTimer();
    this.turnKey = key;
    this.turnDeadline = Date.now() + this.turnTimeoutMs;
    this.turnTimer = setTimeout(() => this.timeOutTurn(), this.turnTimeoutMs);
    this.turnTimer.unref?.(); // a pending turn shouldn't keep the process alive on shutdown
  }

  /** @private */
  stopTurnTimer() {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnKey = null;
    this.turnDeadline = null;
  }

  /** @private */
  requireGame() {
    if (!this.game) throw new ActionError('no-game', 'No game is running.');
    return this.game;
  }

  /** @private */
  assertMember(id) {
    if (!this.members.has(id)) throw new ActionError('not-in-room', "You're not in the room.");
  }

  /** @private */
  assertHost(id) {
    this.assertMember(id);
    if (id !== this.hostId) throw new ActionError('not-host', 'Only the host can do that.');
  }

  /** @private Also forgets expired bans. */
  isBanned(address) {
    const now = Date.now();
    for (const [banned, until] of this.bans) {
      if (until <= now) this.bans.delete(banned);
    }
    return this.bans.has(address);
  }

  /** @private */
  isNameTaken(name) {
    return [...this.members.values()].some((p) => p.name === name);
  }

  /** @private */
  nameOf(id) {
    return this.members.get(id)?.name ?? this.departedNames.get(id) ?? 'Someone';
  }

  /** @private */
  announce(message) {
    this.activity.push(message);
    if (this.activity.length > ACTIVITY_LIMIT) this.activity.shift();
  }
}

module.exports = { Room, DEFAULT_HOST_KICK_VOTES, DEFAULT_TURN_TIMEOUT_MS, DEFAULT_MAX_MEMBERS, DEFAULT_KICK_BAN_MS };
