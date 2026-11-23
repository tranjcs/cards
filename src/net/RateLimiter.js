'use strict';

/**
 * Token bucket: allows bursts of up to `capacity` events, refilled at `perSecond`.
 * One per socket, so a single client can't flood the server.
 */
class RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.capacity - largest burst
   * @param {number} options.perSecond - sustained rate
   * @param {() => number} [options.now] - clock in ms, injectable for tests
   */
  constructor({ capacity, perSecond, now = Date.now }) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.now = now;
    this.tokens = capacity;
    this.updatedAt = now();
  }

  /** @returns {boolean} whether the event is allowed (and consumes a token if so) */
  tryConsume() {
    const now = this.now();
    const refill = ((now - this.updatedAt) / 1000) * this.perSecond;
    this.tokens = Math.min(this.capacity, this.tokens + refill);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

module.exports = { RateLimiter };
