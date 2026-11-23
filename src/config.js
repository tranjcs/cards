'use strict';

const DEFAULT_PORT = 3000;
const DEFAULT_TURN_TIMEOUT_MS = 30000;
const DEFAULT_HOST_KICK_VOTES = 5;
const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_MAX_ROOM_SIZE = 50;
const DEFAULT_MAX_CONNECTIONS_PER_IP = 6;
const DEFAULT_KICK_BAN_MS = 5 * 60 * 1000;

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

module.exports = Object.freeze({
  port: parsePositiveInt(process.env.PORT, DEFAULT_PORT),
  turnTimeoutMs: parsePositiveInt(process.env.TURN_TIMEOUT_MS, DEFAULT_TURN_TIMEOUT_MS),
  hostKickVotes: parsePositiveInt(process.env.HOST_KICK_VOTES, DEFAULT_HOST_KICK_VOTES),
  idleTimeoutMs: parsePositiveInt(process.env.IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
  maxRoomSize: parsePositiveInt(process.env.MAX_ROOM_SIZE, DEFAULT_MAX_ROOM_SIZE),
  // 0 = unlimited.
  maxConnectionsPerIp: parseNonNegativeInt(process.env.MAX_CONNECTIONS_PER_IP, DEFAULT_MAX_CONNECTIONS_PER_IP),
  // 0 = kicked players may rejoin at once.
  kickBanMs: parseNonNegativeInt(process.env.KICK_BAN_MS, DEFAULT_KICK_BAN_MS),
  // Set to false to test host-kick votes from several tabs on one machine.
  oneVotePerIp: parseBoolean(process.env.ONE_VOTE_PER_IP, true),
  // Number of proxies in front of the server that append to X-Forwarded-For (1 on Cloud Run).
  // Leave at 0 when clients connect directly, or anyone could fake their address.
  trustedProxyHops: parseNonNegativeInt(process.env.TRUSTED_PROXY_HOPS, 0),
  parsePositiveInt,
  parseNonNegativeInt,
  parseBoolean,
});
