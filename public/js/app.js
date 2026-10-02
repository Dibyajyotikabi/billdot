import { get, post, setUnauthorizedHandler } from './api.js';
import { icons } from './icons.js';
import { $, $$, esc, store, toast, toastError, bindMenus } from './ui.js';
import { DOC_TYPES } from './shared/doc-types.js';
import { applyAppearance } from './shared/appearance.js';

try { applyAppearance({ appearance: { font: localStorage.getItem('bd-font') || 'original', style: localStorage.getItem('bd-style') || 'billdot' } }); } catch { /* Storage may be blocked. */ }

const app = $('#app');

const VIEWS = {
  dashboard: () => import('./views/dashboard.js'),
  documents: () => import('./views/documents.js'),
  editor: () => import('./views/editor.js'),
  detail: () => import('./views/document-detail.js'),
  clients: () => import('./views/clients.js'),
  items: () => import('./views/items.js'),
  settings: () => import('./views/settings.js'),
  payments: () => import('./views/payments.js'),
};

const NAV = [
  ['#/', 'Home', 'home', 'dashboard'],
  ['#/documents', 'Documents', 'docs', 'documents', 'Bills'],
  ['#/payments', 'Payment proofs', 'receipt', 'payments', 'Proofs'],
  ['#/clients', 'Clients', 'clients', 'clients'],
  ['#/items', 'Items', 'items', 'items'],
  ['#/settings', 'Settings', 'settings', 'settings'],
];

let current = null; // { name, instance }
let renderSeq = 0;

/* ---------- routing ---------- */
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(qs));
  const [a, b, c] = parts;
  if (!a) return { name: 'dashboard', query };
  if (a === 'documents') return { name: 'documents', query };
  if (a === 'new' && DOC_TYPES[b]) return { name: 'editor', params: { type: b }, query };
  if (a === 'doc' && b && c === 'edit') return { name: 'editor', params: { id: Number(b) }, query };
  if (a === 'doc' && b) return { name: 'detail', params: { id: Number(b) }, query };
  if (a === 'clients') return { name: 'clients', params: { id: b ? Number(b) : null }, query };
  if (a === 'items') return { name: 'items', query };
  if (a === 'settings') return { name: 'settings', params: { tab: b || '' }, query };
  if (a === 'payments') return { name: 'payments', params: { id: b === 'new' ? 'new' : (b ? Number(b) : null) }, query };
  return { name: 'dashboard', query };
}

const section = (name) => ({ editor: 'documents', detail: 'documents' }[name] || name);

async function route() {
  const seq = ++renderSeq;
  const r = parseRoute();
  if (current?.instance?.beforeLeave && !(await current.instance.beforeLeave())) return;
  current?.instance?.destroy?.();
  current = null;

  const active = section(r.name);
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
  const main = $('#main');
  main.innerHTML = '<div class="skeleton"></div>';
  window.scrollTo(0, 0);
  try {
    const mod = await VIEWS[r.name]();
    if (seq !== renderSeq) return;
    main.innerHTML = '';
    const instance = (await mod.mount(main, { params: r.params || {}, query: r.query, refreshSettings })) || {};
    if (seq !== renderSeq) { instance.destroy?.(); return; }
    current = { name: r.name, instance };
  } catch (err) {
    if (seq !== renderSeq) return;
    main.innerHTML = `<div class="card empty"><span class="dotf">Oops</span>${esc(err.message)}</div>`;
  }
}

export async function refreshSettings() {
  store.settings = await get('/settings');
  applyAppearance(store.settings);
  updateSharePill();
  return store.settings;
}

/* ---------- live updates ---------- */
let events;
function connectEvents() {
  events?.close();
  events = new EventSource('/api/events');
  events.addEventListener('change', (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    if (data.viewed) toast(`${data.number} was just opened by the client`, 'info');
    if (data.claimed) toast(`Client says ${data.number} is paid. Check and confirm it.`, 'info');
    if (data.type === 'tunnel') refreshSettings().catch(() => {});
    current?.instance?.refresh?.(data);
  });
}

// A hidden tab gives up its event stream. Browsers allow only six open
// connections per host, so a few idle tabs could otherwise stall every request.
let watching = false;
function watchVisibility() {
  if (watching) return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      events?.close();
      events = null;
      return;
    }
    if (events || !$('#main')) return;
    connectEvents();
    current?.instance?.refresh?.({ type: 'resume' });
  });
}

// Fetch the other screens in the background so the first click on each is instant.
function prefetchViews() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1200));
  idle(() => Object.values(VIEWS).forEach((load) => load().catch(() => {})));
}

/* ---------- shell ---------- */
function newMenu(extraClass = '') {
  const items = Object.entries(DOC_TYPES)
    .map(([key, t]) => `<a href="#/new/${key}">${esc(t.label)}</a>`).join('');
  return `<div class="menu ${extraClass}">
    <button class="btn btn--primary btn--block" data-menu type="button">${icons.plus}<span>New</span></button>
    <div class="menu-list" hidden style="left:0;right:auto">${items}</div>
  </div>`;
}

function renderShell() {
  const nav = NAV.map(([href, label, icon, key]) =>
    `<a class="nav-link" href="${href}" data-nav="${key}">${icons[icon]}<span>${label}</span></a>`).join('');
  const tabs = NAV.map(([href, label, icon, key, short]) =>
    `<a href="${href}" data-nav="${key}" aria-label="${label}">${icons[icon]}<span>${short || label}</span></a>`).join('');
  app.innerHTML = `<div class="shell">
    <aside class="rail">
      <a class="brand" href="#/"><span class="led"></span><span class="brand-name">Billdot</span></a>
      <div style="padding:0 4px 14px">${newMenu()}</div>
      <nav aria-label="Main navigation">${nav}</nav>
      <div class="rail-foot">
        <a class="share-pill" href="#/settings/sharing" data-share-pill><span class="led"></span><span>Local only</span></a>
        <div class="rail-actions">
          <button class="btn btn--ghost btn--icon btn--sm" data-action="theme" type="button" aria-label="Switch theme" title="Switch theme">${icons.moon}</button>
          <button class="btn btn--ghost btn--icon btn--sm" data-action="logout" type="button" aria-label="Sign out" title="Sign out">${icons.logout}</button>
        </div>
      </div>
    </aside>
    <header class="topbar">
      <a class="brand" href="#/"><span class="led"></span><span class="brand-name">Billdot</span></a>
      <div class="row" style="gap:6px">
        <button class="btn btn--ghost btn--icon btn--sm" data-action="theme" type="button" aria-label="Switch theme">${icons.moon}</button>
        <div class="menu">
          <button class="btn btn--primary btn--sm" data-menu type="button">${icons.plus}<span>New</span></button>
          <div class="menu-list" hidden>${Object.entries(DOC_TYPES).map(([k, t]) => `<a href="#/new/${k}">${esc(t.label)}</a>`).join('')}</div>
        </div>
      </div>
    </header>
    <main class="main" id="main"></main>
    <nav class="tabbar" aria-label="Main navigation">${tabs}</nav>
  </div>`;
  bindMenus(app);
  app.addEventListener('click', onShellClick);
}

async function onShellClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'theme') toggleTheme();
  if (btn.dataset.action === 'logout') {
    await post('/auth/logout').catch(() => {});
    events?.close();
    showAuth();
  }
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('bd-theme', root.dataset.theme); } catch { /* storage blocked */ }
}

function updateSharePill() {
  const url = store.settings?.sharing?.publicUrl;
  $$('[data-share-pill]').forEach((pill) => {
    pill.classList.toggle('on', Boolean(url));
    pill.querySelector('span:last-child').textContent = url ? 'Public link on' : 'Local only';
  });
}

/* ---------- auth ---------- */
async function showAuth() {
  let status;
  try {
    status = await get('/auth/status');
  } catch (err) {
    app.innerHTML = `<div class="auth"><div class="card auth-card"><h1 class="auth-title">Offline</h1><p>${esc(err.message)}</p></div></div>`;
    return;
  }
  if (status.authed) return start();
  const setup = !status.setup;
  const blocked = setup && !status.local;
  app.innerHTML = `<div class="auth">
    <form class="card auth-card" novalidate>
      <div class="row" style="gap:10px"><span class="led led--pulse"></span><span class="label">${setup ? 'First run' : 'Welcome back'}</span></div>
      <h1 class="auth-title">Billdot</h1>
      <p class="muted" style="margin:0">${blocked
        ? 'Open this app on the computer running it to finish the first-time setup.'
        : setup ? 'Set a password to protect your invoices. You will use it on every device.' : 'Sign in to your billing workspace.'}</p>
      ${blocked ? '' : `
        ${setup ? '<label class="field"><span>Business name</span><input class="input" name="businessName" autocomplete="organization" placeholder="Acme Studio"></label>' : ''}
        <label class="field"><span>Password</span><input class="input" name="password" type="password" required minlength="6"
          autocomplete="${setup ? 'new-password' : 'current-password'}" autofocus></label>
        <button class="btn btn--primary btn--block" type="submit">${setup ? 'Create workspace' : 'Sign in'}</button>`}
    </form>
  </div>`;
  const form = $('form', app);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await post(setup ? '/auth/setup' : '/auth/login', data);
      start();
    } catch (err) {
      toastError(err);
      btn.disabled = false;
    }
  });
  $('input[autofocus]', form)?.focus();
}

async function start() {
  renderShell();
  try {
    await refreshSettings();
  } catch (err) {
    toastError(err);
    return;
  }
  connectEvents();
  watchVisibility();
  route();
  prefetchViews();
}

setUnauthorizedHandler(() => {
  events?.close();
  showAuth();
});
window.addEventListener('hashchange', () => { if ($('#main')) route(); });
window.addEventListener('beforeunload', (e) => {
  if (current?.instance?.isDirty?.()) e.preventDefault();
});

showAuth();
