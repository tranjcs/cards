/* global io, CardView */
'use strict';

(() => {
  // Keep in sync with src/constants.js.
  const Phase = { LOBBY: 'lobby', PLAYING: 'playing', FINISHED: 'finished' };
  const GameType = { OLD_MAID: 'old-maid', GO_FISH: 'go-fish' };
  const DEAL_HINTS = {
    [GameType.OLD_MAID]: "Old Maid uses the 52-card deck minus the Q♣. Cards that aren't dealt form the draw pile.",
    [GameType.GO_FISH]: "Go Fish uses the full 52-card deck. Cards that aren't dealt form the pond to fish from.",
  };
  const RANK_PLURALS = { A: 'Aces', J: 'Jacks', Q: 'Queens', K: 'Kings', 6: 'Sixes' };
  const rankPlural = (rank) => RANK_PLURALS[rank] ?? `${rank}s`;
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
    ASK: 'ask',
    GO_FISH: 'go-fish',
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
    discardWrap: $('discard-wrap'),
    discardPile: $('discard-pile'),
    discardCount: $('discard-count'),
    pick: $('pick'),
    pickLabel: $('pick-label'),
    pickCards: $('pick-cards'),
    ask: $('ask'),
    askTargets: $('ask-targets'),
    askRanks: $('ask-ranks'),
    lastDraw: $('last-draw'),
    hand: $('hand'),
    handCount: $('hand-count'),
    result: $('result'),
    log: $('log'),
    players: $('players'),
    playerCount: $('player-count'),
    hostControls: $('host-controls'),
    gameType: $('game-type'),
    cardsPerPlayer: $('cards-per-player'),
    dealHint: $('deal-hint'),
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

  // ---- timer -------------------------------------------------------------

  let timerInterval = null;

  function renderTimer(game) {
    clearInterval(timerInterval);
    const running = game && !game.result && game.turnRemainingMs !== null;
    ui.timer.hidden = !running;
    ui.timerFill.parentElement.hidden = !running;
    if (!running) return;
    const deadline = Date.now() + game.turnRemainingMs;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      const who = game.isYourTurn ? 'Your turn' : `${game.turn}'s turn`;
      ui.timer.textContent = `${who} · ${Math.ceil(remaining / 1000)}s`;
      ui.timerFill.style.width = `${(remaining / game.turnTimeoutMs) * 100}%`;
      ui.timerFill.classList.toggle('turn-timer__fill--low', remaining < 5000);
      if (remaining === 0) clearInterval(timerInterval);
    };
    tick();
    timerInterval = setInterval(tick, 250);
  }

  // ---- status ------------------------------------------------------------

  function statusText(state) {
    const { game, phase } = state;
    if (phase === Phase.LOBBY) {
      if (state.members.length < state.limits.minPlayers) return 'Waiting for more players to join…';
      return state.you.isHost ? 'Pick the settings and start the game.' : `Waiting for ${state.host} to start the game…`;
    }
    if (phase === Phase.FINISHED) return resultText(game);
    if (!game.isPlaying) return `Watching: ${game.turn}'s turn. You'll be dealt in next game.`;
    if (game.type === GameType.GO_FISH) {
      if (!game.isYourTurn) return `${game.turn}'s turn…`;
      return game.canGoFish ? 'Your turn! Nobody else has cards: go fish from the pile.' : 'Your turn! Ask a player for a rank you hold.';
    }
    if (game.isYourTurn) {
      if (game.target && game.canDrawFromPile) return `Your turn! Take a card from ${game.target.name} or draw from the pile.`;
      if (game.target) return `Your turn! Take a card from ${game.target.name}.`;
      return 'Your turn! Draw from the pile.';
    }
    if (game.safe.includes(state.you.name)) return "You're safe! 🎉 Watch the others finish.";
    return `${game.turn}'s turn…`;
  }

  function resultText(game) {
    const { result } = game;
    if (game.type === GameType.GO_FISH) {
      if (!result.winners.length) return 'Game over: not enough players.';
      if (result.winners.length > 1) {
        return `${result.youWon ? 'You tied for the win' : 'A tie'}: ${result.winners.join(', ')}! 🐟`;
      }
      return result.youWon ? 'You win with the most books! 🐟' : `${result.winners[0]} wins with the most books! 🐟`;
    }
    if (!result.loser) return 'Game over: not enough players.';
    return result.youLost ? "You're stuck with the Old Maid! 👵" : `${result.loser} is stuck with the Old Maid!`;
  }

  // ---- table -------------------------------------------------------------

  function renderSeats(game) {
    ui.seats.replaceChildren(...game.seats.map((seat) => {
      const li = make('li', 'seat');
      li.classList.toggle('seat--turn', seat.isTurn);
      li.classList.toggle('seat--you', seat.isYou);
      li.classList.toggle('seat--target', seat.isTarget);
      li.classList.toggle('seat--safe', Boolean(seat.isSafe || seat.isOut));
      li.classList.toggle('seat--loser', seat.isLoser);
      li.classList.toggle('seat--winner', Boolean(seat.isWinner));

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
      if (seat.isOut) badges.push('out');
      if (seat.isWinner) badges.push('🏆 winner');
      li.append(name, count, fan);
      if (seat.books) {
        const books = seat.books.length ? seat.books.join(' ') : 'none yet';
        li.appendChild(make('span', 'seat__books', `Books (${seat.books.length}): ${books}`));
      }
      if (badges.length) li.appendChild(make('span', 'seat__badge', badges.join(' · ')));
      return li;
    }));
  }

  function renderPiles(game) {
    const canDraw = Boolean(game.canDrawFromPile || game.canGoFish);
    ui.drawPile.replaceChildren();
    if (game.drawPile.count > 0) ui.drawPile.appendChild(CardView.back());
    ui.drawPile.disabled = !canDraw;
    ui.drawPile.classList.toggle('pile__stack--active', canDraw);
    ui.drawPile.setAttribute('aria-label', `Draw pile, ${game.drawPile.count} cards${canDraw ? ': click to draw' : ''}`);
    ui.drawCount.textContent = `Draw pile · ${game.drawPile.count}`;

    ui.discardWrap.hidden = !game.discardPile;
    if (!game.discardPile) return;

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

  // Go Fish: who to ask is remembered by name across renders.
  let askTarget = null;

  function renderAsk(game) {
    const targets = game.type === GameType.GO_FISH ? game.seats.filter((seat) => seat.isTarget) : [];
    const show = Boolean(game.isYourTurn && targets.length && game.askableRanks.length);
    ui.ask.hidden = !show;
    if (!show) return;
    if (!targets.some((seat) => seat.name === askTarget)) askTarget = targets[0].name;

    ui.askTargets.replaceChildren(...targets.map((seat) => {
      const button = make('button', 'button button--small ask__option', `${seat.name} (${seat.cardCount})`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(seat.name === askTarget));
      button.addEventListener('click', () => {
        askTarget = seat.name;
        renderAsk(game);
      });
      return button;
    }));
    const target = targets.find((seat) => seat.name === askTarget);
    ui.askRanks.replaceChildren(...game.askableRanks.map((rank) => {
      const button = make('button', 'button button--small ask__option', rankPlural(rank));
      button.type = 'button';
      button.setAttribute('aria-label', `Ask ${target.name} for ${rankPlural(rank)}`);
      button.addEventListener('click', () => socket.emit(Events.ASK, { seat: target.seat, rank }));
      return button;
    }));
  }

  function lastDrawText(game) {
    if (game.type === GameType.GO_FISH) return game.lastFish ? `You drew ${CardView.label(game.lastFish)}.` : '';
    const { lastDraw } = game;
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
      const waiting = game.type === GameType.GO_FISH ? "No cards — you'll draw one on your turn." : 'No cards — you can still draw from the pile.';
      ui.hand.appendChild(make('p', 'hint', game.result || !game.drawPile.count ? 'No cards left.' : waiting));
    }
  }

  function renderResult(game) {
    ui.result.hidden = !game.result;
    if (!game.result) return;
    ui.result.classList.toggle('result--lost', Boolean(game.result.youLost));
    ui.result.textContent = resultText(game);
  }

  function renderTable(state) {
    const { game } = state;
    ui.table.hidden = !game;
    renderTimer(game);
    if (!game) return;
    renderSeats(game);
    renderPiles(game);
    renderPick(game);
    renderAsk(game);
    ui.lastDraw.textContent = lastDrawText(game);
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

  function renderHostControls(state) {
    const { you, phase, settings } = state;
    ui.hostControls.hidden = !you.isHost;
    if (!you.isHost) return;
    const playing = phase === Phase.PLAYING;

    ui.gameType.replaceChildren(...state.games.map(({ type, name }) => {
      const option = make('option', '', name);
      option.value = type;
      return option;
    }));
    ui.gameType.value = settings.game;
    ui.gameType.disabled = playing;
    ui.dealHint.textContent = DEAL_HINTS[settings.game] ?? '';

    const options = [[DEAL_ALL, settings.standardDeal]];
    for (let n = 1; n <= settings.maxCardsPerPlayer; n += 1) options.push([n, String(n)]);
    // Keep a saved value visible even if more players joined and it's now above the cap.
    if (settings.cardsPerPlayer > settings.maxCardsPerPlayer) {
      options.push([settings.cardsPerPlayer, `${settings.cardsPerPlayer} (capped to ${settings.maxCardsPerPlayer})`]);
    }
    ui.cardsPerPlayer.replaceChildren(...options.map(([value, text]) => {
      const option = make('option', '', text);
      option.value = String(value);
      return option;
    }));
    ui.cardsPerPlayer.value = String(settings.cardsPerPlayer);
    ui.cardsPerPlayer.disabled = playing;

    ui.start.hidden = playing;
    ui.start.disabled = !state.canStart;
    ui.start.textContent = phase === Phase.FINISHED ? 'Play again' : 'Start game';
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
    const gameName = state.games.find((g) => g.type === state.settings.game)?.name ?? 'Cards';
    ui.gameTitle.textContent = gameName;
    document.title = gameName;
    for (const list of document.querySelectorAll('.rules [data-game]')) {
      list.hidden = list.dataset.game !== state.settings.game;
    }
    ui.me.textContent = `You are ${state.you.name}${state.you.isHost ? ' · 👑 host' : ''}`;
    ui.status.textContent = statusText(state);
    document.body.dataset.phase = state.phase;
    document.body.dataset.game = state.game?.type ?? state.settings.game;
    renderTable(state);
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

  ui.drawPile.addEventListener('click', () => {
    const goFish = document.body.dataset.game === GameType.GO_FISH;
    socket.emit(goFish ? Events.GO_FISH : Events.DRAW_FROM_PILE);
  });
  ui.gameType.addEventListener('change', () => {
    socket.emit(Events.UPDATE_SETTINGS, { game: ui.gameType.value });
  });
  ui.cardsPerPlayer.addEventListener('change', () => {
    socket.emit(Events.UPDATE_SETTINGS, { cardsPerPlayer: Number(ui.cardsPerPlayer.value) });
  });
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
