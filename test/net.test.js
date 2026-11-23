'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('../src/net/RateLimiter');
const { ConnectionLimiter } = require('../src/net/ConnectionLimiter');
const { clientAddress, isSameOrigin } = require('../src/net/requests');
const { parseBoolean, parseNonNegativeInt } = require('../src/config');

const request = (headers, remoteAddress = '10.0.0.9') => ({ headers, socket: { remoteAddress } });

describe('RateLimiter', () => {
  it('allows a burst, then refills over time', () => {
    let now = 0;
    const limiter = new RateLimiter({ capacity: 3, perSecond: 2, now: () => now });
    assert.deepEqual([1, 2, 3, 4].map(() => limiter.tryConsume()), [true, true, true, false]);
    now = 500; // one token back
    assert.equal(limiter.tryConsume(), true);
    assert.equal(limiter.tryConsume(), false);
    now = 60000; // never more than capacity
    assert.deepEqual([1, 2, 3, 4].map(() => limiter.tryConsume()), [true, true, true, false]);
  });
});

describe('ConnectionLimiter', () => {
  it('caps connections per address and frees slots on release', () => {
    const limiter = new ConnectionLimiter(2);
    assert.equal(limiter.tryAcquire('a'), true);
    assert.equal(limiter.tryAcquire('a'), true);
    assert.equal(limiter.tryAcquire('a'), false);
    assert.equal(limiter.tryAcquire('b'), true);
    limiter.release('a');
    assert.equal(limiter.tryAcquire('a'), true);
  });

  it('is unlimited with 0', () => {
    const limiter = new ConnectionLimiter(0);
    for (let i = 0; i < 100; i += 1) assert.equal(limiter.tryAcquire('a'), true);
  });

  it('forgets addresses with no connections', () => {
    const limiter = new ConnectionLimiter(1);
    limiter.tryAcquire('a');
    limiter.release('a');
    assert.equal(limiter.counts.size, 0);
  });
});

describe('clientAddress', () => {
  it('uses the socket address when no proxy is trusted, ignoring X-Forwarded-For', () => {
    assert.equal(clientAddress(request({ 'x-forwarded-for': '1.1.1.1' }), 0), '10.0.0.9');
  });

  it('takes the entry added by the trusted proxy, not ones the client supplied', () => {
    const req = request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' });
    assert.equal(clientAddress(req, 1), '203.0.113.7');
    assert.equal(clientAddress(request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.1.1.1' }), 2), '203.0.113.7');
  });

  it('falls back to the socket address when the header is missing', () => {
    assert.equal(clientAddress(request({}), 1), '10.0.0.9');
  });
});

describe('isSameOrigin', () => {
  it('allows same-origin and Origin-less requests', () => {
    assert.equal(isSameOrigin(request({ host: 'cards.example', origin: 'https://cards.example' })), true);
    assert.equal(isSameOrigin(request({ host: 'cards.example' })), true);
  });

  it('refuses other origins and garbage', () => {
    assert.equal(isSameOrigin(request({ host: 'cards.example', origin: 'https://evil.example' })), false);
    assert.equal(isSameOrigin(request({ host: 'cards.example', origin: 'null' })), false);
  });
});

describe('config parsing', () => {
  it('parses booleans and non-negative integers', () => {
    assert.equal(parseBoolean(undefined, true), true);
    assert.equal(parseBoolean('false', true), false);
    assert.equal(parseBoolean('0', true), false);
    assert.equal(parseBoolean('true', false), true);
    assert.equal(parseNonNegativeInt('0', 5), 0);
    assert.equal(parseNonNegativeInt('-1', 5), 5);
    assert.equal(parseNonNegativeInt('x', 5), 5);
  });
});
