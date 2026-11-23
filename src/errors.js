'use strict';

/**
 * A rejected player action (not your turn, not the host, bad input...).
 * The message is safe to show to the player who caused it.
 */
class ActionError extends Error {
  /**
   * @param {string} code - stable, machine-readable reason
   * @param {string} message - human-readable reason
   */
  constructor(code, message) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

module.exports = { ActionError };
