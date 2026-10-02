import { get, post, put, del } from '../api.js';
import { icons } from '../icons.js';
import {
  $, esc, money, date, statusPill, store, debounce, toast, toastError, modal, confirmDialog, emptyState,
} from '../ui.js';
import { DOC_TYPES } from '../shared/doc-types.js';

const FIELDS = [
  ['name', 'Name', 'text', true], ['company', 'Company', 'text'], ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'],
  ['tax_id', 'Tax ID / GSTIN', 'text'], ['address', 'Address', 'textarea'], ['notes', 'Private notes', 'textarea'],
];

const clientForm = (c = {}) => `<div class="stack" style="gap:12px">${FIELDS.map(([k, label, type, req]) => `
  <label class="field"><span>${esc(label)}</span>${type === 'textarea'
    ? `<textarea class="textarea" name="${k}" rows="3">${esc(c[k] || '')}</textarea>`
    : `<input class="input" name="${k}" type="${type}" value="${esc(c[k] || '')}" ${req ? 'required autofocus' : ''}>`}</label>`).join('')}</div>`;

const cur = () => store.settings.documents.currency;

function listView(list) {
  if (!list.length) return '';
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Client</th><th class="hide-sm">Contact</th><th class="r hide-sm">Billed</th><th class="r">Outstanding</th></tr></thead>
    <tbody>${list.map((c) => `<tr data-href="#/clients/${c.id}" tabindex="0">
      <td><span class="strong">${esc(c.name)}</span><div class="sub">${esc(c.company || `${c.doc_count} document${c.doc_count === 1 ? '' : 's'}`)}</div></td>
      <td class="hide-sm">${esc(c.email || c.phone || '-')}</td>
      <td class="r num hide-sm">${esc(money(c.billed, cur()))}</td>
      <td class="r num">${c.outstanding > 0 ? `<b>${esc(money(c.outstanding, cur()))}</b>` : '<span class="muted">-</span>'}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

async function mountList(el) {
  let q = '';
  el.innerHTML = `
    <div class="page-head">
      <div><div class="label">People</div><h1 class="page-title">Clients</h1></div>
      <div class="page-actions"><button class="btn btn--primary" data-new>${icons.plus}<span>New client</span></button></div>
    </div>
    <div class="toolbar" style="margin-bottom:18px"><input class="search" type="search" placeholder="Search name, company or email" aria-label="Search clients"></div>
    <div class="card" data-results><div class="skeleton" style="height:160px"></div></div>`;

  const results = $('[data-results]', el);
  let seq = 0;
  const load = async () => {
    const mine = ++seq;
    const list = await get(`/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (mine !== seq) return;
    results.innerHTML = listView(list) || emptyState(q ? 'No match' : 'No clients yet',
      q ? 'Try another name.' : 'Clients are saved automatically when you bill them. You can also add one here.');
  };

  el.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-href]');
    if (row) { location.hash = row.dataset.href; return; }
    if (!e.target.closest('[data-new]')) return;
    const data = await modal({ title: 'New client', body: clientForm(), submit: 'Save client' });
    if (!data) return;
    try {
      const c = await post('/clients', data);
      toast('Client saved');
      location.hash = `#/clients/${c.id}`;
    } catch (err) { toastError(err); }
  });
  el.addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-href]');
    if (row && e.key === 'Enter') location.hash = row.dataset.href;
  });
  const search = debounce(load, 220);
  $('.search', el).addEventListener('input', (e) => { q = e.target.value.trim(); search(); });
  await load();
  return { refresh: () => load().catch(() => {}) };
}

function detailView(c) {
  const docs = c.documents || [];
  return `
    <div class="page-head">
      <div><a class="label" href="#/clients" style="text-decoration:none">Clients</a>
        <h1 class="page-title">${esc(c.name)}</h1>${c.company ? `<div class="muted" style="margin-top:4px">${esc(c.company)}</div>` : ''}</div>
      <div class="page-actions">
        <button class="btn btn--ghost" data-act="edit">${icons.edit}<span>Edit</span></button>
        <a class="btn btn--primary" href="#/new/invoice?client=${c.id}">${icons.plus}<span>New invoice</span></a>
      </div>
    </div>
    <div class="detail">
      <section class="card">
        <div class="card-head"><span class="label">Documents · ${docs.length}</span></div>
        ${docs.length ? `<div class="table-wrap"><table class="table"><tbody>${docs.map((d) => `<tr data-href="#/doc/${d.id}" tabindex="0">
          <td><span class="mono strong">${esc(d.number)}</span><div class="sub">${esc(DOC_TYPES[d.type]?.label)}${d.subject ? ` · ${esc(d.subject)}` : ''}</div></td>
          <td class="hide-sm">${esc(date(d.issue_date))}</td>
          <td>${statusPill(d.display_status)}</td>
          <td class="r num">${esc(money(d.total, d.currency))}</td></tr>`).join('')}</tbody></table></div>`
          : emptyState('Nothing billed yet', 'Create the first invoice for this client.')}
      </section>
      <aside class="detail-side">
        <section class="card card-pad">
          <span class="label">Outstanding</span>
          <div class="amount-big">${esc(money(c.outstanding, cur()))}</div>
          <dl class="kv">
            <dt>Billed</dt><dd>${esc(money(c.billed, cur()))}</dd>
            ${c.email ? `<dt>Email</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>` : ''}
            ${c.phone ? `<dt>Phone</dt><dd><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></dd>` : ''}
            ${c.tax_id ? `<dt>Tax ID</dt><dd>${esc(c.tax_id)}</dd>` : ''}
          </dl>
          ${c.address ? `<p class="muted" style="white-space:pre-line;margin:14px 0 0;font-size:14px">${esc(c.address)}</p>` : ''}
          ${c.notes ? `<p style="white-space:pre-line;margin:14px 0 0;font-size:14px">${esc(c.notes)}</p>` : ''}
        </section>
        <section class="card card-pad stack" style="gap:8px">
          <div class="action-grid">
            <a class="btn" href="#/new/quote?client=${c.id}">${icons.plus}<span>Quotation</span></a>
            <a class="btn" href="#/new/receipt?client=${c.id}">${icons.plus}<span>Receipt</span></a>
          </div>
          <button class="btn btn--ghost btn--block" data-act="delete" style="color:var(--red)">${icons.trash}<span>Delete client</span></button>
        </section>
      </aside>
    </div>`;
}

async function mountDetail(el, id) {
  let client;
  const load = async () => {
    client = await get(`/clients/${id}`);
    el.innerHTML = detailView(client);
  };

  el.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-href]');
    if (row) { location.hash = row.dataset.href; return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') {
      const data = await modal({ title: 'Edit client', body: clientForm(client), submit: 'Save' });
      if (!data) return;
      try {
        await put(`/clients/${id}`, data);
        toast('Client updated');
        await load();
      } catch (err) { toastError(err); }
    }
    if (act === 'delete') {
      const ok = await confirmDialog(`Delete ${client.name}?`,
        'Their documents stay, with the client details printed on them.', { submit: 'Delete', danger: true });
      if (!ok) return;
      try {
        await del(`/clients/${id}`);
        toast('Client deleted');
        location.hash = '#/clients';
      } catch (err) { toastError(err); }
    }
  });

  await load();
  return { refresh: (evt) => { if (evt.type === 'document') load().catch(() => {}); } };
}

export function mount(el, { params }) {
  return params.id ? mountDetail(el, params.id) : mountList(el);
}
