'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TurnOrder } = require('../src/game/TurnOrder');

describe('TurnOrder', () => {
  it('starts at the given seat and goes clockwise, wrapping around', () => {
    const order = new TurnOrder(['a', 'b', 'c'], 1);
    assert.equal(order.current, 'b');
    assert.equal(order.advance(), 'c');
    assert.equal(order.advance(), 'a');
    assert.equal(order.advance(), 'b');
  });

  it('rejects an empty table or invalid start seat', () => {
    assert.throws(() => new TurnOrder([]), RangeError);
    assert.throws(() => new TurnOrder(['a'], 1), RangeError);
  });

  it('skips seats that do not qualify', () => {
    const order = new TurnOrder(['a', 'b', 'c', 'd']);
    assert.equal(order.advance((id) => id !== 'b' && id !== 'c'), 'd');
  });

  it('keeps the turn when only the current seat qualifies, and returns null when none do', () => {
    const order = new TurnOrder(['a', 'b']);
    assert.equal(order.advance((id) => id === 'a'), 'a');
    assert.equal(order.advance(() => false), null);
    assert.equal(order.current, 'a');
  });

  it('finds the next seat after another one, never itself', () => {
    const order = new TurnOrder(['a', 'b', 'c']);
    assert.equal(order.nextAfter('c'), 'a');
    assert.equal(order.nextAfter('a', (id) => id === 'a'), null);
    assert.equal(order.nextAfter('zzz'), null);
  });

  it('passes the turn on when the current seat is removed', () => {
    const order = new TurnOrder(['a', 'b', 'c'], 1);
    order.remove('b');
    assert.equal(order.current, 'c');
    order.remove('c');
    assert.equal(order.current, 'a');
  });

  it('keeps the current seat when an earlier seat is removed', () => {
    const order = new TurnOrder(['a', 'b', 'c'], 2);
    assert.equal(order.remove('a'), true);
    assert.equal(order.current, 'c');
    assert.equal(order.remove('a'), false);
  });

  it('settles on the current seat if it qualifies, otherwise advances', () => {
    const order = new TurnOrder(['a', 'b', 'c']);
    assert.equal(order.settle(() => true), 'a');
    assert.equal(order.settle((id) => id === 'c'), 'c');
  });
});
