'use strict';

/** Guests' votes to remove the host. Passes once `needed` distinct guests have voted. */
class KickVote {
  /** @param {number} needed - minimum number of votes */
  constructor(needed) {
    if (!Number.isInteger(needed) || needed < 1) throw new RangeError(`Invalid vote threshold: ${needed}`);
    this.needed = needed;
    /** @type {Set<string>} voter ids */
    this.voters = new Set();
  }

  get count() {
    return this.voters.size;
  }

  get passed() {
    return this.voters.size >= this.needed;
  }

  /**
   * Casts or withdraws a vote.
   * @param {string} voterId
   * @returns {boolean} whether the voter is now voting
   */
  toggle(voterId) {
    if (this.voters.delete(voterId)) return false;
    this.voters.add(voterId);
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
