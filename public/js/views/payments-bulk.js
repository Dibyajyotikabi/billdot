// Bulk payment proofs: drop many screenshots, read each one in turn,
// review the details, then create one separate proof per screenshot.
import { api, get, post } from '../api.js';
import { icons } from '../icons.js';
import { $, esc, money, store, toast, toastError, settingsFor, hasManyBusinesses } from '../ui.js';
import { PAYMENT_METHODS } from '../shared/doc-types.js';
import { localToday } from '../shared/format.js';
import { proofVisibility } from '../shared/proof-details.js';
import { readScreenshot } from '../screenshot.js';
import { styleControls } from './payments.js';

const MAX_FILES = 30;
const BUSY_RETRIES = 5;
const BUSY_WAIT_MS = 2000;
const READ_TIMEOUT_MS = 40_000;
const FIELDS = ['amount', 'paid_on', 'payer', 'receiver', 'method', 'reference'];
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function rowMarkup(row, index) {
  const done = row.status === 'created';
  const lock = done || row.status === 'saving' ? 'disabled' : '';
  return `<article class="bulk-row ${row.include && !done ? '' : 'is-off'}" data-row="${row.id}">
    <figure class="bulk-shot">${row.image ? `<img src="${row.image}" alt="Screenshot ${index + 1}">` : icons.image}</figure>
    <div class="bulk-fields">
      <div class="row-between">
        <label class="check"><input type="checkbox" data-field="include" ${row.include ? 'checked' : ''} ${lock}><span><b>Proof ${index + 1}</b> <small class="muted">${esc(row.name)}</small></span></label>
        ${done ? `<a class="btn btn--sm" href="#/payments/${row.created}">Open</a>` : `<button class="btn btn--sm btn--icon" type="button" data-remove aria-label="Remove screenshot ${index + 1}" ${lock}>${icons.x}</button>`}
      </div>
      <div class="grid-3">
        <label class="field"><span>Amount</span><input class="input mono" data-field="amount" inputmode="decimal" value="${esc(row.amount || '')}" placeholder="0" ${lock}></label>
        <label class="field"><span>Paid on</span><input class="input" type="date" data-field="paid_on" value="${esc(row.paid_on)}" ${lock}></label>
        <label class="field"><span>Method</span><select class="select" data-field="method" ${lock}>${PAYMENT_METHODS.map((m) => `<option ${m === row.method ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      </div>
      <div class="grid-3">
        <label class="field"><span>Sender</span><input class="input" data-field="payer" maxlength="160" value="${esc(row.payer)}" placeholder="Your business" ${lock}></label>
        <label class="field"><span>Receiver</span><input class="input" data-field="receiver" maxlength="160" value="${esc(row.receiver)}" placeholder="Person or business paid" ${lock}></label>
        <label class="field"><span>UTR / reference</span><input class="input mono" data-field="reference" maxlength="120" value="${esc(row.reference)}" ${lock}></label>
      </div>
      <p class="bulk-status bulk-status--${row.status}" role="status">${esc(row.message)}</p>
    </div>
  </article>`;
}

export async function mountBulk(el) {
  const existing = await get('/confirmations');
  const knownRefs = new Set(existing.map((c) => c.reference).filter(Boolean));
  const settings = {
    business_id: store.settings.defaultBusinessId, direction: 'sent',
    icon_style: store.settings.appearance?.proofIcon || 'arrow', show_image: false,
  };
  const rows = [];
  let nextId = 1;
  let reading = false;
  let saving = false;
  let destroyed = false;

  const bizSelect = hasManyBusinesses() ? `<label class="field"><span>Business</span><select class="select" name="business_id">
    ${store.settings.businesses.map((b) => `<option value="${b.id}" ${b.id === settings.business_id ? 'selected' : ''}>${esc(b.code)}  ${esc(b.business.name || b.name)}</option>`).join('')}
  </select></label>` : '';
  el.innerHTML = `<div class="page-head">
      <div><a class="label" href="#/payments" style="text-decoration:none">Payment proofs</a><h1 class="page-title">Bulk upload</h1></div>
      <div class="page-actions"><a class="btn btn--ghost" href="#/payments/new">${icons.plus}<span>Single proof</span></a></div>
    </div>
    <form class="card bulk" data-form novalidate>
      <section class="section"><h2 class="section-title"><span class="idx">01</span>Screenshots</h2>
        <label class="shot-drop" data-drop tabindex="0" role="button" aria-label="Upload payment screenshots">
          <input type="file" accept="image/*" name="shots" multiple hidden>
          <span>${icons.image}<span><b>Add payment screenshots</b><br><small class="muted">Drop, paste, or pick up to ${MAX_FILES} images. Each one becomes its own payment proof.</small></span></span>
        </label>
        <p class="shot-status" data-status role="status" aria-live="polite">Screenshots are read one at a time. Check every amount before creating the proofs.</p>
      </section>
      <section class="section"><h2 class="section-title"><span class="idx">02</span>For every proof</h2>
        <div class="stack" style="gap:12px">
          ${styleControls(settings)}
          ${bizSelect}
          <label class="check"><input type="checkbox" name="show_image"><span>Include each screenshot as payment proof<br><small class="muted">Adds it to the shared page and saved image. Check for private account details first.</small></span></label>
        </div>
      </section>
      <section class="section"><h2 class="section-title"><span class="idx">03</span>Review</h2>
        <div class="bulk-list" data-list><p class="muted" style="margin:0;font-size:13px">No screenshots yet.</p></div>
      </section>
      <section class="section"><button class="btn btn--primary btn--block" type="submit" disabled>${icons.check}<span data-submit-label>Create payment proofs</span></button></section>
    </form>`;

  const form = $('[data-form]', el);
  const list = $('[data-list]', el);
  const status = $('[data-status]', el);
  const submit = $('[type=submit]', form);
  const find = (id) => rows.find((r) => r.id === Number(id));
  const ready = () => rows.filter((r) => r.include && r.status !== 'created' && Number(r.amount) > 0);

  const summary = () => {
    const count = ready().length;
    const total = ready().reduce((sum, r) => sum + Number(r.amount), 0);
    const currency = settingsFor(settings.business_id).documents.currency;
    $('[data-submit-label]', form).textContent = count
      ? `Create ${count} payment proof${count === 1 ? '' : 's'} · ${money(total, currency)}` : 'Create payment proofs';
    submit.disabled = reading || saving || !count;
  };
  const renderList = () => {
    list.innerHTML = rows.length ? rows.map(rowMarkup).join('') : '<p class="muted" style="margin:0;font-size:13px">No screenshots yet.</p>';
    summary();
  };
  const renderRow = (row) => {
    const node = $(`[data-row="${row.id}"]`, list);
    if (node) node.outerHTML = rowMarkup(row, rows.indexOf(row));
    summary();
  };

  const duplicateOf = (row) => {
    if (!row.reference) return '';
    if (knownRefs.has(row.reference)) return 'A proof with this UTR already exists, so it is unticked.';
    if (rows.some((r) => r !== row && r.reference === row.reference && rows.indexOf(r) < rows.indexOf(row))) {
      return 'Same UTR as an earlier screenshot, so it is unticked.';
    }
    return '';
  };

  const extract = async (row) => {
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
      try {
        return await api('/confirmations/extract', {
          method: 'POST', body: { image: row.image, enhanced: row.enhanced }, signal: controller.signal,
        });
      } catch (err) {
        // Another screenshot (maybe from another tab) is being read. Wait and try again.
        if (err.status !== 429 || attempt >= BUSY_RETRIES) throw err;
        await wait(BUSY_WAIT_MS);
      } finally { clearTimeout(timer); }
    }
  };

  const readRow = async (row) => {
    row.status = 'reading';
    row.message = 'Reading payment details…';
    renderRow(row);
    try {
      const { image, enhanced } = await readScreenshot(row.file);
      Object.assign(row, { image, enhanced });
      renderRow(row);
      const { fields = {} } = await extract(row);
      for (const name of FIELDS) {
        if (fields[name] !== undefined && !row.edited.has(name)) row[name] = fields[name];
      }
      const missing = ['amount', 'reference'].filter((name) => !row[name]);
      const duplicate = duplicateOf(row);
      if (duplicate) row.include = false;
      row.status = missing.includes('amount') || duplicate ? 'warn' : 'ready';
      row.message = duplicate || (missing.length ? `Could not find the ${missing.map((m) => (m === 'amount' ? 'amount' : 'UTR')).join(' or ')}. Fill it in below.` : 'Details filled. Check them before creating.');
    } catch (err) {
      row.status = 'warn';
      row.message = `${err.message || 'Could not read this screenshot.'} Fill in the details yourself.`;
    }
    if (!destroyed && rows.includes(row)) renderRow(row);
  };

  const readQueue = async () => {
    if (reading) return;
    reading = true;
    summary();
    for (let row = rows.find((r) => r.status === 'queued'); row && !destroyed; row = rows.find((r) => r.status === 'queued')) {
      status.setAttribute('aria-busy', 'true');
      status.textContent = `Reading screenshot ${rows.indexOf(row) + 1} of ${rows.length}…`;
      await readRow(row);
    }
    reading = false;
    if (destroyed) return;
    status.removeAttribute('aria-busy');
    const flagged = rows.filter((r) => r.status === 'warn').length;
    status.textContent = flagged ? `Done reading. ${flagged} screenshot${flagged === 1 ? ' needs' : 's need'} a look.` : 'Done reading. Check the details, then create the proofs.';
    summary();
  };

  const addFiles = (files) => {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    const room = MAX_FILES - rows.filter((r) => r.status !== 'created').length;
    if (!images.length) { toast('Pick image files, like PNG or JPG screenshots', 'err'); return; }
    if (images.length > room) toast(`Only ${Math.max(0, room)} more screenshot${room === 1 ? '' : 's'} fit in one batch`, 'err');
    for (const file of images.slice(0, Math.max(0, room))) {
      rows.push({
        id: nextId++, file, name: file.name || 'Pasted image', image: null, enhanced: null, include: true, edited: new Set(),
        amount: '', paid_on: localToday(), payer: '', receiver: '', method: 'UPI', reference: '',
        status: 'queued', message: 'Waiting to be read…', created: null,
      });
    }
    renderList();
    readQueue();
  };

  form.addEventListener('input', (e) => {
    const { name, value, checked } = e.target;
    if (name === 'shots') { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; return; }
    if (name === 'direction' || name === 'icon_style') settings[name] = value;
    else if (name === 'business_id') { settings.business_id = Number(value); summary(); }
    else if (name === 'show_image') settings.show_image = checked;
    const field = e.target.dataset.field;
    const row = field && find(e.target.closest('[data-row]').dataset.row);
    if (!row) return;
    if (field === 'include') {
      row.include = checked;
      e.target.closest('.bulk-row').classList.toggle('is-off', !checked);
    } else {
      row[field] = field === 'amount' ? value.replace(/,/g, '') : value;
      row.edited.add(field);
    }
    summary();
  });
  form.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove]');
    if (!remove) return;
    e.preventDefault();
    const row = find(remove.closest('[data-row]').dataset.row);
    if (!row || row.status === 'reading') { toast('Wait for this screenshot to finish reading', 'err'); return; }
    rows.splice(rows.indexOf(row), 1);
    renderList();
  });

  const drop = $('[data-drop]', el);
  drop.addEventListener('keydown', (e) => {
    if (e.target === drop && ['Enter', ' '].includes(e.key)) { e.preventDefault(); form.shots.click(); }
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addFiles(files); }
  };
  document.addEventListener('paste', onPaste);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (reading) { toast('Wait for the screenshots to finish reading', 'err'); return; }
    const batch = ready();
    if (!batch.length) return;
    saving = true;
    summary();
    let made = 0;
    for (const row of batch) {
      if (destroyed) return;
      row.status = 'saving';
      row.message = 'Creating proof…';
      renderRow(row);
      try {
        const proof = await post('/confirmations', {
          business_id: settings.business_id, direction: settings.direction, icon_style: settings.icon_style,
          amount: Number(row.amount), payer: row.payer, receiver: row.receiver, method: row.method,
          reference: row.reference, paid_on: row.paid_on, image: row.image, show_image: settings.show_image,
          visibility: proofVisibility(),
        });
        Object.assign(row, { status: 'created', created: proof.id, message: 'Proof created.' });
        if (row.reference) knownRefs.add(row.reference);
        made += 1;
      } catch (err) {
        Object.assign(row, { status: 'warn', message: err.message || 'Could not create this proof.' });
      }
      renderRow(row);
    }
    saving = false;
    summary();
    const failed = batch.length - made;
    toast(failed ? `Created ${made} proof${made === 1 ? '' : 's'}. ${failed} need${failed === 1 ? 's' : ''} a fix.` : `Created ${made} payment proof${made === 1 ? '' : 's'}`, failed ? 'err' : 'ok');
    if (!failed) location.hash = '#/payments';
  });

  return {
    beforeLeave: async () => {
      if (saving) toast('Wait for the proofs to finish saving', 'err');
      return !saving;
    },
    destroy: () => { destroyed = true; document.removeEventListener('paste', onPaste); },
  };
}
