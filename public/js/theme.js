'use strict';

/**
 * Color theme: follows the system unless the viewer picks light or dark.
 * Loaded in <head> so the saved choice applies before the first paint.
 */
(() => {
  const KEY = 'cards:theme';
  const ORDER = ['system', 'light', 'dark'];
  const root = document.documentElement;

  const read = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };
  const write = (value) => {
    try { localStorage.setItem(KEY, value); } catch { /* the choice just won't persist */ }
  };

  function apply(theme) {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
  }

  let current = ORDER.includes(read()) ? read() : 'system';
  apply(current);

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const label = () => {
      const text = `Color theme: ${current}`;
      button.setAttribute('aria-label', text);
      button.title = text;
      button.dataset.mode = current;
    };
    label();
    button.addEventListener('click', () => {
      current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
      apply(current);
      write(current);
      label();
    });
  });
})();
