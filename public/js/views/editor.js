import { get, post, put } from '../api.js';
import { icons } from '../icons.js';
import { $, $$, esc, money, store, debounce, fitSheet, toast, settingsFor, hasManyBusinesses } from '../ui.js';
import { DOC_TYPES, FORMATS } from '../shared/doc-types.js';
import { computeTotals } from '../shared/calc.js';
import { localToday, addDays } from '../shared/format.js';
import { renderDocument } from '../shared/render-doc.js';
import { attachCombo, cachedLoader } from './combo.js';

const AUTOSAVE_MS = 700;
const PAPER = { a4: [30, 42], letter: [31, 40], a5: [22, 31], thermal80: [18, 44], thermal58: [13, 44] };
const DUE_PRESETS = [[0, 'On receipt'], [7, '7 days'], [15, '15 days'], [30, '30 days'], [45, '45 days']];
const CLIENT_FIELDS = [['email', 'Email', 'email'], ['phone', 'Phone', 'tel'], ['company', 'Company', 'text'], ['tax_id', 'Tax ID / GSTIN', 'text']];

const blankLine = () => ({ name: '', description: '', qty: 1, unit: '', rate: '', tax_rate: store.settings.documents.defaultTaxRate });

function newDocument(type, client) {
  const s = store.settings.documents;
  const today = localToday();
  const days = type === 'quote' ? s.quoteValidDays : s.defaultDueDays;
  return {
    type,
    business_id: store.settings.defaultBusinessId,
    format: type === 'receipt' ? 'a5' : s.defaultFormat,
    number: '',
    issue_date: today,
    due_date: DOC_TYPES[type].dateLabel ? addDays(today, days) : null,
    currency: s.currency,
    subject: '',
    reference: '',
    client: client || { name: '' },
    items: [blankLine()],
    discount_type: 'amount',
    discount_value: 0,
    shipping: 0,
    notes: s.notes || '',
    terms: s.terms || '',
    recurring: null,
    status: 'draft',
    amount_paid: 0,
  };
}

const hasContent = (d) => Boolean(d.client?.name || d.subject || d.items.some((it) => it.name || Number(it.rate)));

function payload(d) {
  const { type, business_id, format, number, issue_date, due_date, currency, subject, reference, client, items,
    discount_type, discount_value, shipping, notes, terms, recurring } = d;
  return { type, business_id, format, number, issue_date, due_date, currency, subject, reference, client, discount_type,
    discount_value, shipping, notes, terms, recurring,
    items: items.map((it) => ({ ...it, rate: Number(it.rate) || 0, qty: Number(it.qty) || 0, tax_rate: Number(it.tax_rate) || 0 })) };
}

/* ---------- markup ---------- */
function businessPicker(d) {
  if (!hasManyBusinesses()) return '';
  const options = store.settings.businesses.map((b) => `<option value="${b.id}" ${b.id === Number(d.business_id) ? 'selected' : ''}>
    ${esc(b.code)}  ${esc(b.business.name || b.name)}</option>`).join('');
  return `<label class="field" style="margin-bottom:14px"><span>Sending from</span>
    <select class="select" data-d="business_id">${options}</select></label>`;
}

function formatPicker(d) {
  return Object.entries(FORMATS).map(([key, f]) => {
    const [w, h] = PAPER[key];
    return `<label class="format-opt"><input type="radio" name="format" value="${key}" ${d.format === key ? 'checked' : ''}>
      <span class="box"><span class="paper" style="width:${w}px;height:${h}px"></span>${esc(f.label)}<span class="hint">${esc(f.hint)}</span></span></label>`;
  }).join('');
}

function lineRow(it, i, hidePrices) {
  return `<div class="line" data-line="${i}">
    <span class="idx">${String(i + 1).padStart(2, '0')}</span>
    <div class="wide">
      <div class="combo"><input class="input" data-f="name" value="${esc(it.name)}" placeholder="Item or service" aria-label="Item name"></div>
      <input class="input desc" data-f="description" value="${esc(it.description)}" placeholder="Description (optional)" aria-label="Description">
    </div>
    <label class="cell"><span class="ml">Qty</span><input class="input" data-f="qty" inputmode="decimal" value="${esc(it.qty)}" aria-label="Quantity"></label>
    <label class="cell"><span class="ml">Rate</span><input class="input" data-f="rate" inputmode="decimal" value="${esc(it.rate)}" placeholder="0.00" aria-label="Rate" ${hidePrices ? 'title="Prices are hidden on delivery notes"' : ''}></label>
    <label class="cell tax"><span class="ml">${esc(store.settings.documents.taxLabel)} %</span><input class="input" data-f="tax_rate" inputmode="decimal" value="${esc(it.tax_rate)}" aria-label="Tax percent"></label>
    <button class="btn btn--ghost btn--icon btn--sm rm" type="button" data-rm="${i}" aria-label="Remove line">${icons.x}</button>
    <div class="amount"><span>${it.unit ? esc(it.unit) : ''}</span><b data-amount>${esc(money((Number(it.qty) || 0) * (Number(it.rate) || 0), '' ))}</b></div>
  </div>`;
}

function recurringBlock(d) {
  if (d.type !== 'invoice') return '';
  const r = d.recurring || { enabled: false, interval: 'monthly', next_date: addDays(d.issue_date, 30), end_date: '', auto_send: true };
  return `<section class="section"><h2 class="section-title"><span class="idx">06</span>Repeat</h2>
    <label class="check"><input type="checkbox" data-r="enabled" ${r.enabled ? 'checked' : ''}>
      <span>Make this a recurring invoice<br><small class="muted">A fresh copy is created on schedule. Great for retainers.</small></span></label>
    <div class="grid-3" data-r-opts style="margin-top:14px" ${r.enabled ? '' : 'hidden'}>
      <label class="field"><span>Every</span><select class="select" data-r="interval">
        ${['weekly', 'monthly', 'quarterly', 'yearly'].map((x) => `<option value="${x}" ${r.interval === x ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}
      </select></label>
      <label class="field"><span>Next invoice on</span><input class="input" type="date" data-r="next_date" value="${esc(r.next_date || '')}"></label>
      <label class="field"><span>Stop after</span><input class="input" type="date" data-r="end_date" value="${esc(r.end_date || '')}"></label>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" data-r="auto_send" ${r.auto_send ? 'checked' : ''}><span>Email it to the client automatically</span></label>
    </div></section>`;
}

function form(d, nextNumber) {
  const t = DOC_TYPES[d.type];
  const c = d.client || {};
  return `
  <section class="section"><h2 class="section-title"><span class="idx">01</span>${hasManyBusinesses() ? 'From and format' : 'Format'}</h2>
    ${businessPicker(d)}
    <div class="formats" role="radiogroup" aria-label="Paper format">${formatPicker(d)}</div></section>

  <section class="section"><h2 class="section-title"><span class="idx">02</span>${esc(t.party)}</h2>
    <div class="stack" style="gap:12px">
      <label class="field"><span>Client name</span><div class="combo">
        <input class="input" data-c="name" value="${esc(c.name || '')}" placeholder="Start typing, saved clients show up" autocomplete="off"></div></label>
      <div class="grid-2">${CLIENT_FIELDS.map(([k, l, type]) => `<label class="field"><span>${l}</span>
        <input class="input" type="${type}" data-c="${k}" value="${esc(c[k] || '')}"></label>`).join('')}</div>
      <label class="field"><span>Address</span><textarea class="textarea" rows="2" data-c="address">${esc(c.address || '')}</textarea></label>
    </div></section>

  <section class="section"><h2 class="section-title"><span class="idx">03</span>Details</h2>
    <div class="stack" style="gap:12px">
      <div class="grid-3">
        <label class="field"><span>Number</span><input class="input mono" data-d="number" value="${esc(d.number)}" placeholder="${esc(nextNumber || 'Auto')}"></label>
        <label class="field"><span>Date</span><input class="input" type="date" data-d="issue_date" value="${esc(d.issue_date)}"></label>
        ${t.dateLabel ? `<label class="field"><span>${esc(t.dateLabel)}</span><input class="input" type="date" data-d="due_date" value="${esc(d.due_date || '')}"></label>`
          : `<label class="field"><span>Currency</span><input class="input mono" data-d="currency" maxlength="3" value="${esc(d.currency)}"></label>`}
      </div>
      ${t.dateLabel && t.payable ? `<div class="chips">${DUE_PRESETS.map(([n, l]) => `<button type="button" class="chip" data-due="${n}">${l}</button>`).join('')}</div>` : ''}
      <div class="grid-2">
        <label class="field"><span>Subject</span><input class="input" data-d="subject" value="${esc(d.subject)}" placeholder="Website redesign, March retainer"></label>
        <label class="field"><span>Reference / PO</span><input class="input" data-d="reference" value="${esc(d.reference)}"></label>
      </div>
      ${t.dateLabel ? `<label class="field" style="max-width:140px"><span>Currency</span><input class="input mono" data-d="currency" maxlength="3" value="${esc(d.currency)}"></label>` : ''}
    </div></section>

  <section class="section"><h2 class="section-title"><span class="idx">04</span>Items</h2>
    <div class="line-labels label"><span class="idx"></span><span>Item</span><span>Qty</span><span>Rate</span><span class="tax-l">${esc(settingsFor(d.business_id).documents.taxLabel)} %</span><span></span></div>
    <div class="lines" data-lines></div>
    <button class="btn btn--ghost" type="button" data-add style="margin-top:10px">${icons.plus}<span>Add line</span></button>
    <div class="grid-3" style="margin-top:16px">
      <label class="field"><span>Discount</span><div class="row" style="gap:6px">
        <input class="input" data-d="discount_value" inputmode="decimal" value="${esc(d.discount_value || '')}" placeholder="0">
        <select class="select" data-d="discount_type" style="width:80px"><option value="amount" ${d.discount_type === 'amount' ? 'selected' : ''}>Amt</option>
          <option value="percent" ${d.discount_type === 'percent' ? 'selected' : ''}>%</option></select></div></label>
      <label class="field"><span>Shipping / extra</span><input class="input" data-d="shipping" inputmode="decimal" value="${esc(d.shipping || '')}" placeholder="0"></label>
    </div>
    <div class="totals-mini" data-totals></div></section>

  <section class="section"><h2 class="section-title"><span class="idx">05</span>Notes &amp; terms</h2>
    <div class="stack" style="gap:12px">
      <label class="field"><span>Notes</span><textarea class="textarea" rows="3" data-d="notes">${esc(d.notes)}</textarea></label>
      <label class="field"><span>Terms</span><textarea class="textarea" rows="3" data-d="terms">${esc(d.terms)}</textarea></label>
    </div></section>
  ${recurringBlock(d)}`;
}

/* ---------- view ---------- */
export async function mount(el, { params, query }) {
  let id = params.id || null;
  let doc;
  let token = null;
  if (id) {
    doc = await get(`/documents/${id}`);
    if (doc.status === 'void') {
      toast('Void documents cannot be edited', 'err');
      location.hash = `#/doc/${id}`;
      return {};
    }
    token = doc.token;
  } else {
    let client = null;
    if (query.client) client = await get(`/clients/${Number(query.client)}`).catch(() => null);
    doc = newDocument(params.type, client && {
      id: client.id, name: client.name, company: client.company, email: client.email,
      phone: client.phone, address: client.address, tax_id: client.tax_id,
    });
  }
  let settings = settingsFor(doc.business_id);
  const fetchNext = () => get(`/documents/next-number?type=${doc.type}&business=${doc.business_id || ''}`).then((r) => r.number);
  let nextNumber = id ? '' : await fetchNext();
  const t = DOC_TYPES[doc.type];

  el.innerHTML = `
    <div class="page-head">
      <div><a class="label" href="${id ? `#/doc/${id}` : '#/documents'}" style="text-decoration:none">${icons.back.replace('<svg', '<svg width="12" height="12" style="vertical-align:-2px"')} ${id ? esc(doc.number) : 'Documents'}</a>
        <h1 class="page-title">${id ? 'Edit' : 'New'} ${esc(t.label.toLowerCase())}</h1></div>
      <div class="page-actions">
        <span class="save-state" data-save><span class="led"></span><span>${id ? 'Saved' : 'Not saved yet'}</span></span>
        <button class="btn btn--primary" type="button" data-done>${icons.check}<span>Done</span></button>
      </div>
    </div>
    <div class="editor">
      <form class="card" data-form novalidate>${form(doc, nextNumber)}</form>
      <aside class="editor-preview" aria-label="Live preview">
        <div class="preview-frame">
          <div class="preview-bar"><span class="label">Live preview</span><span class="label" data-fmt>${esc(FORMATS[doc.format].label)}</span></div>
          <div class="sheet-fit" data-sheet></div>
        </div>
      </aside>
    </div>`;

  const formEl = $('[data-form]', el);
  const sheet = $('[data-sheet]', el);
  const saveState = $('[data-save]', el);
  let dirty = false;
  let saving = null;
  let queued = false;
  let stopFit = () => {};

  /* preview */
  let raf = 0;
  const paintPreview = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const preview = { ...doc, number: doc.number || nextNumber || doc.number, items: doc.items };
      const qrSrc = id && settings.payment.upiId && doc.currency === 'INR' && t.payable ? `/api/documents/${id}/upi.svg?v=${Date.now() >> 12}` : '';
      sheet.innerHTML = renderDocument(preview, settings, { qrSrc });
      stopFit();
      stopFit = fitSheet(sheet);
      $('[data-fmt]', el).textContent = FORMATS[doc.format].label;
    });
  };

  const paintTotals = () => {
    const tot = computeTotals(doc);
    $('[data-totals]', el).innerHTML = `
      <div class="row-between"><span class="muted">Subtotal</span><span class="mono">${esc(money(tot.subtotal, doc.currency))}</span></div>
      ${tot.discount ? `<div class="row-between"><span class="muted">Discount</span><span class="mono">-${esc(money(tot.discount, doc.currency))}</span></div>` : ''}
      ${tot.taxGroups.map((g) => `<div class="row-between"><span class="muted">${esc(settings.documents.taxLabel)} ${g.rate}%</span><span class="mono">${esc(money(g.tax, doc.currency))}</span></div>`).join('')}
      ${tot.shipping ? `<div class="row-between"><span class="muted">Shipping</span><span class="mono">${esc(money(tot.shipping, doc.currency))}</span></div>` : ''}
      <div class="row-between" style="margin-top:6px"><span class="label">Total</span><span class="grand">${esc(money(tot.total, doc.currency))}</span></div>`;
    $$('[data-line]', el).forEach((row, i) => {
      const it = doc.items[i];
      if (it) $('[data-amount]', row).textContent = money((Number(it.qty) || 0) * (Number(it.rate) || 0), doc.currency);
    });
  };

  const items = cachedLoader(() => get('/items'));
  const clients = cachedLoader(() => get('/clients'));

  const paintLines = () => {
    $('[data-lines]', el).innerHTML = doc.items.map((it, i) => lineRow(it, i, t.hidePrices)).join('');
    $$('[data-line]', el).forEach((row) => {
      const i = Number(row.dataset.line);
      attachCombo($('[data-f=name]', row), {
        search: async (q) => (await items()).filter((it) => it.name.toLowerCase().includes(q.toLowerCase())),
        label: (it) => it.name,
        hint: (it) => money(it.rate, doc.currency),
        onPick: (it) => {
          doc.items[i] = { ...doc.items[i], name: it.name, description: it.description, rate: it.rate, unit: it.unit, tax_rate: it.tax_rate };
          paintLines();
          changed();
          $(`[data-line="${i}"] [data-f=qty]`, el)?.focus();
        },
      });
    });
    paintTotals();
  };

  /* saving */
  const setSave = (state, text) => {
    saveState.className = `save-state ${state}`;
    saveState.lastElementChild.textContent = text;
  };

  const save = async () => {
    if (saving) { queued = true; return saving; }
    if (!hasContent(doc)) { setSave('dirty', 'Add a client or an item'); return null; }
    setSave('dirty', 'Saving');
    dirty = false;
    saving = (async () => {
      try {
        const res = id ? await put(`/documents/${id}`, payload(doc)) : await post('/documents', payload(doc));
        if (!id) {
          id = res.id;
          history.replaceState(null, '', `#/doc/${id}/edit`);
        }
        token = res.token;
        if (!doc.number) {
          doc.number = res.number;
          const input = $('[data-d=number]', el);
          if (document.activeElement !== input) input.value = res.number;
        }
        doc.client = { ...doc.client, id: res.client?.id };
        doc.status = res.status;
        doc.amount_paid = res.amount_paid;
        setSave(dirty ? 'dirty' : '', dirty ? 'Editing' : 'Saved');
      } catch (err) {
        dirty = true;
        setSave('err', err.message);
      } finally {
        saving = null;
      }
    })();
    await saving;
    if (queued) { queued = false; return save(); }
    return null;
  };
  const autosave = debounce(save, AUTOSAVE_MS);

  function changed() {
    dirty = true;
    setSave('dirty', 'Editing');
    paintTotals();
    paintPreview();
    autosave();
  }

  /* inputs */
  formEl.addEventListener('input', (e) => {
    const target = e.target;
    const { d, c, f, r } = target.dataset;
    if (d === 'business_id') {
      doc.business_id = Number(target.value);
      settings = settingsFor(doc.business_id);
      $('.tax-l', el).textContent = `${settings.documents.taxLabel} %`;
      if (!id) {
        fetchNext().then((n) => {
          nextNumber = n;
          $('[data-d=number]', el).placeholder = n;
          paintPreview();
        }).catch(() => {});
      }
    } else if (d) {
      doc[d] = d === 'currency' ? target.value.toUpperCase() : target.value;
    } else if (c) {
      doc.client = { ...doc.client, [c]: target.value };
      if (c === 'name') delete doc.client.id;
    } else if (f) {
      const i = Number(target.closest('[data-line]').dataset.line);
      doc.items[i] = { ...doc.items[i], [f]: target.value };
    } else if (r) {
      const base = doc.recurring || { enabled: false, interval: 'monthly', next_date: addDays(doc.issue_date, 30), end_date: '', auto_send: true };
      doc.recurring = { ...base, [r]: target.type === 'checkbox' ? target.checked : target.value };
      $('[data-r-opts]', el).hidden = !doc.recurring.enabled;
      if (!doc.recurring.enabled) doc.recurring = null;
    } else if (target.name === 'format') {
      doc.format = target.value;
    } else return;
    changed();
  });
  formEl.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    const rm = e.target.closest('[data-rm]');
    const due = e.target.closest('[data-due]');
    if (add) {
      doc.items = [...doc.items, blankLine()];
      paintLines();
      $(`[data-line="${doc.items.length - 1}"] [data-f=name]`, el).focus();
      changed();
    } else if (rm) {
      const i = Number(rm.dataset.rm);
      doc.items = doc.items.filter((_, k) => k !== i);
      if (!doc.items.length) doc.items = [blankLine()];
      paintLines();
      changed();
    } else if (due) {
      doc.due_date = addDays(doc.issue_date, Number(due.dataset.due));
      $('[data-d=due_date]', el).value = doc.due_date;
      changed();
    }
  });
  // Enter in the last line's rate or tax adds a new line, like a spreadsheet.
  formEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    const row = e.target.closest('[data-line]');
    if (row && Number(row.dataset.line) === doc.items.length - 1 && e.target.dataset.f !== 'name') $('[data-add]', el).click();
  });

  attachCombo($('[data-c=name]', el), {
    search: async (q) => (await clients()).filter((c) => `${c.name} ${c.company} ${c.email}`.toLowerCase().includes(q.toLowerCase())),
    label: (c) => c.name,
    hint: (c) => c.company || c.email || '',
    onPick: (c) => {
      doc.client = { id: c.id, name: c.name, company: c.company, email: c.email, phone: c.phone, address: c.address, tax_id: c.tax_id };
      for (const input of $$('[data-c]', el)) input.value = doc.client[input.dataset.c] || '';
      changed();
    },
  });

  $('[data-done]', el).addEventListener('click', async () => {
    autosave.cancel();
    if (dirty || !id) await save();
    if (id && !dirty) location.hash = `#/doc/${id}`;
  });

  paintLines();
  paintPreview();
  if (!id) $('[data-c=name]', el).focus();

  return {
    isDirty: () => dirty,
    async beforeLeave() {
      autosave.cancel();
      if (dirty && hasContent(doc)) await save();
      return true;
    },
    destroy() {
      autosave.cancel();
      stopFit();
      cancelAnimationFrame(raf);
    },
    refresh(evt) {
      // Keep local edits; only pick up payment status changes from elsewhere.
      if (evt.type === 'document' && evt.id === id && !dirty && !saving) {
        get(`/documents/${id}`).then((fresh) => { doc.status = fresh.status; doc.amount_paid = fresh.amount_paid; paintPreview(); }).catch(() => {});
      }
    },
    get token() { return token; },
  };
}
