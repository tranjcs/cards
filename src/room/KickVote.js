'use strict';

/**
 * Guests' votes to remove the host. Passes once votes from `needed` distinct voter keys
 * are in. The key is normally the voter's IP address, so opening several tabs doesn't
 * give one person several votes.
 */
class KickVote {
  /** @param {number} needed - minimum number of distinct votes */
  constructor(needed) {
    if (!Number.isInteger(needed) || needed < 1) throw new RangeError(`Invalid vote threshold: ${needed}`);
    this.needed = needed;
    /** @type {Map<string, string>} voter id -> the key their vote counts under */
    this.voters = new Map();
  }

  /** Distinct votes. */
  get count() {
    return new Set(this.voters.values()).size;
  }

  get passed() {
    return this.count >= this.needed;
  }

  /**
   * Casts or withdraws a vote.
   * @param {string} voterId
   * @param {string} [key] - votes with the same key count once
   * @returns {boolean} whether the voter is now voting
   */
  toggle(voterId, key = voterId) {
    if (this.voters.delete(voterId)) return false;
    this.voters.set(voterId, key);
    return true;
  }

  /** @param {string} voterId */
  hasVoted(voterId) {
    return this.voters.has(voterId);
  }

  /** Drops a voter who left. */
  withdraw(voterId) {
    this.voters.delete(voterId);
  }

  reset() {
    this.voters.clear();
  }
}

module.exports = { KickVote };
