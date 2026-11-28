/* global io, CardView, MafiaView */
'use strict';

(() => {
  // Keep in sync with src/constants.js.
  const Phase = { LOBBY: 'lobby', PLAYING: 'playing', FINISHED: 'finished' };
  const GameType = { OLD_MAID: 'old-maid', MAFIA: 'mafia' };
  const Events = {
    STATE: 'state',
    ERROR: 'action-error',
    KICKED: 'kicked',
    UPDATE_SETTINGS: 'update-settings',
    START_GAME: 'start-game',
    END_GAME: 'end-game',
    KICK_PLAYER: 'kick-player',
    VOTE_KICK_HOST: 'vote-kick-host',
    DRAW_FROM_PLAYER: 'draw-from-player',
    DRAW_FROM_PILE: 'draw-from-pile',
    NIGHT_PICK: 'night-pick',
    DAY_VOTE: 'day-vote',
    ACTIVE: 'active',
  };
  const KICK_MESSAGES = {
    host: 'The host removed you from the room.',
    vote: 'The other players voted you out as host.',
    idle: 'You were disconnected for being inactive.',
    banned: 'You were kicked from this room recently. Try again in a few minutes.',
    'room-full': 'The room is full. Try again later.',
    'too-many-connections': 'Too many tabs are open from your network. Close one and rejoin.',
  };
  const NAME_KEY = 'cards:name';
  const HEARTBEAT_MS = 60 * 1000;
  const TOAST_MS = 3500;
  const DEAL_ALL = 0;
  const AUTO_MAFIA = 0;
  const DAY_MINUTES = [1, 2, 3, 5, 7, 10];

  // sessionStorage is per tab, so each tab is its own player. It can throw in
  // private windows or with storage blocked; the game works without it.
  const storage = {
    get() {
      try { return sessionStorage.getItem(NAME_KEY); } catch { return null; }
    },
    set(value) {
      try { sessionStorage.setItem(NAME_KEY, value); } catch { /* ignore */ }
    },
  };

  // Send the saved name on every (re)connect so the server can give it back.
  const socket = io({ auth: (cb) => cb({ name: storage.get() }) });

  const $ = (id) => document.getElementById(id);
  const ui = {
    gameTitle: $('game-title'),
    me: $('me'),
    status: $('status'),
    table: $('table'),
    timer: $('timer'),
    timerFill: $('timer-fill'),
    seats: $('seats'),
    drawPile: $('draw-pile'),
    drawCount: $('draw-count'),
    discardPile: $('discard-pile'),
    discardCount: $('discard-count'),
    pick: $('pick'),
    pickLabel: $('pick-label'),
    pickCards: $('pick-cards'),
    lastDraw: $('last-draw'),
    hand: $('hand'),
    handCount: $('hand-count'),
    result: $('result'),
    log: $('log'),
    players: $('players'),
    playerCount: $('player-count'),
    hostControls: $('host-controls'),
    gameType: $('game-type'),
    oldMaidOptions: $('old-maid-options'),
    cardsPerPlayer: $('cards-per-player'),
    mafiaOptions: $('mafia-options'),
    mafiaCount: $('mafia-count'),
    mafiaDoctor: $('mafia-doctor'),
    mafiaDetective: $('mafia-detective'),
    dayMinutes: $('day-minutes'),
    rulesOldMaid: $('rules-old-maid'),
    rulesMafia: $('rules-mafia'),
    start: $('start'),
    end: $('end'),
    guestControls: $('guest-controls'),
    waitingHost: $('waiting-host'),
    voteKick: $('vote-kick'),
    activity: $('activity'),
    toast: $('toast'),
    kicked: $('kicked'),
    kickedMessage: $('kicked-message'),
    rejoin: $('rejoin'),
  };

  /** Creates an element with a class and optional text. */
  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  /** Replaces a list's items with one <li> per string. */
  function renderList(listEl, lines) {
    listEl.replaceChildren(...lines.map((line) => make('li', '', line)));
  }

  /** Replaces a <select>'s options with [value, text] pairs and selects `value`. */
  function fillSelect(select, options, value) {
    select.replaceChildren(...options.map(([optionValue, text]) => {
      const option = make('option', '', text);
      option.value = String(optionValue);
      return option;
    }));
    select.value = String(value);
  }

  /** The game being played, or else the one the host has picked. */
  function shownGame(state) {
    const type = state.game ? state.game.type : state.settings.game;
    return state.games.find((game) => game.id === type) ?? state.games[0];
  }

  // ---- timer -------------------------------------------------------------

  let timerInterval = null;

  /** Each game's countdown, and how to label it. */
  const TIMERS = {
    [GameType.OLD_MAID]: {
      text: ui.timer,
      fill: ui.timerFill,
      label: (game) => (game.isYourTurn ? 'Your turn' : `${game.turn}'s turn`),
    },
    [GameType.MAFIA]: { text: $('mafia-timer'), fill: $('mafia-timer-fill'), label: (game) => MafiaView.timerLabel(game) },
  };

  /** "45s", or "2:05" from a minute up. */
  function formatSeconds(ms) {
    const seconds = Math.ceil(ms / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function renderTimer(game) {
    clearInterval(timerInterval);
    const running = Boolean(game && !game.result && game.turnRemainingMs !== null);
    for (const [type, timer] of Object.entries(TIMERS)) {
      const show = running && game.type === type;
      timer.text.hidden = !show;
      timer.fill.parentElement.hidden = !show;
    }
    if (!running) return;
    const timer = TIMERS[game.type];
    const deadline = Date.now() + game.turnRemainingMs;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      timer.text.textContent = `${timer.label(game)} · ${formatSeconds(remaining)}`;
      timer.fill.style.width = `${(remaining / game.turnTimeoutMs) * 100}%`;
      timer.fill.classList.toggle('turn-timer__fill--low', remaining < 5000);
      if (remaining === 0) clearInterval(timerInterval);
    };
    tick();
    timerInterval = setInterval(tick, 250);
  }

  // ---- status ------------------------------------------------------------

  function statusText(state) {
    const { game, phase } = state;
    if (phase === Phase.LOBBY) {
      const { name } = shownGame(state);
      if (state.members.length < state.limits.minPlayers) {
        return `${name} needs at least ${state.limits.minPlayers} players. Waiting for more to join…`;
      }
      return state.you.isHost ? 'Pick a game and its settings, then start.' : `Waiting for ${state.host} to start ${name}…`;
    }
    if (game.type === GameType.MAFIA) return MafiaView.statusText(game);
    if (phase === Phase.FINISHED) {
      if (!game.result.loser) return 'Game over: not enough players.';
      return game.result.youLost ? "You're stuck with the Old Maid! 👵" : `${game.result.loser} is stuck with the Old Maid!`;
    }
    if (!game.isPlaying) return `Watching: ${game.turn}'s turn. You'll be dealt in next game.`;
    if (game.isYourTurn) {
      if (game.target && game.canDrawFromPile) return `Your turn! Take a card from ${game.target.name} or draw from the pile.`;
      if (game.target) return `Your turn! Take a card from ${game.target.name}.`;
      return 'Your turn! Draw from the pile.';
    }
    if (game.safe.includes(state.you.name)) return "You're safe! 🎉 Watch the others finish.";
    return `${game.turn}'s turn…`;
  }

  // ---- table -------------------------------------------------------------

  function renderSeats(game) {
    ui.seats.replaceChildren(...game.seats.map((seat) => {
      const li = make('li', 'seat');
      li.classList.toggle('seat--turn', seat.isTurn);
      li.classList.toggle('seat--you', seat.isYou);
      li.classList.toggle('seat--target', seat.isTarget);
      li.classList.toggle('seat--safe', seat.isSafe);
      li.classList.toggle('seat--loser', seat.isLoser);

      const name = make('span', 'seat__name', seat.isYou ? `${seat.name} (you)` : seat.name);
      const count = make('span', 'seat__count', `${seat.cardCount} ${seat.cardCount === 1 ? 'card' : 'cards'}`);
      const fan = make('div', 'seat__fan');
      if (seat.hand) {
        seat.hand.forEach((card) => fan.appendChild(CardView.face(card, 'card--mini')));
      } else {
        const shown = Math.min(seat.cardCount, 8);
        for (let i = 0; i < shown; i += 1) fan.appendChild(CardView.back({ extraClass: 'card--mini' }));
      }
      const badges = [];
      if (seat.isTurn) badges.push('▶ turn');
      if (seat.isSafe) badges.push('✓ safe');
      if (seat.isLoser) badges.push('👵 old maid');
      li.append(name, count, fan);
      if (badges.length) li.appendChild(make('span', 'seat__badge', badges.join(' · ')));
      return li;
    }));
  }

  function renderPiles(game) {
    ui.drawPile.replaceChildren();
    if (game.drawPile.count > 0) ui.drawPile.appendChild(CardView.back());
    ui.drawPile.disabled = !game.canDrawFromPile;
    ui.drawPile.classList.toggle('pile__stack--active', game.canDrawFromPile);
    ui.drawPile.setAttribute('aria-label', `Draw pile, ${game.drawPile.count} cards${game.canDrawFromPile ? ': click to draw' : ''}`);
    ui.drawCount.textContent = `Draw pile · ${game.drawPile.count}`;

    ui.discardPile.replaceChildren(...game.discardPile.top.map((card) => CardView.face(card)));
    ui.discardCount.textContent = `Discards · ${game.discardPile.count}`;
  }

  function renderPick(game) {
    const show = Boolean(game.isYourTurn && game.target);
    ui.pick.hidden = !show;
    if (!show) return;
    const { name, cardCount } = game.target;
    ui.pickLabel.textContent = `Pick a card from ${name}:`;
    ui.pickCards.replaceChildren(...Array.from({ length: cardCount }, (_, index) => CardView.back({
      extraClass: 'card--pickable',
      label: `Take card ${index + 1} of ${cardCount} from ${name}`,
      onClick: () => socket.emit(Events.DRAW_FROM_PLAYER, index),
    })));
  }

  function lastDrawText(lastDraw) {
    if (!lastDraw) return '';
    const card = CardView.label(lastDraw.card);
    if (lastDraw.you === 'took') return lastDraw.from ? `You took ${card} from ${lastDraw.from}.` : `You drew ${card}.`;
    return `${lastDraw.to} took your ${card}.`;
  }

  function renderHand(game) {
    const cards = game.hand ?? [];
    ui.hand.closest('.hand-wrap').hidden = !game.isPlaying;
    ui.handCount.textContent = `(${cards.length})`;
    ui.hand.replaceChildren(...cards.map((card) => CardView.face(card)));
    if (game.isPlaying && cards.length === 0) {
      ui.hand.appendChild(make('p', 'hint', game.result ? 'No cards left.' : 'No cards — you can still draw from the pile.'));
    }
  }

  function renderResult(game) {
    ui.result.hidden = !game.result;
    if (!game.result) return;
    ui.result.classList.toggle('result--lost', game.result.youLost);
    ui.result.textContent = game.result.loser
      ? (game.result.youLost ? 'You lost — you hold the Old Maid! 👵' : `${game.result.loser} holds the Old Maid! 👵`)
      : 'Game over: everyone else left.';
  }

  /** Old Maid's table. @param {object|null} game */
  function renderTable(game) {
    ui.table.hidden = !game;
    if (!game) return;
    renderSeats(game);
    renderPiles(game);
    renderPick(game);
    ui.lastDraw.textContent = lastDrawText(game.lastDraw);
    renderHand(game);
    renderResult(game);
    renderList(ui.log, [...game.log].reverse());
  }

  // ---- lobby -------------------------------------------------------------

  function renderPlayers(state) {
    ui.playerCount.textContent = `(${state.members.length})`;
    ui.players.replaceChildren(...state.members.map((member) => {
      const li = make('li', 'player');
      li.appendChild(make('span', 'avatar', member.name.replace(/\D/g, '') || member.name.charAt(0)));
      const name = make('span', 'player__name', member.name);
      if (member.isHost) name.appendChild(make('span', 'tag tag--host', '👑 host'));
      if (member.isYou) name.appendChild(make('span', 'tag', 'you'));
      if (state.game && !member.inGame) name.appendChild(make('span', 'tag', 'watching'));
      li.appendChild(name);
      if (state.you.isHost && !member.isYou) {
        const kick = make('button', 'button button--small button--danger', 'Kick');
        kick.type = 'button';
        kick.setAttribute('aria-label', `Kick ${member.name}`);
        kick.addEventListener('click', () => {
          if (window.confirm(`Kick ${member.name} from the room?`)) socket.emit(Events.KICK_PLAYER, member.id);
        });
        li.appendChild(kick);
      }
      return li;
    }));
  }

  /** 1..max as options, keeping a saved value visible (marked) if it's now above the cap. */
  function countOptions(first, max, saved) {
    const options = [first];
    for (let n = 1; n <= max; n += 1) options.push([n, String(n)]);
    if (saved > max) options.push([saved, `${saved} (capped to ${max})`]);
    return options;
  }

  function renderHostControls(state) {
    const { you, phase, settings } = state;
    ui.hostControls.hidden = !you.isHost;
    if (!you.isHost) return;
    const playing = phase === Phase.PLAYING;
    const mafia = settings.game === GameType.MAFIA;

    fillSelect(ui.gameType, state.games.map((game) => [game.id, `${game.name} (${game.minPlayers}–${game.maxPlayers} players)`]), settings.game);
    ui.gameType.disabled = playing;
    ui.oldMaidOptions.hidden = mafia;
    ui.mafiaOptions.hidden = !mafia;
    ui.oldMaidOptions.disabled = playing;
    ui.mafiaOptions.disabled = playing;

    fillSelect(
      ui.cardsPerPlayer,
      countOptions([DEAL_ALL, 'All cards (classic)'], settings.maxCardsPerPlayer, settings.cardsPerPlayer),
      settings.cardsPerPlayer,
    );
    fillSelect(
      ui.mafiaCount,
      countOptions(
        [AUTO_MAFIA, `Auto: ${settings.autoMafia} with ${state.members.length} ${state.members.length === 1 ? 'player' : 'players'}`],
        settings.maxMafia,
        settings.mafiaCount,
      ),
      settings.mafiaCount,
    );
    ui.mafiaDoctor.checked = settings.doctor;
    ui.mafiaDetective.checked = settings.detective;
    const minutes = [...new Set([...DAY_MINUTES, settings.dayMinutes])].sort((a, b) => a - b);
    fillSelect(ui.dayMinutes, minutes.map((n) => [n, `${n} min`]), settings.dayMinutes);

    ui.start.hidden = playing;
    ui.start.disabled = !state.canStart;
    const rematch = phase === Phase.FINISHED && state.game.type === settings.game;
    ui.start.textContent = rematch ? 'Play again' : 'Start game';
    ui.end.hidden = !state.game;
    ui.end.textContent = playing ? 'End game' : 'Back to lobby';
  }

  function renderGuestControls(state) {
    const { you, hostVote } = state;
    ui.guestControls.hidden = you.isHost;
    if (you.isHost) return;
    ui.waitingHost.textContent = `${state.host} is the host. At least ${hostVote.needed} votes are needed to kick them.`;
    ui.voteKick.textContent = `${hostVote.youVoted ? 'Withdraw vote' : 'Vote to kick host'} (${hostVote.votes}/${hostVote.needed})`;
    ui.voteKick.setAttribute('aria-pressed', String(hostVote.youVoted));
  }

  // ---- render --------------------------------------------------------------

  function render(state) {
    const shown = shownGame(state);
    const { game } = state;
    ui.gameTitle.textContent = shown.name;
    document.title = shown.name;
    ui.me.textContent = `You are ${state.you.name}${state.you.isHost ? ' · 👑 host' : ''}`;
    ui.status.textContent = statusText(state);
    document.body.dataset.phase = state.phase;
    renderTimer(game);
    renderTable(game?.type === GameType.OLD_MAID ? game : null);
    MafiaView.render(game?.type === GameType.MAFIA ? game : null, {
      onPick: (publicId) => socket.emit(Events.NIGHT_PICK, publicId),
      onVote: (publicId) => socket.emit(Events.DAY_VOTE, publicId),
    });
    ui.rulesOldMaid.hidden = shown.id !== GameType.OLD_MAID;
    ui.rulesMafia.hidden = shown.id !== GameType.MAFIA;
    renderPlayers(state);
    renderHostControls(state);
    renderGuestControls(state);
    renderList(ui.activity, [...state.activity].reverse());
  }

  let toastTimer = null;
  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, TOAST_MS);
  }

  // ---- events --------------------------------------------------------------

  ui.drawPile.addEventListener('click', () => socket.emit(Events.DRAW_FROM_PILE));
  const updateSettings = (changes) => socket.emit(Events.UPDATE_SETTINGS, changes);
  ui.gameType.addEventListener('change', () => updateSettings({ game: ui.gameType.value }));
  ui.cardsPerPlayer.addEventListener('change', () => updateSettings({ cardsPerPlayer: Number(ui.cardsPerPlayer.value) }));
  ui.mafiaCount.addEventListener('change', () => updateSettings({ mafiaCount: Number(ui.mafiaCount.value) }));
  ui.mafiaDoctor.addEventListener('change', () => updateSettings({ doctor: ui.mafiaDoctor.checked }));
  ui.mafiaDetective.addEventListener('change', () => updateSettings({ detective: ui.mafiaDetective.checked }));
  ui.dayMinutes.addEventListener('change', () => updateSettings({ dayMinutes: Number(ui.dayMinutes.value) }));
  ui.hostControls.addEventListener('submit', (event) => {
    event.preventDefault();
    socket.emit(Events.START_GAME);
  });
  ui.end.addEventListener('click', () => {
    const running = document.body.dataset.phase === Phase.PLAYING;
    if (!running || window.confirm('End the game for everyone?')) socket.emit(Events.END_GAME);
  });
  ui.voteKick.addEventListener('click', () => socket.emit(Events.VOTE_KICK_HOST));
  ui.rejoin.addEventListener('click', () => {
    ui.kicked.hidden = true;
    socket.connect();
  });

  socket.on(Events.STATE, (state) => {
    if (!state) return;
    storage.set(state.you.name);
    render(state);
  });
  socket.on(Events.ERROR, ({ message }) => showToast(message));
  socket.on(Events.KICKED, ({ reason }) => {
    ui.kickedMessage.textContent = KICK_MESSAGES[reason] ?? 'You were removed from the room.';
    ui.kicked.hidden = false;
  });
  socket.on('connect', () => { ui.status.textContent = 'Connected.'; });
  socket.on('disconnect', () => {
    ui.status.textContent = 'Disconnected. Reconnecting…';
    clearInterval(timerInterval);
  });

  // Tell the server someone is still using this tab, at most once a minute.
  let lastHeartbeat = 0;
  const heartbeat = () => {
    const now = Date.now();
    if (now - lastHeartbeat < HEARTBEAT_MS || !socket.connected) return;
    lastHeartbeat = now;
    socket.emit(Events.ACTIVE);
  };
  for (const type of ['pointerdown', 'keydown', 'scroll']) {
    window.addEventListener(type, heartbeat, { passive: true });
  }
})();
