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

describe('GameSettings game choice', () => {
  it('plays Old Maid by default and can switch to Go Fish', () => {
    const settings = new GameSettings();
    assert.equal(settings.game, 'old-maid');
    assert.equal(settings.with({ game: 'go-fish' }).game, 'go-fish');
  });

  it('resets the deal size when the game changes, unless one is given', () => {
    const seven = new GameSettings().with({ cardsPerPlayer: 7 });
    assert.equal(seven.with({ game: 'go-fish' }).cardsPerPlayer, DEAL_ALL);
    assert.equal(seven.with({ game: 'go-fish', cardsPerPlayer: 4 }).cardsPerPlayer, 4);
    assert.equal(seven.with({ game: 'old-maid' }).cardsPerPlayer, 7);
  });

  it('rejects unknown games', () => {
    for (const game of ['poker', '', 1, null]) {
      assert.throws(() => new GameSettings().with({ game }), ActionError, `game ${game}`);
    }
  });
});
