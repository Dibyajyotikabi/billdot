import { esc } from '../ui.js';

// Autocomplete for a text input. `search(q)` returns options, `label(opt)`
// and `hint(opt)` render them, `onPick(opt)` fires on choice.
export function attachCombo(input, { search, label, hint = () => '', onPick, minChars = 0 }) {
  const wrap = input.closest('.combo');
  const list = document.createElement('div');
  list.className = 'combo-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(list);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');

  let options = [];
  let active = -1;
  let seq = 0;

  const close = () => { list.hidden = true; active = -1; };
  const paint = () => {
    list.innerHTML = options.map((o, i) => `<div class="combo-opt ${i === active ? 'on' : ''}" role="option" data-i="${i}">
      <span>${esc(label(o))}</span><small>${esc(hint(o))}</small></div>`).join('');
    list.hidden = options.length === 0;
  };
  const open = async () => {
    const q = input.value.trim();
    if (q.length < minChars) return close();
    const mine = ++seq;
    const found = await search(q);
    if (mine !== seq || document.activeElement !== input) return;
    options = found.filter((o) => label(o).toLowerCase() !== q.toLowerCase() || found.length > 1).slice(0, 8);
    active = -1;
    paint();
  };
  const pick = (i) => {
    const opt = options[i];
    if (!opt) return;
    close();
    onPick(opt);
  };

  input.addEventListener('input', open);
  input.addEventListener('focus', open);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, options.length - 1); paint(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
    if (e.key === 'Enter' && active >= 0) { pick(active); e.preventDefault(); }
    if (e.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    e.preventDefault();
    pick(Number(row.dataset.i));
  });
}

// Small cache so typing doesn't hit the server on every key.
export function cachedLoader(load, ttl = 30000) {
  let at = 0;
  let data = null;
  return async () => {
    if (!data || Date.now() - at > ttl) {
      data = await load();
      at = Date.now();
    }
    return data;
  };
}
