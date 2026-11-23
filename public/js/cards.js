'use strict';

/**
 * Renders playing cards as DOM elements. Exposed as `window.CardView`.
 */
window.CardView = (() => {
  const SUIT_SYMBOLS = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
  const RANK_NAMES = { A: 'ace', J: 'jack', Q: 'queen', K: 'king' };
  const RED_SUITS = new Set(['diamonds', 'hearts']);

  /** "Q♥" */
  function label(card) {
    return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
  }

  /** "queen of hearts", for screen readers */
  function spokenName(card) {
    return `${RANK_NAMES[card.rank] ?? card.rank} of ${card.suit}`;
  }

  /**
   * A face-up card.
   * @param {{ rank: string, suit: string }} card
   * @param {string} [extraClass]
   */
  function face(card, extraClass = '') {
    const el = document.createElement('div');
    el.className = `card ${RED_SUITS.has(card.suit) ? 'card--red' : 'card--black'} ${extraClass}`.trim();
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', spokenName(card));
    const symbol = SUIT_SYMBOLS[card.suit];
    for (const corner of ['top', 'bottom']) {
      const span = document.createElement('span');
      span.className = `card__corner card__corner--${corner}`;
      span.setAttribute('aria-hidden', 'true');
      span.append(card.rank, document.createElement('br'), symbol);
      el.appendChild(span);
    }
    const pip = document.createElement('span');
    pip.className = 'card__pip';
    pip.setAttribute('aria-hidden', 'true');
    pip.textContent = card.rank === 'Q' ? `👑${symbol}` : symbol;
    el.appendChild(pip);
    return el;
  }

  /**
   * A face-down card; a button when `onClick` is given.
   * @param {object} [options]
   * @param {() => void} [options.onClick]
   * @param {string} [options.label] - accessible name for the button
   * @param {string} [options.extraClass]
   */
  function back({ onClick, label: name, extraClass = '' } = {}) {
    const el = document.createElement(onClick ? 'button' : 'div');
    el.className = `card card--back ${extraClass}`.trim();
    if (onClick) {
      el.type = 'button';
      el.setAttribute('aria-label', name ?? 'Face-down card');
      el.addEventListener('click', onClick);
    } else {
      el.setAttribute('aria-hidden', 'true');
    }
    return el;
  }

  return { face, back, label, spokenName };
})();
