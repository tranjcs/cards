'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { GameSettings, DEAL_ALL } = require('../src/game/GameSettings');
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
});
