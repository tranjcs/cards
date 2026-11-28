/* global CardView */
'use strict';

/**
 * Mafia's part of the table, drawn from the server's view of the game. Exposed as
 * `window.MafiaView`. Everything shown comes from the server, which only sends what this
 * player may know. The client draws the seats (from `seats()`), the timer and the result;
 * this draws the news in the middle of the felt, the pick/vote bar and your role card.
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
    table: $('table'),
    news: $('mafia-news'),
    stage: $('mafia-stage'),
    headline: $('mafia-headline'),
    setup: $('mafia-setup'),
    act: $('mafia-act'),
    prompt: $('mafia-prompt'),
    choices: $('mafia-choices'),
    team: $('mafia-team'),
    votes: $('mafia-votes'),
    role: $('mafia-role'),
    roleCard: $('mafia-role-card'),
    roleName: $('mafia-role-name'),
    roleHelp: $('mafia-role-help'),
    notes: $('mafia-notes'),
  };

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

  /** Your current pick (at night) or vote (by day), as a public id; null for none or nobody. */
  function currentChoice(game) {
    if (game.night) return game.night.pick;
    return game.day ? game.day.vote : null;
  }

  /** The game's seats in the shape the table's seat ring draws. */
  function seats(game) {
    const current = currentChoice(game);
    return game.seats.map((seat) => {
      const chosen = seat.id !== null && seat.id === current;
      const notes = [];
      if (seat.role) notes.push(ROLES[seat.role].name);
      if (game.day && seat.isAlive) notes.push(plural(seat.votes, 'vote'));
      let badge = '';
      if (seat.hasLeft) badge = 'left';
      else if (!seat.isAlive) badge = 'out';
      else if (chosen) badge = game.night ? 'your pick' : 'your vote';
      return {
        name: seat.name,
        isYou: seat.isYou,
        isDead: !seat.isAlive,
        isTarget: chosen,
        hand: seat.card ? [seat.card] : null,
        faceDown: seat.card ? 0 : 1,
        note: notes.join(' · '),
        badge,
      };
    });
  }

  function promptText(game) {
    const { night, day } = game;
    if (night) {
      const { prompt } = ACTIONS[night.action];
      if (night.team.length) return `${prompt} Your team sees your pick; if you disagree, the most popular pick wins.`;
      if (night.lastProtected) return `${prompt} (Not ${night.lastProtected}: you protected them last night.)`;
      return prompt;
    }
    if (day?.canVote) return 'Talk it over, then vote someone out, or vote for nobody. The day ends once everyone has voted.';
    return '';
  }

  function renderNews(game) {
    ui.news.hidden = false;
    ui.stage.textContent = stageTitle(game);
    ui.headline.textContent = game.headline ?? (game.stage === 'night' ? 'The town falls asleep…' : '');
    ui.headline.hidden = !ui.headline.textContent;
    ui.setup.textContent = setupText(game.setup);
  }

  /** The pick or vote bar: a button per player you can choose, plus "nobody" by day. */
  function renderActions(game, handlers) {
    const { night, day } = game;
    const canVote = Boolean(day?.canVote);
    ui.act.hidden = !night && !canVote;
    if (ui.act.hidden) return;

    ui.prompt.textContent = promptText(game);
    const current = currentChoice(game);
    const actionName = night ? ACTIONS[night.action].button : 'Vote';
    const choices = new Set(night ? night.choices : day.choices);
    const options = game.seats.filter((seat) => seat.id !== null && choices.has(seat.id)).map((seat) => {
      const chosen = seat.id === current;
      const label = seat.isYou ? 'Yourself' : seat.name;
      const button = make('button', 'button button--small ask__option', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(chosen));
      button.setAttribute('aria-label', `${actionName} ${seat.isYou ? 'yourself' : seat.name}`);
      button.addEventListener('click', () => (night ? handlers.onPick(seat.id) : handlers.onVote(seat.id)));
      return button;
    });
    if (canVote) {
      const chosen = day.hasVoted && day.vote === null;
      const nobody = make('button', 'button button--small ask__option', `Nobody (${day.nobodyVotes})`);
      nobody.type = 'button';
      nobody.setAttribute('aria-pressed', String(chosen));
      nobody.setAttribute('aria-label', `Vote for nobody (${plural(day.nobodyVotes, 'vote')} so far)`);
      nobody.addEventListener('click', () => handlers.onVote(null));
      options.push(nobody);
    }
    ui.choices.replaceChildren(...options);

    const team = night ? night.team : [];
    ui.team.hidden = team.length === 0;
    ui.team.replaceChildren(...team.map(({ name, pick }) => make('li', '', `${name} picked ${pick ?? 'nobody yet'}`)));

    // Who voted for whom is public; listing it saves reading every seat.
    const voters = day ? game.seats.filter((seat) => seat.hasVoted) : [];
    ui.votes.hidden = voters.length === 0;
    ui.votes.replaceChildren(...voters.map((seat) => make(
      'li', '', `${seat.isYou ? 'You' : seat.name} voted ${seat.votedFor ?? 'nobody'}`,
    )));
  }

  function renderRole(game) {
    const { you } = game;
    ui.role.hidden = !you;
    if (!you) return;
    const role = ROLES[you.role];
    ui.roleCard.replaceChildren(CardView.face(you.card));
    ui.roleName.textContent = you.isAlive || game.result ? role.you : `${role.you}, and you're out.`;
    let help = role.help;
    if (!you.isAlive && !game.result) help = "Watch quietly, and don't give anything away!";
    ui.roleHelp.textContent = help;
    ui.notes.hidden = game.investigations.length === 0;
    ui.notes.replaceChildren(...game.investigations.map(({ round, name, isMafia }) => make(
      'li', isMafia ? 'mafia-role__found' : '', `Night ${round}: ${name} ${isMafia ? 'is Mafia!' : 'is not Mafia.'}`,
    )));
  }

  /**
   * @param {object|null} game - the server's Mafia view, or null to hide Mafia's parts
   * @param {{ onPick: (publicId: string) => void, onVote: (publicId: string|null) => void }} [handlers]
   */
  function render(game, handlers) {
    // Lets the stylesheet darken the felt at night.
    if (game) ui.table.dataset.mafiaStage = game.stage;
    else delete ui.table.dataset.mafiaStage;
    if (!game) {
      ui.news.hidden = true;
      ui.act.hidden = true;
      ui.role.hidden = true;
      return;
    }
    renderNews(game);
    renderActions(game, handlers);
    renderRole(game);
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

  /** @returns {{ text: string, lost: boolean }} the end-of-game banner */
  function result(game) {
    const lost = game.isPlaying && !game.result.youWon;
    let outcome = '';
    if (game.isPlaying) outcome = game.result.youWon ? ' You won.' : ' You lost.';
    return { text: `${WINNERS[game.result.winner]}${outcome}`, lost };
  }

  return { render, seats, statusText, timerLabel, result };
})();
