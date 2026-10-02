import { escapeHtml, formatMoney, formatDate } from './shared/format.js';
import { STATUS_LABELS } from './shared/doc-types.js';
import { pageCss } from './shared/render-doc.js';
import { icons } from './icons.js';

export const esc = escapeHtml;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- shared app state ---------- */
export const store = { settings: null };

// Settings as one business sees them: its details, payment info and numbering.
export function settingsFor(businessId) {
  const s = store.settings;
  const biz = s?.businesses?.find((b) => b.id === Number(businessId))
    || s?.businesses?.find((b) => b.isDefault);
  return biz ? { ...s, business: biz.business, payment: biz.payment, numbering: biz.numbering } : s;
}

export const businessOf = (id) => store.settings?.businesses?.find((b) => b.id === Number(id)) || null;
export const hasManyBusinesses = () => (store.settings?.businesses?.length || 0) > 1;

export const money = (n, currency) =>
  formatMoney(n, currency || store.settings?.documents.currency || 'INR', store.settings?.documents.locale || 'en-IN');
export const date = (iso) => formatDate(iso, store.settings?.documents.locale || 'en-IN');

export function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return date(iso);
}

export const statusPill = (status) =>
  `<span class="pill pill--${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    return fn(...args);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/* ---------- toasts ---------- */
export function toast(message, kind = 'ok') {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="led"></span><span>${esc(message)}</span>`;
  host.append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3200);
}

export const toastError = (err) => toast(err?.message || String(err), 'err');

/* ---------- modal ---------- */
// Resolves with the submitted FormData as an object, or null when dismissed.
export function modal({ title, body, submit = 'Save', danger = false, cancel = 'Cancel', onOpen }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2>
        <button type="button" class="btn btn--ghost btn--icon btn--sm" data-close aria-label="Close">${icons.x}</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">
        ${cancel ? `<button type="button" class="btn" data-close>${esc(cancel)}</button>` : ''}
        ${submit ? `<button type="submit" class="btn ${danger ? 'btn--red' : 'btn--primary'}">${esc(submit)}</button>` : ''}
      </div>
    </form>`;
    const form = back.querySelector('form');
    const previous = document.activeElement;
    const close = (value) => {
      back.remove();
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      for (const cb of form.querySelectorAll('input[type=checkbox][name]')) data[cb.name] = cb.checked;
      close(data);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    (form.querySelector('[autofocus]') || form.querySelector('input, textarea, select, button[type=submit]'))?.focus();
    onOpen?.(form, close);
  });
}

export async function confirmDialog(title, message, { submit = 'Confirm', danger = false } = {}) {
  const res = await modal({ title, body: `<p style="margin:0;color:var(--ink-2)">${esc(message)}</p>`, submit, danger });
  return res !== null;
}

/* ---------- dropdown menu ---------- */
export function bindMenus(root) {
  root.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-menu]');
    if (!trigger) return;
    e.stopPropagation();
    const list = trigger.parentElement.querySelector('.menu-list');
    const open = list.hidden;
    $$('.menu-list').forEach((m) => { m.hidden = true; });
    list.hidden = !open;
  });
}
document.addEventListener('click', () => $$('.menu-list').forEach((m) => { m.hidden = true; }));

/* ---------- sheet fitting ---------- */
// Scales an A4/receipt sheet to the width of its container.
export function fitSheet(holder, { maxScale = 1 } = {}) {
  const sheet = holder.querySelector('.nd');
  if (!sheet) return () => {};
  const apply = () => {
    const box = holder.parentElement;
    const cs = getComputedStyle(box);
    const available = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const w = sheet.offsetWidth;
    const scale = Math.min(maxScale, available / w);
    sheet.style.transform = `scale(${scale})`;
    holder.style.width = `${w * scale}px`;
    holder.style.height = `${sheet.offsetHeight * scale}px`;
  };
  apply();
  let frame = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  });
  ro.observe(holder.parentElement);
  ro.observe(sheet);
  document.fonts?.ready.then(apply);
  return () => { cancelAnimationFrame(frame); ro.disconnect(); };
}

/* ---------- printing ---------- */
const MM_PER_PX = 25.4 / 96;

export function printSheet(sheetHtml, format, title) {
  const host = $('#print-host');
  host.innerHTML = sheetHtml;
  const measured = host.querySelector('.nd')?.scrollHeight;
  const css = pageCss(format, measured ? Math.ceil(measured * MM_PER_PX) + 4 : undefined);
  let style = $('#page-size');
  if (!style) {
    style = document.createElement('style');
    style.id = 'page-size';
    document.head.append(style);
  }
  style.textContent = css;
  const oldTitle = document.title;
  if (title) document.title = title;
  document.body.classList.add('printing');
  const done = () => {
    document.body.classList.remove('printing');
    host.innerHTML = '';
    document.title = oldTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  (document.fonts?.ready || Promise.resolve()).then(() => {
    const imgs = [...host.querySelectorAll('img')].map((img) =>
      img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; }));
    return Promise.all(imgs);
  }).then(() => window.print());
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function emptyState(title, text, action = '') {
  return `<div class="empty"><span class="dotf">${esc(title)}</span>${esc(text)}${action ? `<div style="margin-top:16px">${action}</div>` : ''}</div>`;
}
