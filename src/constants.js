'use strict';

/** What the room is doing. */
const Phase = Object.freeze({
  LOBBY: 'lobby', // waiting for the host to start
  PLAYING: 'playing', // a game is in progress
  FINISHED: 'finished', // a game just ended; the host can start another
});

/** Why a player was removed from the room. */
const KickReason = Object.freeze({
  HOST: 'host', // the host kicked them
  VOTE: 'vote', // they were the host and the guests voted them out
  IDLE: 'idle', // no activity for too long
});

/** Socket.IO event names shared by server and client (keep in sync with public/js/client.js). */
const Events = Object.freeze({
  // server -> client
  STATE: 'state',
  ERROR: 'action-error',
  KICKED: 'kicked',
  // client -> server
  UPDATE_SETTINGS: 'update-settings',
  START_GAME: 'start-game',
  END_GAME: 'end-game',
  KICK_PLAYER: 'kick-player',
  VOTE_KICK_HOST: 'vote-kick-host',
  DRAW_FROM_PLAYER: 'draw-from-player',
  DRAW_FROM_PILE: 'draw-from-pile',
  ACTIVE: 'active', // heartbeat: someone is using this tab
});

module.exports = { Phase, KickReason, Events };
