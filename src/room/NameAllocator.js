'use strict';

// Only names the server itself would hand out may be reclaimed on reconnect.
const NAME_PATTERN = /^Player ([1-9]\d{0,5})$/;

/** Hands out unique names like "Player 3", letting a reconnecting tab reclaim its old one. */
class NameAllocator {
  constructor() {
    this.highest = 0;
  }

  /**
   * @param {unknown} requested - untrusted name the client had before reconnecting
   * @param {(name: string) => boolean} isTaken
   * @returns {string}
   */
  allocate(requested, isTaken) {
    const match = typeof requested === 'string' ? NAME_PATTERN.exec(requested) : null;
    if (match && !isTaken(requested)) {
      // Keep new numbers above any reclaimed one so they never collide.
      this.highest = Math.max(this.highest, Number(match[1]));
      return requested;
    }
    let name;
    do {
      this.highest += 1;
      name = `Player ${this.highest}`;
    } while (isTaken(name));
    return name;
  }
}

module.exports = { NameAllocator };
