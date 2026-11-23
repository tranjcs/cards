'use strict';

/** Caps how many simultaneous connections one address may hold. */
class ConnectionLimiter {
  /** @param {number} maxPerAddress - 0 means unlimited */
  constructor(maxPerAddress) {
    this.maxPerAddress = maxPerAddress;
    /** @type {Map<string, number>} */
    this.counts = new Map();
  }

  /**
   * @param {string} address
   * @returns {boolean} whether the connection is allowed (and counted)
   */
  tryAcquire(address) {
    const count = this.counts.get(address) ?? 0;
    if (this.maxPerAddress > 0 && count >= this.maxPerAddress) return false;
    this.counts.set(address, count + 1);
    return true;
  }

  /** @param {string} address */
  release(address) {
    const count = (this.counts.get(address) ?? 0) - 1;
    if (count > 0) this.counts.set(address, count);
    else this.counts.delete(address);
  }
}

module.exports = { ConnectionLimiter };
