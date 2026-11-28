'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { MafiaGame, Role, Team, Stage, EndReason, roleOfCard } = require('../src/game/MafiaGame');
const { GameSettings } = require('../src/game/GameSettings');
const { Card, Suit } = require('../src/cards/Card');
const { ActionError } = require('../src/errors');
const { seededRng } = require('./helpers/seededRng');

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);
const nameOf = (id) => `Name ${id}`;
const card = (spec) => new Card(spec.slice(0, -1), { C: Suit.CLUBS, D: Suit.DIAMONDS, H: Suit.HEARTS, S: Suit.SPADES }[spec.slice(-1)]);
const view = (game, id) => game.viewFor(id, nameOf, (playerId) => playerId);
const roles = (game) => game.playerIds.map((id) => game.roleOf(id));
const count = (items, item) => items.filter((x) => x === item).length;

/**
 * A game where each player holds a chosen card, so roles are predictable.
 * @param {Record<string, string>} cardsById - player id -> card spec, e.g. "AS" (Mafia)
 */
function rigged(cardsById, settings) {
  const game = new MafiaGame({ playerIds: Object.keys(cardsById), settings, rng: seededRng(1) });
  for (const [id, spec] of Object.entries(cardsById)) {
    game.handOf(id).takeAll();
    game.handOf(id).add(card(spec));
  }
  return game;
}

/** Mafia (m), Doctor (doc), Detective (det) and two Villagers. */
const table = (settings) => rigged({ m: 'AS', doc: 'QH', det: 'KS', v1: '7C', v2: '8D' }, settings);

/** @param {MafiaGame} game @param {Record<string, string>} picks */
function night(game, picks) {
  for (const [id, targetId] of Object.entries(picks)) game.nightPick(id, targetId);
}

/** @param {MafiaGame} game @param {Record<string, string|null>} votes */
function day(game, votes) {
  for (const [id, targetId] of Object.entries(votes)) game.dayVote(id, targetId);
}

describe('MafiaGame setup', () => {
  it('deals each player one role card: aces for the Mafia, Q♥ Doctor, K♠ Detective, numbers for villagers', () => {
    const game = new MafiaGame({ playerIds: ids(8), rng: seededRng(3) });
    for (const id of game.playerIds) assert.equal(game.handOf(id).size, 1);
    const dealt = roles(game);
    assert.equal(count(dealt, Role.MAFIA), 2);
    assert.equal(count(dealt, Role.DOCTOR), 1);
    assert.equal(count(dealt, Role.DETECTIVE), 1);
    assert.equal(count(dealt, Role.VILLAGER), 4);
    assert.equal(new Set(game.playerIds.map((id) => game.cardOf(id).id)).size, 8);
    assert.equal(game.drawPile.size, 0);
    assert.deepEqual(game.setup, { mafia: 2, doctor: true, detective: true, villagers: 4 });
  });

  it('maps cards to roles', () => {
    assert.equal(roleOfCard(card('AD')), Role.MAFIA);
    assert.equal(roleOfCard(card('QH')), Role.DOCTOR);
    assert.equal(roleOfCard(card('KS')), Role.DETECTIVE);
    assert.equal(roleOfCard(card('10C')), Role.VILLAGER);
  });

  it('deals different roles to different seats from game to game', () => {
    const mafiaSeats = new Set();
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = new MafiaGame({ playerIds: ids(6), rng: seededRng(seed) });
      mafiaSeats.add(game.playerIds.find((id) => game.roleOf(id) === Role.MAFIA));
    }
    assert.ok(mafiaSeats.size > 2);
  });

  it('picks about one Mafia member per four players, still outnumbered after the first kill', () => {
    const auto = [4, 6, 7, 10, 11, 15, 20].map((n) => MafiaGame.mafiaCountFor(n));
    assert.deepEqual(auto, [1, 1, 2, 2, 3, 4, 4]);
    assert.deepEqual([4, 5, 6, 7, 8, 10, 20].map((n) => MafiaGame.maxMafia(n)), [1, 1, 2, 2, 3, 4, 4]);
    for (let n = 4; n <= 20; n += 1) {
      const mafia = MafiaGame.maxMafia(n);
      assert.ok(mafia < n - mafia - 1, `${n} players`);
    }
    assert.equal(MafiaGame.mafiaCountFor(5, 4), 1); // the host's choice is capped
    assert.equal(MafiaGame.mafiaCountFor(9, 3), 3);
  });

  it('can leave out the Doctor and the Detective', () => {
    const settings = new GameSettings({ doctor: false, detective: false, mafiaCount: 2 });
    const game = new MafiaGame({ playerIds: ids(6), settings, rng: seededRng(4) });
    assert.deepEqual([...new Set(roles(game))].sort(), [Role.MAFIA, Role.VILLAGER]);
    assert.equal(count(roles(game), Role.MAFIA), 2);
    assert.match(view(game, 'p0').log[0], /Roles dealt: 2 Mafia and 4 Villagers\./);
  });

  it('needs 4 to 20 players', () => {
    assert.throws(() => new MafiaGame({ playerIds: ids(3) }), ActionError);
    assert.throws(() => new MafiaGame({ playerIds: ids(21) }), ActionError);
    new MafiaGame({ playerIds: ids(20), rng: seededRng(1) });
  });

  it('starts at night, timed separately from the day', () => {
    const game = table(new GameSettings({ dayMinutes: 2 }));
    assert.equal(game.stage, Stage.NIGHT);
    assert.equal(game.timerKey, 'night:1');
    assert.equal(game.timeLimitMs, MafiaGame.NIGHT_MS);
    assert.equal(game.currentPlayerId, null);
    game.timeOut();
    assert.equal(game.timerKey, 'day:1');
    assert.equal(game.timeLimitMs, 2 * 60 * 1000);
  });
});

describe('MafiaGame nights', () => {
  it("kills the Mafia's pick at dawn once everyone has picked", () => {
    const game = table();
    night(game, { m: 'v1', doc: 'doc', det: 'v2', v1: 'm' });
    assert.equal(game.stage, Stage.NIGHT); // v2 hasn't picked
    game.nightPick('v2', 'v1');
    assert.equal(game.stage, Stage.DAY);
    assert.equal(game.isAlive('v1'), false);
    assert.match(view(game, 'm').headline, /Name v1 was killed in the night\. They were a Villager \(7♣\)\./);
  });

  it("saves the Doctor's patient", () => {
    const game = table();
    night(game, { m: 'v1', doc: 'v1', det: 'v2', v1: 'm', v2: 'm' });
    assert.deepEqual(game.livingIds, ['m', 'doc', 'det', 'v1', 'v2']);
    assert.equal(view(game, 'v2').headline, 'Nobody died in the night.');
  });

  it("doesn't let the Doctor protect the same person two nights running", () => {
    const game = table();
    night(game, { m: 'v1', doc: 'v1', det: 'v2', v1: 'm', v2: 'm' });
    game.timeOut(); // nobody voted
    assert.equal(game.stage, Stage.NIGHT);
    assert.equal(view(game, 'doc').night.lastProtected, 'Name v1');
    assert.equal(view(game, 'doc').night.choices.includes('v1'), false);
    assert.throws(() => game.nightPick('doc', 'v1'), { code: 'invalid-target', message: /last night/ });
    game.nightPick('doc', 'doc'); // protecting yourself is fine
  });

  it("tells only the Detective whether their pick is Mafia", () => {
    const game = table();
    night(game, { m: 'v1', doc: 'doc', det: 'm', v1: 'm', v2: 'det' });
    assert.deepEqual(view(game, 'det').investigations, [{ round: 1, name: 'Name m', isMafia: true }]);
    for (const id of ['m', 'doc', 'v2']) assert.deepEqual(view(game, id).investigations, []);
  });

  it('keeps the Mafia off each other and everyone but the Doctor off themselves', () => {
    const game = rigged({ m1: 'AS', m2: 'AC', doc: 'QH', det: 'KS', v1: '2C', v2: '3D', v3: '4H' });
    assert.throws(() => game.nightPick('m1', 'm2'), { code: 'invalid-target' });
    assert.throws(() => game.nightPick('m1', 'm1'), { code: 'invalid-target' });
    assert.throws(() => game.nightPick('det', 'det'), { code: 'invalid-target' });
    assert.throws(() => game.nightPick('v1', 'v1'), { code: 'invalid-target' });
    assert.throws(() => game.nightPick('v1', 'nobody'), { code: 'invalid-target' });
    assert.throws(() => game.nightPick('v1', undefined), { code: 'invalid-target' });
    assert.deepEqual(view(game, 'm1').night.choices, ['doc', 'det', 'v1', 'v2', 'v3']);
  });

  it("goes with the Mafia's most popular pick, breaking ties at random", () => {
    const players = { m1: 'AS', m2: 'AC', m3: 'AH', doc: 'QH', v1: '2C', v2: '3D', v3: '4H', v4: '5S', v5: '6S' };
    const town = { doc: 'v5', v1: 'v2', v2: 'v1', v3: 'v1', v4: 'v1', v5: 'v1' };

    const majority = rigged(players);
    night(majority, { m1: 'v1', m2: 'v2', m3: 'v2', ...town });
    assert.equal(majority.isAlive('v2'), false);
    assert.equal(majority.dead.size, 1);

    const victims = new Set();
    for (const rng of [() => 0, () => 0.99]) {
      const tied = rigged({ m1: 'AS', m2: 'AC', doc: 'QH', v1: '2C', v2: '3D', v3: '4H', v4: '5S' });
      tied.rng = rng;
      night(tied, { m1: 'v1', m2: 'v2', doc: 'v4', v1: 'v2', v2: 'v1', v3: 'v1', v4: 'v1' });
      assert.equal(tied.dead.size, 1);
      victims.add([...tied.dead][0]);
    }
    assert.deepEqual([...victims].sort(), ['v1', 'v2']);
  });

  it('lets a player change their pick until the night ends', () => {
    const game = table();
    game.nightPick('m', 'v1');
    game.nightPick('m', 'v2');
    assert.equal(view(game, 'm').night.pick, 'v2');
    night(game, { doc: 'doc', det: 'v1', v1: 'm', v2: 'm' });
    assert.equal(game.isAlive('v2'), false);
  });

  it('kills someone at random if time runs out before the Mafia pick', () => {
    for (let seed = 1; seed <= 5; seed += 1) {
      const game = table();
      game.rng = seededRng(seed);
      game.nightPick('v1', 'm');
      game.timeOut();
      assert.equal(game.stage, Stage.DAY);
      assert.equal(game.dead.size, 1);
      const [victim] = game.dead;
      assert.ok(['doc', 'det', 'v1', 'v2'].includes(victim), `seed ${seed}: ${victim}`);
    }
  });

  it('rejects moves at the wrong time, from the dead and from spectators', () => {
    const game = table();
    assert.throws(() => game.dayVote('v1', 'm'), { code: 'wrong-stage' });
    night(game, { m: 'v1', doc: 'doc', det: 'v2', v1: 'm', v2: 'm' });
    assert.throws(() => game.nightPick('m', 'v2'), { code: 'wrong-stage' });
    assert.throws(() => game.dayVote('v1', 'm'), { code: 'eliminated' });
    assert.throws(() => game.dayVote('spectator', 'm'), { code: 'not-playing' });
  });
});

describe('MafiaGame days', () => {
  /** A table at Day 1 after the Mafia killed v1. */
  const dayOne = () => {
    const game = table();
    night(game, { m: 'v1', doc: 'doc', det: 'm', v1: 'm', v2: 'm' });
    return game;
  };

  it('waits for every vote, and puts nobody out on a tie', () => {
    const game = dayOne();
    day(game, { m: 'det', doc: 'm', det: 'm' });
    assert.equal(game.stage, Stage.DAY); // v2 still to vote
    game.dayVote('v2', 'det');
    assert.equal(game.stage, Stage.NIGHT);
    assert.equal(game.round, 2);
    assert.equal(game.timerKey, 'night:2');
    assert.deepEqual(game.livingIds, ['m', 'doc', 'det', 'v2']);
    assert.equal(view(game, 'v2').headline, 'The vote was tied, so nobody was voted out.');
  });

  it('wins it for the town when the last Mafia member is voted out', () => {
    const game = dayOne();
    day(game, { m: 'det', doc: 'm', det: 'm', v2: 'm' });
    assert.equal(game.isOver, true);
    assert.deepEqual(game.result, { winner: Team.TOWN, reason: EndReason.MAFIA_GONE, loserId: null });
    assert.match(view(game, 'doc').headline, /Name m was voted out with 3 votes\. They were Mafia \(A♠\)\./);
    assert.equal(view(game, 'doc').result.youWon, true);
    assert.equal(view(game, 'm').result.youWon, false);
    assert.equal(game.timerKey, null);
  });

  it('wins it for the Mafia once they match the town in number', () => {
    const game = rigged({ m: 'AS', doc: 'QH', det: 'KS', v: '7C' });
    night(game, { m: 'v', doc: 'doc', det: 'doc', v: 'm' });
    assert.equal(game.isOver, false); // 1 Mafia against 2
    day(game, { m: 'doc', doc: 'det', det: 'doc' });
    assert.deepEqual(game.result, { winner: Team.MAFIA, reason: EndReason.MAFIA_MAJORITY, loserId: null });
    assert.equal(view(game, 'm').result.youWon, true);
    assert.match(view(game, 'det').log.at(-1), /The Mafia win/);
  });

  it('eliminates nobody when "nobody" gets as many votes as anyone', () => {
    const game = dayOne();
    day(game, { m: null, doc: null, det: 'm', v2: 'm' });
    assert.equal(game.livingIds.length, 4);
    const quiet = dayOne();
    day(quiet, { m: null, doc: null, det: null, v2: 'm' });
    assert.equal(view(quiet, 'v2').headline, 'The town chose not to vote anyone out.');
  });

  it('counts only the votes cast when time runs out', () => {
    const game = dayOne();
    day(game, { doc: 'm' });
    game.timeOut();
    assert.equal(game.isOver, true);
    assert.equal(game.result.winner, Team.TOWN);

    const silent = dayOne();
    silent.timeOut();
    assert.equal(view(silent, 'm').headline, 'Nobody voted, so nobody was voted out.');
  });

  it('lets players change their vote, but not vote for themselves or the dead', () => {
    const game = dayOne();
    game.dayVote('doc', 'det');
    game.dayVote('doc', 'm');
    assert.equal(view(game, 'doc').day.vote, 'm');
    assert.throws(() => game.dayVote('doc', 'doc'), { code: 'invalid-target' });
    assert.throws(() => game.dayVote('doc', 'v1'), { code: 'invalid-target' });
    assert.throws(() => game.dayVote('doc', undefined), { code: 'invalid-target' });
  });
});

describe('MafiaGame players leaving', () => {
  it("reveals a leaver's card, and the town wins if the last Mafia member leaves", () => {
    const game = table();
    game.removePlayer('m');
    assert.equal(game.result.winner, Team.TOWN);
    assert.match(view(game, 'v1').log.join('\n'), /Name m left the game\. They were Mafia \(A♠\)\./);
    assert.equal(view(game, 'v1').seats.find((s) => s.name === 'Name m').hasLeft, true);
  });

  it('drops picks involving a leaver and ends the night if everyone left has picked', () => {
    const game = table();
    night(game, { m: 'v2', doc: 'v2', det: 'v1', v1: 'm' });
    game.removePlayer('v2');
    // The Mafia's and Doctor's picks were on v2, so the night isn't over yet.
    assert.equal(game.stage, Stage.NIGHT);
    assert.equal(view(game, 'm').night.pick, null);
    night(game, { m: 'det', doc: 'doc' });
    assert.equal(game.stage, Stage.DAY);
    assert.equal(game.isAlive('det'), false);
  });

  it('ends the day once everyone still here has voted', () => {
    const game = table();
    night(game, { m: 'v1', doc: 'doc', det: 'm', v1: 'm', v2: 'm' });
    day(game, { m: 'doc', doc: 'm', det: 'm' });
    game.removePlayer('v2');
    assert.match(view(game, 'doc').headline, /Name m was voted out with 2 votes/);
    assert.equal(game.result.winner, Team.TOWN);
  });

  it('wins it for the Mafia if enough of the town leaves', () => {
    const game = table();
    game.removePlayer('v1');
    game.removePlayer('v2');
    assert.equal(game.isOver, false); // 1 Mafia against 2
    game.removePlayer('det');
    assert.equal(game.result.winner, Team.MAFIA);
  });

  it('ignores unknown players and players who already left', () => {
    const game = table();
    game.removePlayer('zzz');
    game.removePlayer('v1');
    game.removePlayer('v1');
    assert.equal(game.log.filter((entry) => entry.kind === 'left').length, 1);
  });
});

describe('MafiaGame views', () => {
  const big = () => rigged({ m1: 'AS', m2: 'AC', doc: 'QH', det: 'KS', v1: '2C', v2: '3D', v3: '4H' });

  it("shows you your own card only, and the Mafia each other's", () => {
    const game = big();
    const villager = view(game, 'v1');
    assert.deepEqual(villager.you, { role: Role.VILLAGER, team: Team.TOWN, card: card('2C').toJSON(), isAlive: true });
    assert.deepEqual(villager.seats.filter((s) => s.role).map((s) => s.name), ['Name v1']);
    for (const secret of ['"AS"', '"AC"', '"QH"', '"KS"']) {
      assert.equal(JSON.stringify(villager).includes(secret), false, secret);
    }
    assert.deepEqual(villager.investigations, []);
    const mafia = view(game, 'm1');
    assert.deepEqual(mafia.seats.filter((s) => s.role).map((s) => s.name), ['Name m1', 'Name m2']);
    assert.equal(JSON.stringify(mafia).includes('"QH"'), false);
  });

  it('gives spectators nothing secret', () => {
    const game = big();
    const spectator = game.viewFor('spectator', nameOf, () => null);
    assert.equal(spectator.isPlaying, false);
    assert.equal(spectator.you, null);
    assert.equal(spectator.night, null);
    assert.equal(spectator.seats.every((s) => s.role === null && s.card === null), true);
  });

  it("keeps night picks private, except between Mafia members", () => {
    const game = big();
    night(game, { m1: 'v1', doc: 'v1', det: 'm2' });
    assert.deepEqual(view(game, 'm2').night.team, [{ name: 'Name m1', pick: 'Name v1' }]);
    assert.equal(view(game, 'm1').night.action, 'kill');
    assert.equal(view(game, 'doc').night.action, 'protect');
    assert.equal(view(game, 'det').night.action, 'investigate');
    assert.equal(view(game, 'v2').night.action, 'suspect');
    for (const id of ['doc', 'det', 'v1', 'v2']) assert.deepEqual(view(game, id).night.team, []);
    assert.equal(view(game, 'v2').night.pick, null);
    assert.equal(view(game, 'doc').night.pick, 'v1');
  });

  it('shows day votes to everyone', () => {
    const game = big();
    night(game, { m1: 'v1', m2: 'v1', doc: 'doc', det: 'm2', v1: 'm1', v2: 'm1', v3: 'm1' });
    day(game, { m1: 'det', v2: 'm2', v3: null });
    const seen = view(game, 'doc');
    const seat = (name) => seen.seats.find((s) => s.name === name);
    assert.deepEqual([seat('Name det').votes, seat('Name m2').votes], [1, 1]);
    assert.deepEqual([seat('Name m1').hasVoted, seat('Name m1').votedFor], [true, 'Name det']);
    assert.deepEqual([seat('Name v3').hasVoted, seat('Name v3').votedFor], [true, null]);
    assert.deepEqual([seat('Name doc').hasVoted, seat('Name doc').votedFor], [false, null]);
    assert.deepEqual(
      { votesCast: seen.day.votesCast, voters: seen.day.voters, nobodyVotes: seen.day.nobodyVotes },
      { votesCast: 3, voters: 6, nobodyVotes: 1 },
    );
    assert.equal(seen.day.canVote, true);
    assert.equal(view(game, 'v1').day.canVote, false); // dead
  });

  it("reveals the dead's cards to everyone, and every card at the end", () => {
    const game = table();
    night(game, { m: 'v1', doc: 'doc', det: 'm', v1: 'm', v2: 'm' });
    assert.deepEqual(view(game, 'v2').seats.find((s) => s.name === 'Name v1').card, card('7C').toJSON());
    assert.equal(view(game, 'v2').seats.find((s) => s.name === 'Name m').card, null);
    day(game, { m: 'det', doc: 'm', det: 'm', v2: 'm' });
    const end = game.viewFor('spectator', nameOf, () => null);
    assert.equal(end.stage, 'over');
    assert.equal(end.seats.every((s) => s.role !== null), true);
  });

  it('always reaches a winner when everyone plays at random', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const rng = seededRng(seed);
      const pick = (items) => items[Math.floor(rng() * items.length)];
      const settings = new GameSettings({ doctor: seed % 3 !== 0, detective: seed % 4 !== 0 });
      const game = new MafiaGame({ playerIds: ids(4 + (seed % 17)), settings, rng });
      for (let steps = 0; !game.isOver; steps += 1) {
        if (steps > 1000) throw new Error(`seed ${seed}: game did not finish`);
        if (rng() < 0.1) {
          game.timeOut();
          continue;
        }
        const actor = pick(game.livingIds);
        const seen = view(game, actor);
        if (game.stage === Stage.NIGHT) game.nightPick(actor, pick(seen.night.choices));
        else game.dayVote(actor, rng() < 0.2 ? null : pick(seen.day.choices));
      }
      const mafiaLeft = game.livingIds.filter((id) => game.roleOf(id) === Role.MAFIA).length;
      assert.equal(game.result.winner === Team.TOWN, mafiaLeft === 0, `seed ${seed}`);
    }
  });
});
