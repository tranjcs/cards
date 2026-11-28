'use strict';

const { Card, Suit, RANKS } = require('../cards/Card');
const { Deck } = require('../cards/Deck');
const { Pile } = require('../cards/Pile');
const { CardGame } = require('./CardGame');
const { GameSettings, GameType, AUTO_MAFIA, MAX_MAFIA } = require('./GameSettings');
const { ActionError } = require('../errors');
const { randomInt, shuffle } = require('../random');

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 20;
const NIGHT_MS = 45 * 1000;
const MINUTE_MS = 60 * 1000;
const LOG_PREVIEW = 10;

/** What a player secretly is. */
const Role = Object.freeze({
  MAFIA: 'mafia',
  DOCTOR: 'doctor',
  DETECTIVE: 'detective',
  VILLAGER: 'villager',
});

/** The two sides. Everyone who isn't Mafia plays for the town. */
const Team = Object.freeze({ TOWN: 'town', MAFIA: 'mafia' });

/** Where the game is in the day-night cycle. */
const Stage = Object.freeze({ NIGHT: 'night', DAY: 'day' });

/**
 * What each role does with its night pick. Villagers name a suspect, which does nothing:
 * it means everyone taps their screen at night, so nobody can tell who has a real role.
 */
const NightAction = Object.freeze({
  [Role.MAFIA]: 'kill',
  [Role.DOCTOR]: 'protect',
  [Role.DETECTIVE]: 'investigate',
  [Role.VILLAGER]: 'suspect',
});

/** Why the game ended. */
const EndReason = Object.freeze({
  MAFIA_GONE: 'mafia-gone', // every Mafia member is out: the town wins
  MAFIA_MAJORITY: 'mafia-majority', // the Mafia match the town in number: the Mafia win
});

/** Role cards: an ace per Mafia member, Q♥ for the Doctor, K♠ for the Detective. */
const MAFIA_CARDS = Object.freeze([Suit.SPADES, Suit.CLUBS, Suit.HEARTS, Suit.DIAMONDS].map((suit) => new Card('A', suit)));
const DOCTOR_CARD = new Card('Q', Suit.HEARTS);
const DETECTIVE_CARD = new Card('K', Suit.SPADES);
/** Villagers get number cards, 2 to 10. */
const VILLAGER_RANKS = new Set(RANKS.filter((rank) => /^\d+$/.test(rank)));

if (MAFIA_CARDS.length !== MAX_MAFIA) throw new Error('Every Mafia member needs an ace');

/** @param {Card} card @returns {string} the Role this card deals */
function roleOfCard(card) {
  if (card.rank === 'A') return Role.MAFIA;
  if (card.equals(DOCTOR_CARD)) return Role.DOCTOR;
  if (card.equals(DETECTIVE_CARD)) return Role.DETECTIVE;
  return Role.VILLAGER;
}

/**
 * Mafia, the party game, with playing cards as role cards.
 *
 * Everyone is dealt one card face down: an ace makes you Mafia, Q♥ the Doctor, K♠ the
 * Detective, and a number card a Villager. The Mafia know each other. The game starts
 * at night and alternates:
 *
 * - **Night.** Every living player picks someone. The Mafia's most popular pick is
 *   killed, unless the Doctor protected them (the Doctor can't protect the same person
 *   two nights running). The Detective learns whether their pick is Mafia. Villagers'
 *   picks do nothing. The night ends once everyone has picked, or when time runs out;
 *   if no Mafia member picked by then, the Mafia kill someone at random.
 * - **Day.** The table talks it over (in person or on a call) and every living player
 *   votes for someone, or for nobody. The day ends once everyone has voted, or when time
 *   runs out. The player with the most votes is out, unless that's a tie or "nobody" has
 *   as many votes.
 *
 * Eliminated players' cards are revealed. The town wins when every Mafia member is out;
 * the Mafia win as soon as they match the town in number.
 *
 * Everything secret stays here: a player only sees their own card, the Mafia see each
 * other's, and only the Detective sees what they learned. Night picks are private; day
 * votes are public.
 */
class MafiaGame extends CardGame {
  static MIN_PLAYERS = MIN_PLAYERS;
  static MAX_PLAYERS = MAX_PLAYERS;
  static NIGHT_MS = NIGHT_MS;

  /**
   * Most Mafia members for a table: few enough that they're still outnumbered after the
   * first night's kill, so the town always gets at least one day to vote.
   * @param {number} playerCount
   * @returns {number}
   */
  static maxMafia(playerCount) {
    return Math.min(MAX_MAFIA, Math.max(1, Math.floor(playerCount / 2) - 1));
  }

  /**
   * @param {number} playerCount
   * @param {number} [setting] - AUTO_MAFIA for about one in four players
   * @returns {number} how many Mafia members to deal, capped to what the table allows
   */
  static mafiaCountFor(playerCount, setting = AUTO_MAFIA) {
    const wanted = setting === AUTO_MAFIA ? Math.floor((playerCount + 1) / 4) : setting;
    return Math.min(Math.max(wanted, 1), MafiaGame.maxMafia(playerCount));
  }

  /**
   * @param {object} options
   * @param {string[]} options.playerIds - seating order
   * @param {GameSettings} [options.settings]
   * @param {import('../random').Rng} [options.rng]
   */
  constructor({ playerIds, settings = new GameSettings(), rng }) {
    super({ playerIds, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, rng });
    this.settings = settings;

    const mafia = MafiaGame.mafiaCountFor(playerIds.length, settings.mafiaCount);
    const roleCards = [
      ...MAFIA_CARDS.slice(0, mafia),
      ...(settings.doctor ? [DOCTOR_CARD] : []),
      ...(settings.detective ? [DETECTIVE_CARD] : []),
    ];
    const numberCards = Deck.standard().cards.filter((card) => VILLAGER_RANKS.has(card.rank));
    const villagerCards = shuffle(numberCards, this.rng).slice(0, playerIds.length - roleCards.length);
    this.drawPile = new Pile([...roleCards, ...villagerCards]).shuffle(this.rng);
    this.deal(1);

    /** What was dealt. Public: the table knows how many of each role there are. */
    this.setup = Object.freeze({
      mafia,
      doctor: settings.doctor,
      detective: settings.detective,
      villagers: villagerCards.length,
    });
    this.stage = Stage.NIGHT;
    this.round = 1;
    /** @type {Set<string>} players who are out: killed, voted out or gone */
    this.dead = new Set();
    /** @type {Set<string>} players who left the room */
    this.departed = new Set();
    /** @type {Map<string, string>} tonight's picks, player -> target. Private. */
    this.nightPicks = new Map();
    /** @type {Map<string, string|null>} today's votes, voter -> target or null for nobody. Public. */
    this.votes = new Map();
    /** Whoever the Doctor protected last night, who can't be protected again tonight. */
    this.lastProtectedId = null;
    /** @type {{ round: number, targetId: string, isMafia: boolean }[]} what the Detective learned. Private. */
    this.investigations = [];
    /** The latest night or day result, headlined in every view. */
    this.headline = null;

    this.record({ kind: 'start', setup: this.setup });
    this.record({ kind: 'night', round: this.round });
  }

  /** Everyone acts at once, so nobody has "the turn". */
  get currentPlayerId() {
    return null;
  }

  get timerKey() {
    return this.isOver ? null : `${this.stage}:${this.round}`;
  }

  get timeLimitMs() {
    return this.stage === Stage.NIGHT ? NIGHT_MS : this.settings.dayMinutes * MINUTE_MS;
  }

  /** @param {string} id @returns {Card} */
  cardOf(id) {
    return this.handOf(id).cards[0];
  }

  /** @param {string} id @returns {string} a Role */
  roleOf(id) {
    return roleOfCard(this.cardOf(id));
  }

  /** @param {string} id @returns {string} a Team */
  teamOf(id) {
    return this.roleOf(id) === Role.MAFIA ? Team.MAFIA : Team.TOWN;
  }

  /** @param {unknown} id */
  isAlive(id) {
    return this.isSeated(id) && !this.dead.has(id);
  }

  /** @returns {string[]} players still in the game, in seating order */
  get livingIds() {
    return this.playerIds.filter((id) => this.isAlive(id));
  }

  // ---- actions -------------------------------------------------------------

  /**
   * Picks tonight's target: who to kill (Mafia), protect (Doctor), investigate (Detective)
   * or suspect (Villagers, to no effect). A pick can be changed until the night ends.
   * @param {string} id
   * @param {string|null|undefined} targetId - untrusted: may not be a player at all
   */
  nightPick(id, targetId) {
    this.assertCanAct(id, Stage.NIGHT);
    const refusal = this.nightRefusal(id, targetId);
    if (refusal) throw new ActionError('invalid-target', refusal);
    this.nightPicks.set(id, targetId);
    this.advanceIfEveryoneActed();
  }

  /**
   * Votes to put someone out, or for nobody. A vote can be changed until the day ends.
   * @param {string} id
   * @param {string|null|undefined} targetId - null votes for nobody; untrusted
   */
  dayVote(id, targetId) {
    this.assertCanAct(id, Stage.DAY);
    if (targetId !== null) {
      if (!this.isAlive(targetId)) throw new ActionError('invalid-target', 'Vote for a living player, or for nobody.');
      if (targetId === id) throw new ActionError('invalid-target', "You can't vote for yourself.");
    }
    this.votes.set(id, targetId);
    this.advanceIfEveryoneActed();
  }

  /**
   * The countdown ran out: the night or day ends with the picks and votes made so far.
   * @returns {null} nobody in particular ran out of time
   */
  timeOut() {
    if (!this.isOver) this.endStage();
    return null;
  }

  /** A player who leaves is out; their card is revealed and their picks and votes dropped. */
  removePlayer(id) {
    if (!this.isSeated(id) || this.departed.has(id)) return;
    const wasAlive = this.isAlive(id);
    this.departed.add(id);
    this.dead.add(id);
    for (const choices of [this.nightPicks, this.votes]) {
      choices.delete(id);
      for (const [chooser, target] of choices) {
        if (target === id) choices.delete(chooser);
      }
    }
    if (this.lastProtectedId === id) this.lastProtectedId = null;
    this.record({ kind: 'left', playerId: id, card: wasAlive ? this.cardOf(id) : null });
    if (this.isOver || !wasAlive) return;
    if (!this.checkForWinner()) this.advanceIfEveryoneActed();
  }

  // ---- rules ---------------------------------------------------------------

  /** @private */
  assertCanAct(id, stage) {
    if (this.isOver) throw new ActionError('game-over', 'The game is over.');
    this.handOf(id);
    if (!this.isAlive(id)) throw new ActionError('eliminated', "You're out. Watch quietly until the game ends!");
    if (this.stage !== stage) {
      throw stage === Stage.NIGHT
        ? new ActionError('wrong-stage', "It's daytime: vote instead.")
        : new ActionError('wrong-stage', "It's night: voting opens in the morning.");
    }
  }

  /** @private @returns {string|null} why `id` can't pick `targetId` tonight, or null if they can */
  nightRefusal(id, targetId) {
    if (!this.isAlive(targetId)) return 'Pick a living player.';
    const role = this.roleOf(id);
    if (role === Role.MAFIA) {
      return this.roleOf(targetId) === Role.MAFIA ? 'Pick someone outside the Mafia.' : null;
    }
    if (role === Role.DOCTOR) {
      return targetId === this.lastProtectedId ? 'You protected them last night. Pick someone else.' : null;
    }
    return targetId === id ? 'Pick someone other than yourself.' : null;
  }

  /** @private Ends the night or day once every living player has picked or voted. */
  advanceIfEveryoneActed() {
    if (this.isOver) return;
    const acted = this.stage === Stage.NIGHT ? this.nightPicks : this.votes;
    if (this.livingIds.every((id) => acted.has(id))) this.endStage();
  }

  /** @private */
  endStage() {
    if (this.stage === Stage.NIGHT) this.endNight();
    else this.endDay();
  }

  /** @private Dawn: the Mafia strike, the Doctor saves, the Detective learns. */
  endNight() {
    const living = this.livingIds;
    const withRole = (role) => living.filter((id) => this.roleOf(id) === role);
    const pickOf = (id) => (id === undefined ? undefined : this.nightPicks.get(id));

    const mafiaPicks = withRole(Role.MAFIA).map(pickOf).filter((target) => target !== undefined);
    const favourites = mostCommon(mafiaPicks);
    const victimId = favourites.length
      ? this.randomOf(favourites)
      : this.randomOf(living.filter((id) => this.roleOf(id) !== Role.MAFIA));
    const protectedId = pickOf(withRole(Role.DOCTOR)[0]) ?? null;
    const suspectId = pickOf(withRole(Role.DETECTIVE)[0]);
    if (suspectId !== undefined) {
      this.investigations.push({ round: this.round, targetId: suspectId, isMafia: this.roleOf(suspectId) === Role.MAFIA });
    }
    this.lastProtectedId = protectedId;
    this.nightPicks.clear();

    if (victimId !== undefined && victimId !== protectedId) this.eliminate(victimId, 'killed');
    else this.announce({ kind: 'quiet-night' });
    if (this.checkForWinner()) return;
    this.stage = Stage.DAY;
    this.votes.clear();
    this.record({ kind: 'day', round: this.round });
  }

  /** @private Dusk: the votes are counted. */
  endDay() {
    const cast = this.livingIds.filter((id) => this.votes.has(id)).map((id) => this.votes.get(id));
    const leaders = mostCommon(cast);
    this.votes.clear();

    if (leaders.length === 1 && leaders[0] !== null) {
      const [outId] = leaders;
      this.eliminate(outId, 'voted-out', { votes: cast.filter((target) => target === outId).length });
    } else {
      let reason = 'tie';
      if (cast.length === 0) reason = 'no-votes';
      else if (leaders.length === 1) reason = 'chose-nobody';
      this.announce({ kind: 'no-elimination', reason });
    }
    if (this.checkForWinner()) return;
    this.round += 1;
    this.stage = Stage.NIGHT;
    this.record({ kind: 'night', round: this.round });
  }

  /** @private */
  eliminate(id, kind, details = {}) {
    this.dead.add(id);
    this.announce({ kind, playerId: id, card: this.cardOf(id), ...details });
  }

  /** @private Ends the game if a side has won. @returns {boolean} whether it's over */
  checkForWinner() {
    const living = this.livingIds;
    const mafia = living.filter((id) => this.roleOf(id) === Role.MAFIA).length;
    if (mafia === 0) this.finish(Team.TOWN, EndReason.MAFIA_GONE);
    else if (mafia >= living.length - mafia) this.finish(Team.MAFIA, EndReason.MAFIA_MAJORITY);
    return this.isOver;
  }

  /** @private */
  finish(winner, reason) {
    this.result = { winner, reason, loserId: null };
    this.record({ kind: 'game-over', winner });
  }

  /** @private A public result worth headlining. */
  announce(entry) {
    this.headline = entry;
    this.record(entry);
  }

  /** @private @template T @param {T[]} items @returns {T|undefined} */
  randomOf(items) {
    return items.length ? items[randomInt(items.length, this.rng)] : undefined;
  }

  // ---- views ---------------------------------------------------------------

  viewFor(viewerId, nameOf, publicIdOf = () => null) {
    const me = viewerId !== null && this.isSeated(viewerId) ? viewerId : null;
    const myRole = me ? this.roleOf(me) : null;
    const over = this.isOver;
    const canAct = me !== null && !over && this.isAlive(me);
    const daytime = !over && this.stage === Stage.DAY;
    const tally = daytime ? countVotes(this.livingIds.filter((id) => this.votes.has(id)).map((id) => this.votes.get(id))) : new Map();
    const knowsRoleOf = (id) => over || id === me || this.dead.has(id)
      || (myRole === Role.MAFIA && this.roleOf(id) === Role.MAFIA);

    return {
      type: GameType.MAFIA,
      stage: over ? 'over' : this.stage,
      round: this.round,
      setup: { ...this.setup, players: this.playerIds.length },
      seats: this.playerIds.map((id) => {
        const known = knowsRoleOf(id);
        const voted = daytime && this.votes.has(id);
        const vote = voted ? this.votes.get(id) : null;
        return {
          id: publicIdOf(id),
          name: nameOf(id),
          isYou: id === me,
          isAlive: this.isAlive(id),
          hasLeft: this.departed.has(id),
          role: known ? this.roleOf(id) : null,
          card: known ? this.cardOf(id).toJSON() : null,
          votes: tally.get(id) ?? 0,
          hasVoted: voted,
          votedFor: vote === null ? null : nameOf(vote),
        };
      }),
      isPlaying: me !== null,
      you: me && { role: myRole, team: this.teamOf(me), card: this.cardOf(me).toJSON(), isAlive: this.isAlive(me) },
      night: canAct && this.stage === Stage.NIGHT ? this.nightViewFor(me, nameOf, publicIdOf) : null,
      day: daytime ? this.dayViewFor(canAct ? me : null, tally, publicIdOf) : null,
      investigations: myRole === Role.DETECTIVE
        ? this.investigations.map(({ round, targetId, isMafia }) => ({ round, name: nameOf(targetId), isMafia }))
        : [],
      headline: this.headline && describe(this.headline, nameOf),
      log: this.log.slice(-LOG_PREVIEW).map((entry) => describe(entry, nameOf)),
      result: this.result && {
        winner: this.result.winner,
        youWon: me !== null && this.teamOf(me) === this.result.winner,
      },
    };
  }

  /** @private What a living player sees at night: their choices, and the Mafia's plans. */
  nightViewFor(me, nameOf, publicIdOf) {
    const role = this.roleOf(me);
    const pick = this.nightPicks.get(me);
    const teammates = role === Role.MAFIA
      ? this.livingIds.filter((id) => id !== me && this.roleOf(id) === Role.MAFIA)
      : [];
    return {
      action: NightAction[role],
      choices: this.livingIds.filter((id) => !this.nightRefusal(me, id)).map(publicIdOf),
      pick: pick === undefined ? null : publicIdOf(pick),
      team: teammates.map((id) => {
        const theirs = this.nightPicks.get(id);
        return { name: nameOf(id), pick: theirs === undefined ? null : nameOf(theirs) };
      }),
      lastProtected: role === Role.DOCTOR && this.lastProtectedId ? nameOf(this.lastProtectedId) : null,
    };
  }

  /** @private The day's vote; `me` is null for anyone who can't vote. */
  dayViewFor(me, tally, publicIdOf) {
    const vote = me === null ? undefined : this.votes.get(me);
    return {
      votesCast: [...tally.values()].reduce((sum, n) => sum + n, 0),
      voters: this.livingIds.length,
      nobodyVotes: tally.get(null) ?? 0,
      canVote: me !== null,
      choices: me === null ? [] : this.livingIds.filter((id) => id !== me).map(publicIdOf),
      hasVoted: vote !== undefined,
      vote: vote ? publicIdOf(vote) : null,
    };
  }
}

/** @template T @param {T[]} values @returns {Map<T, number>} */
function countVotes(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/** @template T @param {T[]} values @returns {T[]} the values that occur most often (several on a tie) */
function mostCommon(values) {
  const counts = countVotes(values);
  const most = Math.max(0, ...counts.values());
  return [...counts].filter(([, n]) => n === most).map(([value]) => value);
}

const ROLE_NOUNS = Object.freeze({
  [Role.MAFIA]: 'Mafia',
  [Role.DOCTOR]: 'the Doctor',
  [Role.DETECTIVE]: 'the Detective',
  [Role.VILLAGER]: 'a Villager',
});

const NO_ELIMINATION = Object.freeze({
  tie: 'The vote was tied, so nobody was voted out.',
  'chose-nobody': 'The town chose not to vote anyone out.',
  'no-votes': 'Nobody voted, so nobody was voted out.',
});

/** "Mafia (A♠)" */
function roleText(card) {
  return `${ROLE_NOUNS[roleOfCard(card)]} (${card})`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** "1 Mafia, a Doctor and 2 Villagers" */
function setupText({ mafia, doctor, detective, villagers }) {
  const parts = [`${mafia} Mafia`];
  if (doctor) parts.push('a Doctor');
  if (detective) parts.push('a Detective');
  if (villagers) parts.push(plural(villagers, 'Villager'));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
}

/**
 * Turns a log entry into a sentence. Entries only hold public information: cards appear
 * once their owner is out.
 * @param {object} entry
 * @param {(id: string) => string} nameOf
 */
function describe(entry, nameOf) {
  const who = entry.playerId ? nameOf(entry.playerId) : '';
  switch (entry.kind) {
    case 'start':
      return `Roles dealt: ${setupText(entry.setup)}.`;
    case 'night':
      return `Night ${entry.round} falls.`;
    case 'day':
      return `Day ${entry.round} begins.`;
    case 'killed':
      return `${who} was killed in the night. They were ${roleText(entry.card)}.`;
    case 'quiet-night':
      return 'Nobody died in the night.';
    case 'voted-out':
      return `${who} was voted out with ${plural(entry.votes, 'vote')}. They were ${roleText(entry.card)}.`;
    case 'no-elimination':
      return NO_ELIMINATION[entry.reason];
    case 'left':
      return entry.card ? `${who} left the game. They were ${roleText(entry.card)}.` : `${who} left.`;
    case 'game-over':
      return entry.winner === Team.TOWN
        ? 'The town wins: every Mafia member is out!'
        : 'The Mafia win: they now match the town in number!';
    default:
      return '';
  }
}

module.exports = { MafiaGame, Role, Team, Stage, NightAction, EndReason, roleOfCard };
