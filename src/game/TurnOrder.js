'use strict';

/**
 * Seats around a table and whose turn it is. Play goes clockwise, which is the
 * order of the `seats` array (wrapping around from the last seat to the first).
 * @template Id
 */
class TurnOrder {
  /**
   * @param {Id[]} seats - player ids, clockwise
   * @param {number} [startIndex] - seat that plays first
   */
  constructor(seats, startIndex = 0) {
    if (seats.length === 0) throw new RangeError('A table needs at least one seat');
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= seats.length) {
      throw new RangeError(`Invalid start seat: ${startIndex}`);
    }
    /** @type {Id[]} */
    this.seats = [...seats];
    this.currentIndex = startIndex;
  }

  /** @returns {Id|null} whose turn it is */
  get current() {
    return this.seats[this.currentIndex] ?? null;
  }

  /**
   * The first seat clockwise after `from` that satisfies `predicate`, never `from` itself.
   * @param {Id} from
   * @param {(id: Id) => boolean} [predicate]
   * @returns {Id|null}
   */
  nextAfter(from, predicate = () => true) {
    const start = this.seats.indexOf(from);
    if (start === -1) return null;
    for (let step = 1; step < this.seats.length; step += 1) {
      const id = this.seats[(start + step) % this.seats.length];
      if (predicate(id)) return id;
    }
    return null;
  }

  /**
   * Passes the turn clockwise to the next seat that satisfies `predicate`. If no other
   * seat does, the turn stays with the current seat when it qualifies.
   * @param {(id: Id) => boolean} [predicate]
   * @returns {Id|null} the new current seat, or null if nobody qualifies
   */
  advance(predicate = () => true) {
    const current = this.current;
    const next = this.nextAfter(current, predicate) ?? (predicate(current) ? current : null);
    if (next !== null) this.currentIndex = this.seats.indexOf(next);
    return next;
  }

  /**
   * Keeps the turn where it is if the current seat qualifies; otherwise advances.
   * @param {(id: Id) => boolean} predicate
   * @returns {Id|null}
   */
  settle(predicate) {
    return predicate(this.current) ? this.current : this.advance(predicate);
  }

  /**
   * Removes a seat. If it was that seat's turn, the turn moves to the next seat clockwise.
   * @param {Id} id
   * @returns {boolean} whether the seat existed
   */
  remove(id) {
    const index = this.seats.indexOf(id);
    if (index === -1) return false;
    this.seats.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex -= 1;
    if (this.currentIndex >= this.seats.length) this.currentIndex = 0;
    return true;
  }

  /** @param {Id} id */
  has(id) {
    return this.seats.includes(id);
  }
}

module.exports = { TurnOrder };
