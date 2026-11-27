'use strict';

/**
 * Lets a player arrange the cards in their own hand: by value (the game's order), by
 * suit, or freely by dragging. Purely local: the server and other players never see
 * the arrangement. Exposed as `window.HandArranger`.
 *
 * Dragging uses pointer events so it works with a mouse, a pen or a finger. With a
 * finger, press and hold a card first so a normal swipe still scrolls the page.
 * Alt + ←/→ moves the focused card one place.
 */
window.HandArranger = (() => {
  const Mode = { VALUE: 'value', SUIT: 'suit', FREE: 'free' };
  const MODES = Object.values(Mode);
  const SUIT_ORDER = ['clubs', 'spades', 'hearts', 'diamonds'];
  const MODE_KEY = 'cards:hand-arrangement';
  const LONG_PRESS_MS = 300;
  const DRAG_THRESHOLD_PX = 5;
  const TOUCH_SLOP_PX = 10;

  // sessionStorage can throw (private windows, blocked storage); it's only a convenience.
  const saved = {
    get() {
      try { return sessionStorage.getItem(MODE_KEY); } catch { return null; }
    },
    set(value) {
      try { sessionStorage.setItem(MODE_KEY, value); } catch { /* ignore */ }
    },
  };

  /**
   * @param {object} options
   * @param {HTMLElement} options.container - holds the hand's cards, each with data-card-id
   * @param {() => void} options.onChange - called when the arrangement changes; re-render the hand
   */
  function create({ container, onChange }) {
    let mode = MODES.includes(saved.get()) ? saved.get() : Mode.VALUE;
    /** @type {string[]} card ids in the player's own order (free mode) */
    let freeOrder = [];
    /** @type {string[]} ids as last displayed */
    let shown = [];
    let drag = null;
    let suppressClick = false;

    /**
     * @template {{ id: string, suit: string }} C
     * @param {C[]} cards - in the game's order
     * @returns {C[]} in display order
     */
    function arrange(cards) {
      let result = cards;
      if (mode === Mode.SUIT) {
        const valueIndex = new Map(cards.map((card, index) => [card.id, index]));
        result = [...cards].sort((a, b) =>
          SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit) || valueIndex.get(a.id) - valueIndex.get(b.id));
      } else if (mode === Mode.FREE) {
        // Keep the player's order for cards still held; new cards go on the end.
        const byId = new Map(cards.map((card) => [card.id, card]));
        const kept = freeOrder.filter((id) => byId.has(id));
        const keptSet = new Set(kept);
        freeOrder = [...kept, ...cards.map((card) => card.id).filter((id) => !keptSet.has(id))];
        result = freeOrder.map((id) => byId.get(id));
      }
      shown = result.map((card) => card.id);
      return result;
    }

    /** @param {string} next - one of Mode */
    function setMode(next) {
      if (!MODES.includes(next) || next === mode) return;
      if (next === Mode.FREE) freeOrder = [...shown]; // start from what's on screen
      mode = next;
      saved.set(mode);
      onChange();
    }

    /** Forget the free order, e.g. when a new game is dealt. */
    function reset() {
      freeOrder = [];
    }

    /** Moves a card to a new position in the displayed order and switches to free mode. */
    function moveTo(id, index) {
      const order = shown.filter((other) => other !== id);
      order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
      freeOrder = order;
      shown = order;
      mode = Mode.FREE;
      saved.set(mode);
      onChange();
    }

    // ---- dragging ---------------------------------------------------------

    const cardEls = () => [...container.querySelectorAll('[data-card-id]')];

    function clearDropMarks() {
      for (const el of cardEls()) el.classList.remove('card--drop-before', 'card--drop-after');
    }

    /** Where the dragged card would land: before or after the card nearest the pointer. */
    function dropTarget(x, y) {
      let best = null;
      for (const el of cardEls()) {
        if (el === drag.el) continue;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        // Rows matter more than columns, so a card in the same row wins.
        const distance = Math.abs(x - cx) + Math.abs(y - cy) * 3;
        if (!best || distance < best.distance) best = { el, distance, after: x > cx };
      }
      return best;
    }

    function endDrag(commit) {
      if (!drag) return;
      clearTimeout(drag.timer);
      const { el, id, target } = drag;
      el.classList.remove('card--dragging', 'card--lifted');
      el.style.transform = '';
      clearDropMarks();
      const wasActive = drag.active;
      const wasLifted = drag.touch && drag.armed;
      drag = null;
      if (wasActive || wasLifted) {
        // The click that follows a drag must not also select the card.
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
      }
      if (commit && wasActive && target) {
        const order = shown.filter((other) => other !== id);
        const index = order.indexOf(target.el.dataset.cardId) + (target.after ? 1 : 0);
        moveTo(id, index);
      } else if (wasActive) {
        onChange(); // catch up on anything that arrived during the drag
      }
    }

    container.addEventListener('pointerdown', (event) => {
      if (drag || event.button !== 0) return;
      const el = event.target.closest('[data-card-id]');
      if (!el || !container.contains(el)) return;
      const touch = event.pointerType === 'touch';
      drag = {
        el,
        id: el.dataset.cardId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        armed: !touch,
        touch,
        active: false,
        target: null,
        timer: null,
      };
      if (touch) {
        drag.timer = setTimeout(() => {
          if (!drag) return;
          drag.armed = true;
          el.classList.add('card--lifted');
          navigator.vibrate?.(15);
        }, LONG_PRESS_MS);
      }
    });

    container.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const distance = Math.hypot(dx, dy);
      if (!drag.active) {
        if (!drag.armed) {
          if (distance > TOUCH_SLOP_PX) endDrag(false); // a swipe: let the page scroll
          return;
        }
        if (!drag.touch && distance < DRAG_THRESHOLD_PX) return;
        drag.active = true;
        // The hand may have been re-rendered since pointerdown; follow the new element.
        if (!drag.el.isConnected) {
          const fresh = container.querySelector(`[data-card-id="${CSS.escape(drag.id)}"]`);
          if (!fresh) {
            endDrag(false);
            return;
          }
          drag.el = fresh;
        }
        drag.el.setPointerCapture?.(event.pointerId);
        drag.el.classList.add('card--dragging');
      }
      drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
      clearDropMarks();
      drag.target = dropTarget(event.clientX, event.clientY);
      drag.target?.el.classList.add(drag.target.after ? 'card--drop-after' : 'card--drop-before');
    });

    container.addEventListener('pointerup', (event) => {
      if (drag && event.pointerId === drag.pointerId) endDrag(true);
    });
    container.addEventListener('pointercancel', (event) => {
      if (drag && event.pointerId === drag.pointerId) endDrag(false);
    });
    // Once a held card is lifted, stop the finger from scrolling the page.
    container.addEventListener('touchmove', (event) => {
      if (drag && (drag.armed || drag.active)) event.preventDefault();
    }, { passive: false });
    container.addEventListener('contextmenu', (event) => {
      if (drag) event.preventDefault();
    });
    container.addEventListener('click', (event) => {
      if (!suppressClick) return;
      event.stopPropagation();
      event.preventDefault();
    }, true);

    // ---- keyboard ---------------------------------------------------------

    container.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      const el = event.target.closest('[data-card-id]');
      if (!el) return;
      event.preventDefault();
      const { cardId } = el.dataset;
      moveTo(cardId, shown.indexOf(cardId) + (event.key === 'ArrowLeft' ? -1 : 1));
      container.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`)?.focus();
    });

    return {
      arrange,
      setMode,
      reset,
      get mode() { return mode; },
      /** True while a card is being dragged: hold off re-rendering the hand. */
      get isDragging() { return Boolean(drag?.active); },
    };
  }

  return { create, Mode };
})();
