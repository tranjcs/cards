'use strict';

const DEFAULT_PORT = 3000;
const DEFAULT_TURN_TIMEOUT_MS = 30000;
const DEFAULT_HOST_KICK_VOTES = 5;
const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

module.exports = Object.freeze({
  port: parsePositiveInt(process.env.PORT, DEFAULT_PORT),
  turnTimeoutMs: parsePositiveInt(process.env.TURN_TIMEOUT_MS, DEFAULT_TURN_TIMEOUT_MS),
  hostKickVotes: parsePositiveInt(process.env.HOST_KICK_VOTES, DEFAULT_HOST_KICK_VOTES),
  idleTimeoutMs: parsePositiveInt(process.env.IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
  parsePositiveInt,
});
