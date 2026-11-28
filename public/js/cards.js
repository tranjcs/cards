'use strict';

/**
 * Renders playing cards as DOM elements. Exposed as `window.CardView`.
 */
window.CardView = (() => {
  const SUIT_SYMBOLS = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
  const RANK_NAMES = { A: 'ace', J: 'jack', Q: 'queen', K: 'king' };
  const RED_SUITS = new Set(['diamonds', 'hearts']);
  // U+FE0E asks for the text form, so phones don't swap in emoji hearts.
  const TEXT_STYLE = '\uFE0E';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Suit and crown shapes on a 24×24 grid.
  const SHAPES = {
    hearts: [['path', { d: 'M12 21.2s-7.6-4.7-9.7-9.4C.8 8.3 2.9 4.4 6.7 4.4c2.2 0 3.8 1.2 5.3 3.1 1.5-1.9 3.1-3.1 5.3-3.1 3.8 0 5.9 3.9 4.4 7.4-2.1 4.7-9.7 9.4-9.7 9.4z' }]],
    diamonds: [['path', { d: 'M12 1.8 20.2 12 12 22.2 3.8 12z' }]],
    spades: [['path', { d: 'M12 1.8S3.4 8.4 3.4 13.3a4.3 4.3 0 0 0 7.2 3.2c-.3 2.2-1.2 3.8-2.6 5.2h8c-1.4-1.4-2.3-3-2.6-5.2a4.3 4.3 0 0 0 7.2-3.2C20.6 8.4 12 1.8 12 1.8z' }]],
    clubs: [
      ['circle', { cx: 12, cy: 6.6, r: 4.4 }],
      ['circle', { cx: 6.6, cy: 13.4, r: 4.4 }],
      ['circle', { cx: 17.4, cy: 13.4, r: 4.4 }],
      ['path', { d: 'M10.9 11h2.2c0 4.2.9 7.6 3 10.7H7.9c2.1-3.1 3-6.5 3-10.7z' }],
    ],
    crown: [['path', { d: 'M2.5 7.5 7 11.5l5-7 5 7 4.5-4-2 11h-15z' }]],
  };

  /**
   * An inline SVG icon: a suit name or "crown".
   * @param {string} name
   * @param {string} [className]
   */
  function icon(name, className = '') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (className) svg.setAttribute('class', className);
    for (const [tag, attrs] of SHAPES[name]) {
      const shape = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, String(value));
      svg.appendChild(shape);
    }
    return svg;
  }

  /** "Q♥" */
  function label(card) {
    return `${card.rank}${SUIT_SYMBOLS[card.suit]}${TEXT_STYLE}`;
  }

  /** "queen of hearts", for screen readers */
  function spokenName(card) {
    return `${RANK_NAMES[card.rank] ?? card.rank} of ${card.suit}`;
  }

  /** Fills `el` with a card face. */
  function paintFace(el, card, extraClass) {
    el.className = `card ${RED_SUITS.has(card.suit) ? 'card--red' : 'card--black'} ${extraClass}`.trim();
    if (card.id) el.dataset.cardId = card.id;
    for (const corner of ['top', 'bottom']) {
      const span = document.createElement('span');
      span.className = `card__corner card__corner--${corner}`;
      span.setAttribute('aria-hidden', 'true');
      span.append(document.createTextNode(card.rank), icon(card.suit, 'card__corner-suit'));
      el.appendChild(span);
    }
    const pip = document.createElement('span');
    pip.className = 'card__pip';
    pip.setAttribute('aria-hidden', 'true');
    if (card.rank === 'Q') pip.appendChild(icon('crown', 'card__crown'));
    pip.appendChild(icon(card.suit, 'card__suit'));
    el.appendChild(pip);
    return el;
  }

  /**
   * A face-up card.
   * @param {{ rank: string, suit: string }} card
   * @param {string} [extraClass]
   */
  function face(card, extraClass = '') {
    const el = paintFace(document.createElement('div'), card, extraClass);
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', spokenName(card));
    return el;
  }

  /**
   * A face-up card the player can select or deselect (a toggle button).
   * @param {{ rank: string, suit: string }} card
   * @param {object} options
   * @param {boolean} options.selected
   * @param {boolean} [options.disabled]
   * @param {() => void} options.onClick
   */
  function selectable(card, { selected, disabled = false, onClick }) {
    const el = paintFace(document.createElement('button'), card, `card--selectable${selected ? ' card--selected' : ''}`);
    el.type = 'button';
    el.disabled = disabled;
    el.setAttribute('aria-pressed', String(selected));
    el.setAttribute('aria-label', spokenName(card));
    el.addEventListener('click', onClick);
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
    el.appendChild(icon('spades', 'card__emboss'));
    if (onClick) {
      el.type = 'button';
      el.setAttribute('aria-label', name ?? 'Face-down card');
      el.addEventListener('click', onClick);
    } else {
      el.setAttribute('aria-hidden', 'true');
    }
    return el;
  }

  return { face, selectable, back, icon, label, spokenName };
})();
