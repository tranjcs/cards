'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { GameSettings, DEAL_ALL, AUTO_MAFIA, MAX_MAFIA } = require('../src/game/GameSettings');
const { GameType } = require('../src/constants');
const { ActionError } = require('../src/errors');

describe('GameSettings', () => {
  it('deals every card by default', () => {
    const settings = new GameSettings();
    assert.equal(settings.cardsPerPlayer, DEAL_ALL);
    assert.equal(settings.dealsAll, true);
  });

  it('returns a new instance with changes applied', () => {
    const original = new GameSettings();
    const changed = original.with({ cardsPerPlayer: 7 });
    assert.equal(changed.cardsPerPlayer, 7);
    assert.equal(original.cardsPerPlayer, DEAL_ALL);
    assert.equal(changed.with({}).cardsPerPlayer, 7);
  });

  it('rejects invalid values', () => {
    for (const value of [-1, 1.5, '5', 52, null]) {
      assert.throws(() => new GameSettings().with({ cardsPerPlayer: value }), ActionError, `value ${value}`);
    }
    assert.throws(() => new GameSettings().with('nope'), ActionError);
  });

  it('picks Old Maid by default and can switch games, keeping each game\'s options', () => {
    const settings = new GameSettings({ cardsPerPlayer: 5 });
    assert.equal(settings.game, GameType.OLD_MAID);
    const mafia = settings.with({ game: GameType.MAFIA, mafiaCount: 2 });
    assert.deepEqual(mafia.toJSON(), {
      game: GameType.MAFIA, cardsPerPlayer: 5, mafiaCount: 2, doctor: true, detective: true, dayMinutes: 3,
    });
    assert.equal(mafia.with({ game: GameType.OLD_MAID }).mafiaCount, 2);
  });

  it('has Mafia defaults: auto Mafia count, a Doctor, a Detective and 3-minute days', () => {
    const settings = new GameSettings();
    assert.equal(settings.mafiaCount, AUTO_MAFIA);
    assert.equal(settings.doctor, true);
    assert.equal(settings.detective, true);
    assert.equal(settings.dayMinutes, 3);
    assert.equal(settings.with({ doctor: false, dayMinutes: 10 }).doctor, false);
  });

  it('rejects invalid games and Mafia options', () => {
    const bad = [
      { game: 'poker' }, { game: null }, { game: '__proto__' },
      { mafiaCount: -1 }, { mafiaCount: MAX_MAFIA + 1 }, { mafiaCount: '2' },
      { doctor: 'yes' }, { detective: 1 }, { doctor: null },
      { dayMinutes: 0 }, { dayMinutes: 11 }, { dayMinutes: 2.5 },
    ];
    for (const changes of bad) {
      assert.throws(() => new GameSettings().with(changes), ActionError, JSON.stringify(changes));
    }
  });
});
