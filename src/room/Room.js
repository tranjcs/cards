'use strict';

const { Player } = require('./Player');
const { NameAllocator } = require('./NameAllocator');
const { KickVote } = require('./KickVote');
const { OldMaidGame } = require('../game/OldMaidGame');
const { MafiaGame } = require('../game/MafiaGame');
const { GAMES } = require('../game/games');
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
 * the longest-connected guest becomes host. The host picks the game and its settings,
 * starts it and can kick anyone. Guests can vote to kick the host; it takes at least
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
   * @param {number} [options.turnTimeoutMs] - turn time in turn-based games; a player who takes
   *   longer gets a random move
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
    /** @type {import('../game/CardGame').CardGame|null} */
    this.game = null;
    /** Counts games started, so a new game always restarts the countdown. */
    this.gamesStarted = 0;
    this.hostKickVote = new KickVote(hostKickVotes);
    this.names = new NameAllocator();
    this.publicIdCounter = 0;
    /** Names of people who left mid-game, so the game log can still name them. */
    this.departedNames = new Map();
    /** @type {string[]} recent room events, newest last */
    this.activity = [];
    this.turnTimer = null;
    this.turnKey = null;
    /** @type {number|null} Date.now() at which the current turn (or night, or day) times out */
    this.turnDeadline = null;
    /** @type {number|null} how long the current countdown runs in total */
    this.turnLimitMs = null;
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
   * @param {unknown} changes - untrusted, e.g. { game: 'mafia' } or { cardsPerPlayer: 7 }
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
    const Game = GAMES[this.settings.game];
    const playerIds = this.memberIds.slice(0, Game.MAX_PLAYERS);
    const game = new Game({ playerIds, settings: this.settings, rng: this.rng });
    this.departedNames.clear();
    this.game = game;
    this.gamesStarted += 1;
    this.announce(`${this.nameOf(id)} started a game of ${Game.TITLE}.`);
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
    const target = this.memberByPublicId(targetPublicId);
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

  /** Old Maid. @param {string} id @param {unknown} index - untrusted */
  drawFromPlayer(id, index) {
    this.requireGame(OldMaidGame).drawFromPlayer(id, index);
    this.changed();
  }

  /** Old Maid. @param {string} id */
  drawFromPile(id) {
    this.requireGame(OldMaidGame).drawFromPile(id);
    this.changed();
  }

  /** Mafia. @param {string} id @param {unknown} targetPublicId - untrusted */
  nightPick(id, targetPublicId) {
    const game = this.requireGame(MafiaGame);
    game.nightPick(id, this.memberByPublicId(targetPublicId).id);
    this.changed();
  }

  /** Mafia. @param {string} id @param {unknown} targetPublicId - untrusted; null votes for nobody */
  dayVote(id, targetPublicId) {
    const game = this.requireGame(MafiaGame);
    game.dayVote(id, targetPublicId === null ? null : this.memberByPublicId(targetPublicId).id);
    this.changed();
  }

  /** The countdown ran out: the game decides what that means (a random move, the end of the night...). */
  timeOutTurn() {
    const game = this.game;
    if (!game || game.isOver) return;
    try {
      game.timeOut();
    } catch (error) {
      // A bug, not a player's doing. This runs from a timer, where a throw would crash the
      // server; log it and leave the game as it is (the host can still end it).
      console.error('Error timing out a turn:', error);
    }
    this.changed();
  }

  // ---- views ---------------------------------------------------------------

  /** Everything one client needs to render, with only what they're allowed to see. */
  stateFor(id) {
    const me = this.members.get(id);
    if (!me) return null;
    const isHost = id === this.hostId;
    const phase = this.phase;
    const Chosen = GAMES[this.settings.game];
    const games = Object.values(GAMES);
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
        // e.g. maxCardsPerPlayer, maxMafia: what each game allows with this many people here
        ...Object.assign({}, ...games.map((Game) => Game.optionLimits(Math.min(this.members.size, Game.MAX_PLAYERS)))),
      },
      games: games.map((Game) => ({
        id: Game.TYPE,
        name: Game.TITLE,
        minPlayers: Game.MIN_PLAYERS,
        maxPlayers: Game.MAX_PLAYERS,
      })),
      limits: { minPlayers: Chosen.MIN_PLAYERS, maxPlayers: Chosen.MAX_PLAYERS },
      canStart: isHost && phase !== Phase.PLAYING && this.members.size >= Chosen.MIN_PLAYERS,
      hostVote: {
        votes: this.hostKickVote.count,
        needed: this.hostKickVote.needed,
        youVoted: this.hostKickVote.hasVoted(id),
      },
      activity: [...this.activity],
      game: this.game && {
        type: this.game.constructor.TYPE,
        ...this.game.viewFor(id, (gameId) => this.nameOf(gameId), (gameId) => this.members.get(gameId)?.publicId ?? null),
        // Relative, so it doesn't depend on the client's clock being right.
        turnRemainingMs: this.turnDeadline ? Math.max(0, this.turnDeadline - Date.now()) : null,
        turnTimeoutMs: this.turnLimitMs ?? this.turnTimeoutMs,
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

  /** @private Restarts the countdown whenever the game moves to a new timed step (a turn, a night...). */
  syncTurnTimer() {
    const step = this.game?.timerKey ?? null;
    if (step === null) {
      this.stopTurnTimer();
      return;
    }
    const key = `${this.gamesStarted}:${step}`;
    if (key === this.turnKey) return;
    this.stopTurnTimer();
    this.turnKey = key;
    this.turnLimitMs = this.game.timeLimitMs ?? this.turnTimeoutMs;
    this.turnDeadline = Date.now() + this.turnLimitMs;
    this.turnTimer = setTimeout(() => this.timeOutTurn(), this.turnLimitMs);
    this.turnTimer.unref?.(); // a pending turn shouldn't keep the process alive on shutdown
  }

  /** @private */
  stopTurnTimer() {
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnKey = null;
    this.turnDeadline = null;
    this.turnLimitMs = null;
  }

  /**
   * @private
   * @param {Function} [Game] - the game class the move belongs to
   */
  requireGame(Game) {
    if (!this.game) throw new ActionError('no-game', 'No game is running.');
    if (Game && !(this.game instanceof Game)) throw new ActionError('wrong-game', "That move isn't part of this game.");
    return this.game;
  }

  /** @private @param {unknown} publicId - untrusted @returns {Player} */
  memberByPublicId(publicId) {
    const player = [...this.members.values()].find((p) => p.publicId === publicId);
    if (!player) throw new ActionError('no-such-player', 'That player is no longer here.');
    return player;
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
