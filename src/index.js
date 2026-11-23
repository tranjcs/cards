'use strict';

const config = require('./config');
const { createApp } = require('./app');

const { server, io } = createApp({
  turnTimeoutMs: config.turnTimeoutMs,
  hostKickVotes: config.hostKickVotes,
  idleTimeoutMs: config.idleTimeoutMs,
  maxRoomSize: config.maxRoomSize,
  maxConnectionsPerIp: config.maxConnectionsPerIp,
  kickBanMs: config.kickBanMs,
  oneVotePerIp: config.oneVotePerIp,
  trustedProxyHops: config.trustedProxyHops,
});

server.listen(config.port, () => {
  console.log(`Cards running on http://localhost:${config.port}`);
});

const SHUTDOWN_TIMEOUT_MS = 5000;

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  // Force exit if open connections keep the server from closing in time.
  setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  io.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
