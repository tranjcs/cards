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
    ASK: 'ask',
    GO_FISH: 'go-fish',
    ACTIVE: 'active',
  };
  const GameType = { OLD_MAID: 'old-maid', PUSOY_DOS: 'pusoy-dos', GO_FISH: 'go-fish' };
  const SETTINGS_HINTS = {
    [GameType.OLD_MAID]: "Old Maid uses the 52-card deck minus the Q♣. Cards that aren't dealt form the draw pile.",
    [GameType.PUSOY_DOS]: 'Pusoy Dos is for 2 to 4 players: 13 cards each (17 with three). 3 is low, 2 is high.',
    [GameType.GO_FISH]: 'Go Fish uses the full deck: 7 cards each, or 5 with four or more players. The rest form the pile.',
  };
  const RANK_PLURALS = { A: 'Aces', J: 'Jacks', Q: 'Queens', K: 'Kings', 6: 'Sixes' };
  const rankPlural = (rank) => RANK_PLURALS[rank] ?? `${rank}s`;
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
    hud: $('hud'),
    center: $('center'),
    setup: $('setup'),
    turnArrow: $('turn-arrow'),
    endGame: $('end-game'),
    menuToggle: $('menu-toggle'),
    menuClose: $('menu-close'),
    drawer: $('drawer'),
    drawerScrim: $('drawer-scrim'),
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
    feltLogo: $('felt-logo'),
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
    voteHint: $('vote-hint'),
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

  const AVATARS = ['🐻', '🦊', '🐸', '🐼', '🐷', '🐨', '🐯', '🐰', '🐵', '🐱', '🐶', '🦁'];

  /** A round avatar with an animal and a colour picked from the player's name. */
  function avatar(name, className = 'avatar') {
    const number = Number(name.replace(/\D/g, ''));
    const seed = number || [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const el = make('span', className, AVATARS[seed % AVATARS.length]);
    el.style.setProperty('--hue', String((seed * 47) % 360));
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  /** Lays cards out as a fan by giving each its index and the count. */
  function fan(cards) {
    cards.forEach((card, index) => {
      card.style.setProperty('--i', String(index));
      card.style.setProperty('--n', String(cards.length));
    });
    return cards;
  }

  // ---- timer -------------------------------------------------------------

  let timerInterval = null;

  function renderTimer(game) {
    clearInterval(timerInterval);
    const running = game && !game.result && game.turnRemainingMs !== null;
    ui.hud.hidden = !running;
    if (!running) return;
    const deadline = Date.now() + game.turnRemainingMs;
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      const who = game.isYourTurn ? 'Your turn' : `${game.turn}'s turn`;
      ui.timer.textContent = `${who} · ${Math.ceil(remaining / 1000)}s`;
      ui.timerFill.style.width = `${(remaining / game.turnTimeoutMs) * 100}%`;
      ui.timerFill.classList.toggle('turn-timer__fill--low', remaining < 5000);
      const ring = ui.seats.querySelector('.seat--turn .seat__ring');
      if (ring) {
        ring.style.setProperty('--p', String(remaining / game.turnTimeoutMs));
        ring.classList.toggle('seat__ring--low', remaining < 5000);
      }
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
    if (game.type === GameType.GO_FISH) return goFishStatusText(game);
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

  function goFishStatusText(game) {
    if (game.result) return goFishResultText(game.result);
    if (!game.isPlaying) return `Watching: ${game.turn}'s turn. You'll be dealt in next game.`;
    if (!game.isYourTurn) return `${game.turn}'s turn…`;
    return game.canGoFish ? 'Your turn! Nobody else has cards: go fish from the pile.' : 'Your turn! Ask a player for a rank you hold.';
  }

  function goFishResultText(result) {
    const { winners, youWon } = result;
    if (!winners.length) return 'Game over: not enough players.';
    if (winners.length > 1) return `${youWon ? 'You tied for the win' : 'A tie'}: ${winners.join(', ')}!`;
    return youWon ? 'You win with the most books!' : `${winners[0]} wins with the most books!`;
  }

  // ---- table -------------------------------------------------------------

  function seatBadge(seat) {
    if (seat.isHost) return 'host';
    if (seat.isLoser) return 'old maid';
    if (seat.isWinner) return 'winner';
    if (seat.isSafe) return 'safe';
    if (seat.isOut) return 'out';
    if (seat.isTurn) return 'turn';
    if (seat.hasPassed) return 'passed';
    if (seat.isLeader) return 'on the table';
    return '';
  }

  /** Where seat `index` of `seats` sits: degrees clockwise from the right, with you at the bottom (90°). */
  function seatAngle(seats, index) {
    const count = seats.length;
    const first = Math.max(0, seats.findIndex((seat) => seat.isYou));
    const position = (index - first + count) % count;
    return 90 + (position * 360) / count;
  }

  /**
   * Seats everyone around the oval, starting with you at the bottom (or the
   * first player when watching) and going clockwise. In the lobby the seats are
   * the room's members, with no cards.
   */
  function renderSeats(seats) {
    ui.seats.replaceChildren(...seats.map((seat, index) => {
      const angle = seatAngle(seats, index);
      const radians = (angle * Math.PI) / 180;
      const li = make('li', 'seat');
      li.style.setProperty('--cx', Math.cos(radians).toFixed(4));
      li.style.setProperty('--cy', Math.sin(radians).toFixed(4));
      li.style.setProperty('--face', `${angle - 90}deg`);
      // Boolean(): toggle(name, undefined) flips the class instead of removing it, and
      // each game only sends the flags it uses.
      li.classList.toggle('seat--turn', Boolean(seat.isTurn));
      li.classList.toggle('seat--you', Boolean(seat.isYou));
      li.classList.toggle('seat--target', Boolean(seat.isTarget));
      li.classList.toggle('seat--safe', Boolean(seat.isSafe || seat.isOut));
      li.classList.toggle('seat--loser', Boolean(seat.isLoser));
      li.classList.toggle('seat--winner', Boolean(seat.isWinner));
      li.classList.toggle('seat--passed', Boolean(seat.hasPassed));

      const cards = seat.hand
        ? seat.hand.map((card) => CardView.face(card, 'card--mini'))
        : Array.from({ length: Math.min(seat.cardCount ?? 0, 7) }, () => CardView.back({ extraClass: 'card--mini' }));
      const cardFan = make('div', 'seat__fan');
      cardFan.append(...fan(cards));

      const ring = make('div', 'seat__ring');
      ring.appendChild(avatar(seat.name, 'avatar seat__avatar'));
      const badge = seatBadge(seat);
      if (badge) ring.appendChild(make('span', 'seat__badge', badge));

      const chip = make('div', 'seat__chip');
      chip.appendChild(make('span', 'seat__name', seat.isYou ? 'You' : seat.name));
      if (seat.cardCount !== undefined) {
        chip.appendChild(make('span', 'seat__count', `${seat.cardCount} ${seat.cardCount === 1 ? 'card' : 'cards'}`));
      }
      if (seat.books) {
        const books = seat.books.length ? `: ${seat.books.join(' ')}` : '';
        chip.appendChild(make('span', 'seat__books', `${seat.books.length} ${seat.books.length === 1 ? 'book' : 'books'}${books}`));
      }
      li.append(cardFan, ring, chip);
      return li;
    }));
  }

  /** The arrow's current angle; it only ever turns the short way round. */
  let arrowAngle = null;

  /** Points the bouncing arrow in the middle of the table at whoever's turn it is. */
  function renderTurnArrow(seats, show) {
    const turn = show ? seats.findIndex((seat) => seat.isTurn) : -1;
    ui.turnArrow.hidden = turn < 0;
    if (turn < 0) return;
    const target = seatAngle(seats, turn);
    if (arrowAngle === null) arrowAngle = target;
    else arrowAngle += ((((target - arrowAngle) % 360) + 540) % 360) - 180;
    ui.turnArrow.style.setProperty('--a', `${arrowAngle}deg`);
    ui.turnArrow.classList.toggle('turn-arrow--you', Boolean(seats[turn].isYou));
  }

  function renderPiles(game) {
    const canDraw = Boolean(game.canDrawFromPile || game.canGoFish);
    ui.drawPile.replaceChildren();
    if (game.drawPile.count > 0) ui.drawPile.appendChild(CardView.back());
    ui.drawPile.classList.toggle('pile__stack--deep', game.drawPile.count > 1);
    ui.drawPile.disabled = !canDraw;
    ui.drawPile.classList.toggle('pile__stack--active', canDraw);
    ui.drawPile.setAttribute('aria-label', `Draw pile, ${game.drawPile.count} cards${canDraw ? ': click to draw' : ''}`);
    ui.drawCount.textContent = `Draw pile · ${game.drawPile.count}`;

    // Go Fish lays books down by each seat instead of on a discard pile.
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
    ui.pickCards.replaceChildren(...fan(Array.from({ length: cardCount }, (_, index) => CardView.back({
      label: `Take card ${index + 1} of ${cardCount} from ${name}`,
      onClick: () => socket.emit(Events.DRAW_FROM_PLAYER, index),
    }))));
  }

  // ---- Go Fish -----------------------------------------------------------

  /** Who to ask, remembered by name across state updates. */
  let askTarget = null;

  function renderAsk(game) {
    const targets = game.type === GameType.GO_FISH ? game.seats.filter((seat) => seat.isTarget) : [];
    const show = Boolean(game.isYourTurn && targets.length && game.askableRanks.length);
    ui.ask.hidden = !show;
    if (!show) return;
    if (!targets.some((seat) => seat.name === askTarget)) askTarget = targets[0].name;
    const target = targets.find((seat) => seat.name === askTarget);

    ui.askTargets.replaceChildren(...targets.map((seat) => {
      const button = make('button', 'button button--small ask__option', `${seat.name} (${seat.cardCount})`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(seat === target));
      button.addEventListener('click', () => {
        askTarget = seat.name;
        renderAsk(game);
      });
      return button;
    }));
    ui.askRanks.replaceChildren(...game.askableRanks.map((rank) => {
      const button = make('button', 'button button--small', rankPlural(rank));
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
    ui.hand.replaceChildren(...fan(cards.map((card) => CardView.face(card))));
    if (game.isPlaying && cards.length === 0) {
      const waiting = game.type === GameType.GO_FISH
        ? "No cards — you'll draw one on your turn."
        : 'No cards — you can still draw from the pile.';
      ui.hand.appendChild(make('p', 'hint', game.result || game.drawPile.count === 0 ? 'No cards left.' : waiting));
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
    ui.hand.replaceChildren(...fan(cards.map((card) => CardView.selectable(card, {
      selected: selected.has(card.id),
      disabled: Boolean(game.result),
      onClick: () => {
        if (selected.has(card.id)) selected.delete(card.id);
        else if (selected.size < MAX_PLAY_SIZE) selected.add(card.id);
        else showToast(`You can play at most ${MAX_PLAY_SIZE} cards.`);
        renderPusoyHand(game);
      },
    }))));
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
    if (game.type === GameType.GO_FISH) {
      ui.result.classList.toggle('result--lost', Boolean(game.isPlaying && !game.result.youWon && game.result.winners.length));
      ui.result.textContent = goFishResultText(game.result);
      return;
    }
    ui.result.classList.toggle('result--lost', game.result.youLost);
    ui.result.textContent = game.result.loser
      ? (game.result.youLost ? 'You lost — you hold the Old Maid.' : `${game.result.loser} holds the Old Maid.`)
      : 'Game over: everyone else left.';
  }

  function renderTable(state) {
    const { game } = state;
    // The middle of the felt holds the game while it's on, and the settings before and after.
    ui.center.hidden = state.phase !== Phase.PLAYING;
    ui.setup.hidden = state.phase === Phase.PLAYING;
    ui.feltLogo.textContent = titleOf(state);
    if (!game) {
      const seats = state.members.map((member) => ({ name: member.name, isYou: member.isYou, isHost: member.isHost }));
      renderSeats(seats);
      renderTurnArrow(seats, false);
      renderTimer(null);
      ui.hand.closest('.hand-wrap').hidden = true;
      ui.ask.hidden = true;
      ui.result.hidden = true;
      renderList(ui.log, []);
      return;
    }
    const pusoy = game.type === GameType.PUSOY_DOS;
    renderSeats(game.seats);
    renderTurnArrow(game.seats, !game.result);
    renderTimer(game);
    ui.piles.hidden = pusoy;
    ui.lastDraw.hidden = pusoy;
    ui.trick.hidden = !pusoy;
    if (pusoy) {
      ui.pick.hidden = true;
      ui.ask.hidden = true;
      renderTrick(game);
      renderPusoyHand(game);
    } else {
      ui.playControls.hidden = true;
      renderPiles(game);
      renderPick(game);
      renderAsk(game);
      ui.lastDraw.textContent = lastDrawText(game);
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
      li.appendChild(avatar(member.name));
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
    const playing = phase === Phase.PLAYING;
    ui.hostControls.hidden = !you.isHost;
    ui.endGame.hidden = !you.isHost || !playing;
    if (!you.isHost) return;

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
    ui.end.hidden = !state.game || playing;
  }

  function renderGuestControls(state) {
    const { you, hostVote } = state;
    ui.guestControls.hidden = you.isHost;
    ui.waitingHost.hidden = you.isHost;
    if (you.isHost) return;
    ui.waitingHost.textContent = state.members.length < state.limits.minPlayers
      ? 'Waiting for more players to join…'
      : `Waiting for ${state.host} to start the game…`;
    ui.voteHint.textContent = `${state.host} is the host. At least ${hostVote.needed} votes are needed to kick them.`;
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

  ui.drawPile.addEventListener('click', () => {
    const goFish = lastState?.game?.type === GameType.GO_FISH;
    socket.emit(goFish ? Events.GO_FISH : Events.DRAW_FROM_PILE);
  });
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
  ui.end.addEventListener('click', () => socket.emit(Events.END_GAME));
  ui.endGame.addEventListener('click', () => {
    if (window.confirm('End the game for everyone?')) socket.emit(Events.END_GAME);
  });

  // The drawer holds the room (players, kicks, votes), the rules and the logs.
  function setDrawer(open) {
    ui.drawer.hidden = !open;
    ui.drawerScrim.hidden = !open;
    ui.menuToggle.setAttribute('aria-expanded', String(open));
    if (open) ui.menuClose.focus();
    else if (ui.drawer.contains(document.activeElement)) ui.menuToggle.focus();
  }
  ui.menuToggle.addEventListener('click', () => setDrawer(ui.drawer.hidden));
  ui.menuClose.addEventListener('click', () => setDrawer(false));
  ui.drawerScrim.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.drawer.hidden) setDrawer(false);
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
