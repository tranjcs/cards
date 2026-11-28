/* global io, CardView, HandArranger */
'use strict';

(() => {
  // Keep in sync with src/constants.js.
  const Phase = { LOBBY: 'lobby', PLAYING: 'playing', FINISHED: 'finished' };
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
    PLAY_CARDS: 'play-cards',
    PASS: 'pass',
    ACTIVE: 'active',
  };
  const GameType = { OLD_MAID: 'old-maid', PUSOY_DOS: 'pusoy-dos' };
  const SETTINGS_HINTS = {
    [GameType.OLD_MAID]: "Old Maid uses the 52-card deck minus the Q♣. Cards that aren't dealt form the draw pile.",
    [GameType.PUSOY_DOS]: 'Pusoy Dos is for 2 to 4 players: 13 cards each (17 with three). 3 is low, 2 is high.',
  };
  const MAX_PLAY_SIZE = 5;
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
    me: $('me'),
    titleText: $('title-text'),
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
    piles: $('piles'),
    trick: $('trick'),
    trickLabel: $('trick-label'),
    trickCards: $('trick-cards'),
    playControls: $('play-controls'),
    play: $('play'),
    pass: $('pass'),
    clearSelection: $('clear-selection'),
    selection: $('selection'),
    hand: $('hand'),
    handCount: $('hand-count'),
    arrangeOptions: document.querySelectorAll('[data-arrange]'),
    arrangeHint: $('arrange-hint'),
    result: $('result'),
    log: $('log'),
    players: $('players'),
    playerCount: $('player-count'),
    hostControls: $('host-controls'),
    gameType: $('game-type'),
    cardsPerPlayerField: $('cards-per-player-field'),
    settingsHint: $('settings-hint'),
    rules: document.querySelectorAll('.rules[data-game]'),
    cardsPerPlayer: $('cards-per-player'),
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
    if (game.type === GameType.PUSOY_DOS) return pusoyStatusText(state);
    if (phase === Phase.FINISHED) {
      if (!game.result.loser) return 'Game over: not enough players.';
      return game.result.youLost ? "You're stuck with the Old Maid!" : `${game.result.loser} is stuck with the Old Maid!`;
    }
    if (!game.isPlaying) return `Watching: ${game.turn}'s turn. You'll be dealt in next game.`;
    if (game.isYourTurn) {
      if (game.target && game.canDrawFromPile) return `Your turn! Take a card from ${game.target.name} or draw from the pile.`;
      if (game.target) return `Your turn! Take a card from ${game.target.name}.`;
      return 'Your turn! Draw from the pile.';
    }
    if (game.safe.includes(state.you.name)) return "You're safe! Watch the others finish.";
    return `${game.turn}'s turn…`;
  }

  function pusoyStatusText(state) {
    const { game } = state;
    if (game.result) {
      if (!game.result.winner) return 'Game over: not enough players.';
      return game.result.youWon ? 'You played all your cards. You win!' : `${game.result.winner} wins!`;
    }
    if (!game.isPlaying) return `Watching: ${game.turn}'s turn. You'll be dealt in next game.`;
    if (!game.isYourTurn) return `${game.turn}'s turn…`;
    if (game.mustInclude) return `Your lead! Your first play must include the ${CardView.label(game.mustInclude)}.`;
    if (!game.table) return 'Your lead! Play anything: a single, pair, three of a kind or five-card hand.';
    const n = game.table.cards.length;
    return `Your turn! Beat the ${game.table.name} with ${n} ${n === 1 ? 'card' : 'cards'}, or pass.`;
  }

  // ---- table -------------------------------------------------------------

  function renderSeats(game) {
    ui.seats.replaceChildren(...game.seats.map((seat) => {
      const li = make('li', 'seat');
      // Boolean(): toggle(name, undefined) flips the class instead of removing it, and
      // each game only sends the flags it uses.
      li.classList.toggle('seat--turn', Boolean(seat.isTurn));
      li.classList.toggle('seat--you', Boolean(seat.isYou));
      li.classList.toggle('seat--target', Boolean(seat.isTarget));
      li.classList.toggle('seat--safe', Boolean(seat.isSafe));
      li.classList.toggle('seat--loser', Boolean(seat.isLoser));
      li.classList.toggle('seat--winner', Boolean(seat.isWinner));
      li.classList.toggle('seat--passed', Boolean(seat.hasPassed));

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
      if (seat.isTurn) badges.push('turn');
      if (seat.isSafe) badges.push('safe');
      if (seat.isLoser) badges.push('old maid');
      if (seat.isWinner) badges.push('winner');
      if (seat.isLeader) badges.push('on the table');
      if (seat.hasPassed) badges.push('passed');
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

  // ---- arranging your hand -----------------------------------------------

  const arranger = HandArranger.create({
    container: ui.hand,
    onChange: () => renderHandOnly(lastState?.game),
  });

  /** Re-renders just the hand (after a local change such as rearranging). */
  function renderHandOnly(game) {
    if (!game) return;
    if (game.type === GameType.PUSOY_DOS) renderPusoyHand(game);
    else renderHand(game);
  }

  function renderArrangeControls(cardCount) {
    ui.arrangeOptions.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.arrange === arranger.mode));
    });
    ui.arrangeHint.hidden = arranger.mode !== HandArranger.Mode.FREE || cardCount < 2;
  }

  function renderHand(game) {
    if (arranger.isDragging) return; // re-rendered when the drag ends
    const cards = arranger.arrange(game.hand ?? []);
    ui.hand.closest('.hand-wrap').hidden = !game.isPlaying;
    ui.handCount.textContent = `(${cards.length})`;
    renderArrangeControls(cards.length);
    ui.hand.replaceChildren(...cards.map((card) => CardView.face(card)));
    if (game.isPlaying && cards.length === 0) {
      ui.hand.appendChild(make('p', 'hint', game.result ? 'No cards left.' : 'No cards — you can still draw from the pile.'));
    }
  }

  // ---- Pusoy Dos --------------------------------------------------------

  /** Card ids the player has picked to play. Kept across state updates. */
  let selected = new Set();

  function renderTrick(game) {
    const { table } = game;
    ui.trick.hidden = false;
    if (!table) {
      ui.trickLabel.textContent = game.result ? 'Table' : 'The table is clear: the leader plays anything.';
      ui.trickCards.replaceChildren();
      return;
    }
    const by = table.byYou ? 'You' : table.by;
    ui.trickLabel.textContent = `${by} played ${table.name === 'single' ? 'a single' : `a ${table.name}`}:`;
    ui.trickCards.replaceChildren(...table.cards.map((card) => CardView.face(card)));
  }

  function selectionText(game) {
    if (selected.size === 0) {
      return game.table ? `Pick ${game.table.cards.length} to play, or pass.` : 'Pick cards to play.';
    }
    return `${selected.size} selected`;
  }

  function renderPusoyHand(game) {
    if (arranger.isDragging) return; // re-rendered when the drag ends
    const cards = arranger.arrange(game.hand ?? []);
    const canAct = game.isYourTurn && !game.result;
    // Forget picks that are no longer in the hand (played, or a new game).
    selected = new Set(cards.map((card) => card.id).filter((id) => selected.has(id)));
    ui.hand.closest('.hand-wrap').hidden = !game.isPlaying;
    ui.handCount.textContent = `(${cards.length})`;
    renderArrangeControls(cards.length);
    ui.hand.replaceChildren(...cards.map((card) => CardView.selectable(card, {
      selected: selected.has(card.id),
      disabled: Boolean(game.result),
      onClick: () => {
        if (selected.has(card.id)) selected.delete(card.id);
        else if (selected.size < MAX_PLAY_SIZE) selected.add(card.id);
        else showToast(`You can play at most ${MAX_PLAY_SIZE} cards.`);
        renderPusoyHand(game);
      },
    })));
    if (game.isPlaying && cards.length === 0) ui.hand.appendChild(make('p', 'hint', 'No cards left.'));

    ui.playControls.hidden = !game.isPlaying || Boolean(game.result);
    ui.play.disabled = !canAct || selected.size === 0;
    ui.pass.disabled = !game.canPass;
    ui.clearSelection.disabled = selected.size === 0;
    ui.selection.textContent = canAct ? selectionText(game) : '';
  }

  function renderResult(game) {
    ui.result.hidden = !game.result;
    if (!game.result) return;
    if (game.type === GameType.PUSOY_DOS) {
      ui.result.classList.toggle('result--lost', Boolean(game.isPlaying && !game.result.youWon && game.result.winner));
      ui.result.textContent = game.result.winner
        ? (game.result.youWon ? 'You win!' : `${game.result.winner} wins!`)
        : 'Game over: everyone else left.';
      return;
    }
    ui.result.classList.toggle('result--lost', game.result.youLost);
    ui.result.textContent = game.result.loser
      ? (game.result.youLost ? 'You lost — you hold the Old Maid.' : `${game.result.loser} holds the Old Maid.`)
      : 'Game over: everyone else left.';
  }

  function renderTable(state) {
    const { game } = state;
    ui.table.hidden = !game;
    renderTimer(game);
    if (!game) return;
    const pusoy = game.type === GameType.PUSOY_DOS;
    renderSeats(game);
    ui.piles.hidden = pusoy;
    ui.lastDraw.hidden = pusoy;
    ui.trick.hidden = !pusoy;
    if (pusoy) {
      ui.pick.hidden = true;
      renderTrick(game);
      renderPusoyHand(game);
    } else {
      ui.playControls.hidden = true;
      renderPiles(game);
      renderPick(game);
      ui.lastDraw.textContent = lastDrawText(game.lastDraw);
      renderHand(game);
    }
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
      if (member.isHost) name.appendChild(make('span', 'tag tag--host', 'host'));
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

    ui.gameType.replaceChildren(...state.games.map((game) => {
      const option = make('option', '', `${game.title} (${game.minPlayers}–${game.maxPlayers} players)`);
      option.value = game.type;
      return option;
    }));
    ui.gameType.value = settings.game;
    ui.gameType.disabled = playing;
    ui.cardsPerPlayerField.hidden = settings.game !== GameType.OLD_MAID;
    ui.settingsHint.textContent = SETTINGS_HINTS[settings.game] ?? '';

    const options = [[DEAL_ALL, 'All cards (classic)']];
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

  function titleOf(state) {
    const type = state.game?.type ?? state.settings.game;
    return state.games.find((game) => game.type === type)?.title ?? 'Cards';
  }

  function render(state) {
    const title = titleOf(state);
    const type = state.game?.type ?? state.settings.game;
    ui.titleText.textContent = title;
    document.title = title;
    ui.rules.forEach((rules) => { rules.hidden = rules.dataset.game !== type; });
    ui.me.textContent = `You are ${state.you.name}${state.you.isHost ? ' · host' : ''}`;
    ui.status.textContent = statusText(state);
    document.body.dataset.phase = state.phase;
    renderTable(state);
    renderPlayers(state);
    renderHostControls(state);
    renderGuestControls(state);
    renderList(ui.activity, [...state.activity].reverse());
  }

  /** The latest state from the server, for re-rendering local changes (card picks). */
  let lastState = null;

  let toastTimer = null;
  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, TOAST_MS);
  }

  // ---- events --------------------------------------------------------------

  ui.drawPile.addEventListener('click', () => socket.emit(Events.DRAW_FROM_PILE));
  ui.arrangeOptions.forEach((button) => {
    button.addEventListener('click', () => arranger.setMode(button.dataset.arrange));
  });
  ui.play.addEventListener('click', () => {
    if (selected.size > 0) socket.emit(Events.PLAY_CARDS, [...selected]);
  });
  ui.pass.addEventListener('click', () => socket.emit(Events.PASS));
  ui.clearSelection.addEventListener('click', () => {
    selected.clear();
    renderHandOnly(lastState?.game);
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
    // A new deal: forget the free arrangement of the last game's cards.
    if (state.phase === Phase.PLAYING && lastState?.phase !== Phase.PLAYING) {
      arranger.reset();
      selected.clear(); // card ids repeat between deals
    }
    lastState = state;
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
