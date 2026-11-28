/* global CardView */
'use strict';

/**
 * Renders the Mafia table from the server's view of the game. Exposed as `window.MafiaView`.
 * Everything shown comes from the server, which only sends what this player may know.
 */
window.MafiaView = (() => {
  const ROLES = {
    mafia: {
      name: 'Mafia',
      you: "You're Mafia",
      help: 'Each night, agree with your team on someone to kill. By day, blend in. You win once the Mafia match the town in number.',
    },
    doctor: {
      name: 'Doctor',
      you: "You're the Doctor",
      help: 'Each night, protect someone from the Mafia. Yourself is fine, but never the same person two nights in a row.',
    },
    detective: {
      name: 'Detective',
      you: "You're the Detective",
      help: "Each night, investigate someone to learn whether they're Mafia. Careful how you share it: the Mafia will come for you.",
    },
    villager: {
      name: 'Villager',
      you: "You're a Villager",
      help: 'No night power: find the Mafia by talking, and vote them out by day.',
    },
  };
  const ACTIONS = {
    kill: { button: 'Kill', prompt: 'Pick someone to kill.' },
    protect: { button: 'Protect', prompt: 'Pick someone to protect tonight.' },
    investigate: { button: 'Investigate', prompt: "Pick someone to investigate. You'll learn at dawn whether they're Mafia." },
    suspect: {
      button: 'Suspect',
      prompt: 'Pick who you suspect. It does nothing, but everyone picks, so nobody can tell who has a role.',
    },
  };
  const WINNERS = {
    town: 'The town wins! Every Mafia member is out.',
    mafia: 'The Mafia win! They match the town in number.',
  };

  const $ = (id) => document.getElementById(id);
  const ui = {
    root: $('mafia'),
    stage: $('mafia-stage'),
    setup: $('mafia-setup'),
    headline: $('mafia-headline'),
    role: $('mafia-role'),
    roleCard: $('mafia-role-card'),
    roleName: $('mafia-role-name'),
    roleHelp: $('mafia-role-help'),
    prompt: $('mafia-prompt'),
    team: $('mafia-team'),
    seats: $('mafia-seats'),
    nobody: $('mafia-nobody'),
    investigations: $('mafia-investigations'),
    investigationList: $('mafia-investigation-list'),
    result: $('mafia-result'),
    log: $('mafia-log'),
  };

  // Set on every render, so the long-lived "nobody" button always acts on the latest state.
  let handlers = { onPick() {}, onVote() {} };
  ui.nobody.addEventListener('click', () => handlers.onVote(null));

  function make(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

  function stageTitle(game) {
    if (game.stage === 'over') return 'Game over';
    return game.stage === 'night' ? `🌙 Night ${game.round}` : `☀️ Day ${game.round}`;
  }

  function setupText({ players, mafia, doctor, detective, villagers }) {
    const parts = [`${mafia} Mafia`];
    if (doctor) parts.push('a Doctor');
    if (detective) parts.push('a Detective');
    if (villagers) parts.push(plural(villagers, 'Villager'));
    return `${players} players: ${parts.join(', ')}`;
  }

  function promptText(game) {
    if (game.stage === 'over') return 'Every card is face up.';
    const { night, day } = game;
    if (night) {
      const { prompt } = ACTIONS[night.action];
      if (night.team.length) return `${prompt} Your team sees your pick; if you disagree, the most popular pick wins.`;
      if (night.lastProtected) return `${prompt} (Not ${night.lastProtected}: you protected them last night.)`;
      return prompt;
    }
    if (day?.canVote) return 'Talk it over, then vote someone out, or vote for nobody. The day ends once everyone has voted.';
    // Watching: a spectator, or a player who's out.
    const hush = game.isPlaying ? " Don't give anything away!" : '';
    return game.stage === 'night'
      ? `The town is asleep. You'll see what happened at dawn.${hush}`
      : `Votes are public, so you can follow along.${hush}`;
  }

  function renderRole(game) {
    const { you } = game;
    ui.role.hidden = !you;
    if (!you) return;
    const role = ROLES[you.role];
    ui.roleCard.replaceChildren(CardView.face(you.card));
    ui.roleName.textContent = you.isAlive ? role.you : `${role.you}, and you're out.`;
    ui.roleHelp.textContent = role.help;
  }

  function renderTeam(game) {
    const team = game.night ? game.night.team : [];
    ui.team.hidden = team.length === 0;
    ui.team.replaceChildren(...team.map(({ name, pick }) => make('li', '', `${name} picked ${pick ?? 'nobody yet'}`)));
  }

  function voteSummary(seat) {
    if (!seat.hasVoted) return 'not voted';
    return seat.votedFor ? `voted ${seat.votedFor}` : 'voted nobody';
  }

  function renderSeats(game) {
    const { night, day } = game;
    const choices = new Set(night ? night.choices : (day?.canVote && day.choices) || []);
    const current = night ? night.pick : day?.vote ?? null;
    const actionName = night ? ACTIONS[night.action].button : 'Vote';

    ui.seats.replaceChildren(...game.seats.map((seat) => {
      const li = make('li', 'mseat');
      li.classList.toggle('mseat--you', seat.isYou);
      li.classList.toggle('mseat--dead', !seat.isAlive);
      li.classList.toggle('mseat--chosen', seat.id !== null && seat.id === current);

      const head = make('div', 'mseat__head');
      head.appendChild(make('span', 'mseat__name', seat.isYou ? `${seat.name} (you)` : seat.name));
      if (!seat.isAlive) head.appendChild(make('span', 'mseat__badge', seat.hasLeft ? 'left' : 'out'));
      li.appendChild(head);

      if (seat.card) {
        const role = make('div', 'mseat__role');
        role.append(CardView.face(seat.card, 'card--mini'), make('span', '', ROLES[seat.role].name));
        li.appendChild(role);
      }
      if (day && seat.isAlive) {
        li.appendChild(make('span', 'mseat__votes', `${plural(seat.votes, 'vote')} · ${voteSummary(seat)}`));
      }
      if (seat.id !== null && choices.has(seat.id)) {
        const chosen = seat.id === current;
        const button = make('button', 'button button--small mseat__act', chosen ? `✓ ${actionName}` : actionName);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(chosen));
        button.setAttribute('aria-label', `${actionName} ${seat.name}`);
        button.addEventListener('click', () => (night ? handlers.onPick(seat.id) : handlers.onVote(seat.id)));
        li.appendChild(button);
      }
      return li;
    }));
  }

  function renderNobody(game) {
    const { day } = game;
    ui.nobody.hidden = !day?.canVote;
    if (ui.nobody.hidden) return;
    const chosen = day.hasVoted && day.vote === null;
    ui.nobody.textContent = `${chosen ? '✓ ' : ''}Vote for nobody (${day.nobodyVotes})`;
    ui.nobody.setAttribute('aria-pressed', String(chosen));
  }

  function renderInvestigations(game) {
    ui.investigations.hidden = game.investigations.length === 0;
    ui.investigationList.replaceChildren(...game.investigations.map(({ round, name, isMafia }) => make(
      'li', isMafia ? 'mafia__found' : '', `Night ${round}: ${name} ${isMafia ? 'is Mafia!' : 'is not Mafia.'}`,
    )));
  }

  function renderResult(game) {
    ui.result.hidden = !game.result;
    if (!game.result) return;
    const lost = game.isPlaying && !game.result.youWon;
    ui.result.classList.toggle('result--lost', lost);
    let outcome = '';
    if (game.isPlaying) outcome = game.result.youWon ? ' You won.' : ' You lost.';
    ui.result.textContent = `${WINNERS[game.result.winner]}${outcome}`;
  }

  /**
   * @param {object|null} game - the server's Mafia view, or null to hide the table
   * @param {{ onPick: (publicId: string) => void, onVote: (publicId: string|null) => void }} actions
   */
  function render(game, actions) {
    ui.root.hidden = !game;
    if (!game) return;
    handlers = actions;
    ui.root.dataset.stage = game.stage;
    ui.stage.textContent = stageTitle(game);
    ui.setup.textContent = setupText(game.setup);
    ui.headline.textContent = game.headline ?? (game.stage === 'night' ? 'The town falls asleep…' : '');
    ui.headline.hidden = !ui.headline.textContent;
    renderRole(game);
    ui.prompt.textContent = promptText(game);
    renderTeam(game);
    renderSeats(game);
    renderNobody(game);
    renderInvestigations(game);
    renderResult(game);
    ui.log.replaceChildren(...[...game.log].reverse().map((line) => make('li', '', line)));
  }

  /** The line in the page's status bar. Kept free of role details, which anyone nearby can read. */
  function statusText(game) {
    if (game.result) {
      if (!game.isPlaying) return WINNERS[game.result.winner];
      return `${game.result.youWon ? 'You won!' : 'You lost.'} ${WINNERS[game.result.winner]}`;
    }
    if (!game.isPlaying) return `Watching: ${stageTitle(game)}. You'll be dealt in next game.`;
    if (!game.you.isAlive) return `${stageTitle(game)}. You're out: watch quietly!`;
    if (game.night) return game.night.pick ? 'Waiting for the others to pick…' : 'Night: make your pick below.';
    if (game.day.hasVoted) return `You voted. ${game.day.votesCast} of ${game.day.voters} votes are in.`;
    return 'Day: talk it over, then vote below.';
  }

  /** Label for the countdown, e.g. "Night 2 ends". */
  function timerLabel(game) {
    return game.stage === 'night' ? `Night ${game.round} ends` : 'Voting closes';
  }

  return { render, statusText, timerLabel };
})();
