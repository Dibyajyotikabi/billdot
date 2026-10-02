import { get } from '../api.js';
import { icons } from '../icons.js';
import { $, esc, money, date, statusPill, debounce, emptyState, store, businessOf, hasManyBusinesses } from '../ui.js';
import { DOC_TYPES } from '../shared/doc-types.js';

const STATUS_FILTERS = [
  ['', 'All'], ['draft', 'Draft'], ['sent', 'Sent'], ['viewed', 'Viewed'], ['claimed', 'Claimed'],
  ['overdue', 'Overdue'], ['partial', 'Partly paid'], ['paid', 'Paid'], ['accepted', 'Accepted'], ['void', 'Void'],
];

function rows(list) {
  if (!list.length) return '';
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Number</th><th>Client</th><th class="hide-sm">Issued</th><th class="hide-sm">Due</th><th>Status</th><th class="r">Total</th></tr></thead>
    <tbody>${list.map((d) => `<tr data-href="#/doc/${d.id}" tabindex="0">
      <td><span class="mono strong">${esc(d.number)}</span><div class="sub">${esc(DOC_TYPES[d.type]?.label || d.type)}${d.recurring ? ' · repeats' : ''}${hasManyBusinesses() && businessOf(d.business_id) ? ` · ${esc(businessOf(d.business_id).code)}` : ''}</div></td>
      <td><span class="strong">${esc(d.client?.name || '-')}</span>${d.subject ? `<div class="sub">${esc(d.subject)}</div>` : ''}</td>
      <td class="hide-sm">${esc(date(d.issue_date))}</td>
      <td class="hide-sm">${esc(date(d.due_date) || '-')}</td>
      <td>${statusPill(d.display_status)}</td>
      <td class="r num">${esc(money(d.total, d.currency))}${d.balance > 0 && d.amount_paid > 0 ? `<div class="sub">${esc(money(d.balance, d.currency))} left</div>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

export async function mount(el, { query }) {
  const state = { type: query.type || '', status: query.status || '', business: query.business || '', q: query.q || '' };
  const types = [['', 'All'], ...Object.entries(DOC_TYPES).map(([k, t]) => [k, t.label])];
  el.innerHTML = `
    <div class="page-head">
      <div><div class="label">Library</div><h1 class="page-title">Documents</h1></div>
      <div class="page-actions"><a class="btn btn--primary" href="#/new/${state.type || 'invoice'}" data-new>${icons.plus}<span>New</span></a></div>
    </div>
    <div class="stack" style="gap:14px;margin-bottom:18px">
      <div class="seg" role="tablist">${types.map(([k, l]) => `<button type="button" data-type="${k}" class="${k === state.type ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
      <div class="toolbar">
        <input class="search" type="search" placeholder="Search number, client or subject" value="${esc(state.q)}" aria-label="Search documents">
        ${hasManyBusinesses() ? `<select class="select" data-business aria-label="Business" style="width:auto;min-width:180px">
          <option value="">All businesses</option>
          ${store.settings.businesses.map((b) => `<option value="${b.id}" ${String(b.id) === state.business ? 'selected' : ''}>${esc(b.code)}  ${esc(b.business.name || b.name)}</option>`).join('')}
        </select>` : ''}
      </div>
      <div class="chips">${STATUS_FILTERS.map(([k, l]) => `<button type="button" class="chip ${k === state.status ? 'on' : ''}" data-status="${k}">${esc(l)}</button>`).join('')}</div>
    </div>
    <div class="card" data-results><div class="skeleton" style="height:180px"></div></div>`;

  const results = $('[data-results]', el);
  let seq = 0;
  const load = async () => {
    const mine = ++seq;
    const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString();
    const list = await get(`/documents${qs ? `?${qs}` : ''}`);
    if (mine !== seq) return;
    results.innerHTML = rows(list) || emptyState('Nothing here',
      state.q || state.status ? 'No documents match these filters.' : 'Create your first document to get going.',
      `<a class="btn btn--primary" href="#/new/${state.type || 'invoice'}">${icons.plus}<span>New ${esc((DOC_TYPES[state.type]?.label || 'invoice').toLowerCase())}</span></a>`);
    const qsHash = new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString();
    history.replaceState(null, '', `#/documents${qsHash ? `?${qsHash}` : ''}`);
    $('[data-new]', el).setAttribute('href', `#/new/${state.type || 'invoice'}`);
  };

  el.addEventListener('click', (e) => {
    const typeBtn = e.target.closest('[data-type]');
    const statusBtn = e.target.closest('[data-status]');
    const row = e.target.closest('[data-href]');
    if (typeBtn) {
      state.type = typeBtn.dataset.type;
      el.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('on', b === typeBtn));
      load();
    } else if (statusBtn) {
      state.status = statusBtn.dataset.status;
      el.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('on', b === statusBtn));
      load();
    } else if (row) {
      location.hash = row.dataset.href;
    }
  });
  el.addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-href]');
    if (row && e.key === 'Enter') location.hash = row.dataset.href;
  });
  const search = debounce(() => load(), 220);
  $('.search', el).addEventListener('input', (e) => { state.q = e.target.value.trim(); search(); });
  $('[data-business]', el)?.addEventListener('change', (e) => { state.business = e.target.value; load(); });

  await load();
  return { refresh: () => load().catch(() => {}) };
}
