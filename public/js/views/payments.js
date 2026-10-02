// Payment proofs: turn a UPI screenshot or typed details into a shareable
// payment page and image, optionally recording an incoming payment on an invoice.
import { api, get, post, put, del } from '../api.js';
import { icons } from '../icons.js';
import {
  $, $$, esc, money, date, store, toast, toastError, confirmDialog, copyText, emptyState,
  settingsFor, businessOf, hasManyBusinesses,
} from '../ui.js';
import { DOC_TYPES, PAYMENT_METHODS } from '../shared/doc-types.js';
import { localToday } from '../shared/format.js';
import { proofCardHtml } from '../shared/proof-html.js';
import { downloadProofCard } from '../shared/proof-card.js';
import { readScreenshot } from '../screenshot.js';
import { PROOF_FIELDS, PROOF_ICONS, proofVisibility, visibleProof, proofDirection, proofLabel, proofParties } from '../shared/proof-details.js';

const cardFor = (c) => {
  const s = settingsFor(c.business_id);
  return { confirmation: { ...c, image_src: c.show_image && c.has_image ? `/api/confirmations/${c.id}/image` : null,
    document: c.document_number ? { number: c.document_number } : c.document }, business: s.business,
    locale: s.documents.locale, font: s.appearance?.font, style: s.appearance?.style };
};

export function styleControls(c, existing = false) {
  const act = existing ? 'data-act="proof-style"' : '';
  return `<div class="grid-2">
    <label class="field"><span>Payment direction</span><select class="select" name="direction" ${act} ${existing && c.payment_id ? 'disabled' : ''}>
      <option value="sent" ${proofDirection(c) === 'sent' ? 'selected' : ''}>Payment sent · To</option>
      <option value="received" ${proofDirection(c) === 'received' ? 'selected' : ''}>Payment received · From</option>
    </select></label>
    <label class="field"><span>Proof icon</span><select class="select" name="icon_style" ${act}>
      ${Object.entries(PROOF_ICONS).map(([key, label]) => `<option value="${key}" ${c.icon_style === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}
    </select></label>
  </div>`;
}

function visibilityControls(visibility, existing = false) {
  const v = proofVisibility(visibility);
  return `<div class="proof-controls">${Object.entries(PROOF_FIELDS).map(([key, label]) =>
    `<label class="check"><input type="checkbox" ${existing ? 'data-act="visibility"' : ''} data-proof-field="${key}" ${v[key] ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>`;
}

/* ---------- list ---------- */
function listMarkup(list) {
  if (!list.length) {
    return `<div class="card">${emptyState('No proofs yet',
      'Upload a payment screenshot or type the details to create a shareable payment page and image.',
      `<a class="btn btn--primary" href="#/payments/new">${icons.plus}<span>New payment proof</span></a> <a class="btn" href="#/payments/bulk">${icons.image}<span>Bulk upload</span></a>`)}</div>`;
  }
  return `<div class="proof-grid">${list.map((c) => `<a class="proof-tile" href="#/payments/${c.id}">
    <span class="row-between"><span class="label">${esc(date(c.paid_on))}</span>${c.has_image ? `<span class="muted" title="Has screenshot">${icons.image}</span>` : ''}</span>
    <span class="proof-tile-amt">${esc(money(c.amount, c.currency))}</span>
    <span class="t">${esc(c.payer || 'Unknown sender')}</span>
    <span class="s">to ${esc(c.receiver || 'unknown receiver')} · ${esc(proofLabel(c))}</span>
    <span class="s">${esc(c.method)}${c.reference ? ` · ${esc(c.reference)}` : ''}</span>
    <span class="s">${c.document_number ? `<span class="mono">${esc(c.document_number)}</span>` : 'Not linked to a bill'}${hasManyBusinesses() && businessOf(c.business_id) ? ` · ${esc(businessOf(c.business_id).code)}` : ''}</span>
  </a>`).join('')}</div>`;
}

async function mountList(el) {
  el.innerHTML = `<div class="page-head">
      <div><div class="label">Shareable</div><h1 class="page-title">Payment proofs</h1></div>
      <div class="page-actions"><a class="btn" href="#/payments/bulk">${icons.image}<span>Bulk upload</span></a><a class="btn btn--primary" href="#/payments/new">${icons.plus}<span>New proof</span></a></div>
    </div><div data-list><div class="skeleton" style="height:180px"></div></div>`;
  const load = async () => { $('[data-list]', el).innerHTML = listMarkup(await get('/confirmations')); };
  await load();
  return { refresh: (evt) => { if (['confirmation', 'resume'].includes(evt.type)) load().catch(() => {}); } };
}

/* ---------- new ---------- */
function newForm(state, bills) {
  const bizSelect = hasManyBusinesses() ? `<label class="field"><span>Business</span><select class="select" name="business_id">
    ${store.settings.businesses.map((b) => `<option value="${b.id}" ${b.id === state.business_id ? 'selected' : ''}>${esc(b.code)}  ${esc(b.business.name || b.name)}</option>`).join('')}
  </select></label>` : '';
  return `
  <section class="section"><h2 class="section-title"><span class="idx">01</span>Screenshot</h2>
    <label class="shot-drop" data-drop tabindex="0" role="button" aria-label="Upload payment screenshot">
      <input type="file" accept="image/*" name="shot" hidden>
      <span data-shot-view>${icons.image}<span><b>Add the payment screenshot</b><br><small class="muted">Drop, paste, or pick an image. We’ll read the payment details for you.</small></span></span>
    </label>
    <p class="shot-status" data-shot-status role="status" aria-live="polite">Details are read on this computer. Check them before creating the proof.</p>
    <button class="btn btn--sm" type="button" data-shot-retry hidden>Read screenshot again</button>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="show_image" disabled><span>Include screenshot as payment proof<br><small class="muted">Adds it to the shared page and saved image. Check for private account details first.</small></span></label>
  </section>
  <section class="section"><h2 class="section-title"><span class="idx">02</span>Payment</h2>
    <div class="stack" style="gap:12px">
      ${styleControls(state)}
      <label class="field"><span>For bill</span><select class="select" name="document_id">
        <option value="">Not linked to a bill</option>
        ${bills.map((d) => `<option value="${d.id}" ${d.id === state.document_id ? 'selected' : ''}>${esc(d.number)} · ${esc(d.client?.name || '-')}${d.balance > 0 ? ` · ${esc(money(d.balance, d.currency))} due` : ' · paid'}</option>`).join('')}
      </select></label>
      ${bizSelect}
      <div class="grid-2">
        <label class="field"><span>Amount</span><input class="input mono" name="amount" inputmode="decimal" required value="${esc(state.amount || '')}" placeholder="0"></label>
        <label class="field"><span>Paid on</span><input class="input" type="date" name="paid_on" value="${esc(state.paid_on)}"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Sender name</span><input class="input" name="payer" maxlength="160" value="${esc(state.payer || '')}" placeholder="Person who paid"></label>
        <label class="field"><span>Receiver name</span><input class="input" name="receiver" maxlength="160" value="${esc(state.receiver || '')}" placeholder="Person or business paid"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Method</span><select class="select" name="method">${PAYMENT_METHODS.map((m) => `<option ${m === state.method ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label class="field"><span>UTR / reference</span><input class="input mono" name="reference" maxlength="120" placeholder="12 digit UTR"></label>
      </div>
      <label class="field"><span>Note</span><input class="input" name="note" maxlength="500" placeholder="Advance for the March shoot"></label>
      <label class="check" data-record ${state.document_id && state.direction === 'received' ? '' : 'hidden'}><input type="checkbox" name="record_payment" ${state.record ? 'checked' : ''} ${state.direction === 'sent' ? 'disabled' : ''}>
        <span>Record this incoming payment on the bill<br><small class="muted">Adds it to the bill's payments, so the balance goes down.</small></span></label>
    </div>
  </section>
  <section class="section"><h2 class="section-title"><span class="idx">03</span>Details to show</h2>
    <p class="muted" style="font-size:13px">Choose what appears on the proof, shared page and saved image. The original screenshot keeps all of its details.</p>
    ${visibilityControls(state.visibility)}
  </section>
  <section class="section"><button class="btn btn--primary btn--block" type="submit">${icons.check}<span>Create payment page</span></button></section>`;
}

async function mountNew(el, query) {
  const all = await get('/documents');
  const bills = all.filter((d) => DOC_TYPES[d.type]?.payable && d.status !== 'void')
    .sort((a, b) => (b.balance > 0) - (a.balance > 0) || b.id - a.id);
  const linked = bills.find((d) => d.id === Number(query.doc));
  const state = {
    document_id: linked?.id || null, business_id: linked?.business_id || store.settings.defaultBusinessId,
    amount: linked?.balance || '', receiver: linked?.client?.name || '', currency: linked?.currency || store.settings.documents.currency,
    payer: settingsFor(linked?.business_id || store.settings.defaultBusinessId).business.name || '', visibility: proofVisibility(),
    direction: 'sent', icon_style: store.settings.appearance?.proofIcon || 'arrow',
    method: 'UPI', reference: '', paid_on: localToday(), note: '', image: null, enhanced: null, show_image: false,
    record: false,
  };

  el.innerHTML = `<div class="page-head">
      <div><a class="label" href="#/payments" style="text-decoration:none">Payment proofs</a><h1 class="page-title">New payment proof</h1></div>
    </div>
    <div class="editor">
      <form class="card" data-form novalidate>${newForm(state, bills)}</form>
      <aside class="editor-preview" aria-label="Preview"><div class="proof-preview" data-preview></div></aside>
    </div>`;
  const form = $('[data-form]', el);
  if (form.business_id) form.business_id.disabled = Boolean(state.document_id);
  const preview = () => {
    const c = { ...state, image_src: state.show_image ? state.image : null,
      document: state.document_id ? { number: bills.find((d) => d.id === state.document_id)?.number } : null };
    const s = settingsFor(state.business_id);
    const box = $('[data-preview]', el);
    box.innerHTML = proofCardHtml(c, s.business, s.documents.locale);
    // Animate the first paint only, not every keystroke.
    requestAnimationFrame(() => setTimeout(() => box.classList.add('still'), 1200));
  };

  let shotVersion = 0;
  let reading = false;
  let destroyed = false;
  const automatic = new Map();
  const status = $('[data-shot-status]', el);
  const retry = $('[data-shot-retry]', el);
  const submit = $('[type=submit]', form);
  const edited = new Set();
  const updateDefaults = () => {
    const doc = bills.find((d) => d.id === state.document_id);
    const business = settingsFor(state.business_id).business.name || '';
    const client = doc?.client?.name || '';
    const defaults = state.direction === 'sent' ? { payer: business, receiver: client } : { payer: client, receiver: business };
    for (const [name, value] of Object.entries(defaults)) {
      if (!edited.has(name) && !automatic.has(name)) { state[name] = value; form.elements.namedItem(name).value = value; }
    }
    const canRecord = state.direction === 'received' && Boolean(doc);
    $('[data-record]', el).hidden = !canRecord;
    form.record_payment.disabled = !canRecord;
    if (!canRecord) { state.record = false; form.record_payment.checked = false; }
  };
  const resetAutomatic = () => {
    for (const [name, { before, after }] of automatic) {
      if (!edited.has(name) && String(state[name]) === String(after)) {
        state[name] = before;
        form.elements.namedItem(name).value = before;
      }
    }
    automatic.clear();
  };
  const readDetails = async (version) => {
    const before = { ...state };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    try {
      const result = await api('/confirmations/extract', { method: 'POST', body: { image: state.image, enhanced: state.enhanced }, signal: controller.signal });
      if (destroyed || version !== shotVersion) return;
      const filled = [];
      const labels = { amount: 'amount', paid_on: 'date', payer: 'sender', receiver: 'receiver', reference: 'UTR', method: 'method' };
      for (const [name, value] of Object.entries(result.fields || {})) {
        if (!(name in labels) || edited.has(name) || state[name] !== before[name]) continue;
        automatic.set(name, { before: automatic.get(name)?.before ?? state[name], after: value });
        state[name] = value;
        form.elements.namedItem(name).value = value;
        filled.push(labels[name]);
      }
      status.textContent = filled.length ? `Filled ${filled.join(', ')}. Review the details before creating the proof.`
        : 'No new details could be filled. Enter the missing details or try a clearer screenshot.';
      preview();
    } catch (err) {
      if (destroyed || version !== shotVersion) return;
      status.textContent = `${err.message || 'Could not read the screenshot.'} Your screenshot is attached; you can fill the details yourself.`;
    } finally {
      clearTimeout(timeout);
      if (!destroyed && version === shotVersion) {
        reading = false;
        submit.disabled = false;
        retry.hidden = false;
        status.removeAttribute('aria-busy');
      }
    }
  };
  const startReading = (version) => {
    reading = true;
    submit.disabled = true;
    retry.hidden = true;
    status.setAttribute('aria-busy', 'true');
    status.textContent = 'Reading payment details… You can keep editing the fields.';
    return readDetails(version);
  };
  const setShot = async (file) => {
    const version = ++shotVersion;
    reading = true;
    submit.disabled = true;
    retry.hidden = true;
    status.textContent = 'Preparing screenshot…';
    try {
      const { image, enhanced } = await readScreenshot(file);
      if (destroyed || version !== shotVersion) return;
      resetAutomatic();
      state.image = image;
      state.enhanced = enhanced;
      form.show_image.disabled = false;
      $('[data-shot-view]', el).innerHTML = `<img src="${state.image}" alt="Payment screenshot"><button class="btn btn--sm" type="button" data-shot-rm>${icons.x}<span>Remove</span></button>`;
      preview();
      await startReading(version);
    } catch (err) {
      if (destroyed || version !== shotVersion) return;
      reading = false;
      submit.disabled = false;
      retry.hidden = !state.image;
      status.textContent = err.message;
      toastError(err);
    }
  };

  form.addEventListener('input', (e) => {
    const { name, value, checked } = e.target;
    if (e.target.dataset.proofField) {
      state.visibility[e.target.dataset.proofField] = checked;
      preview();
      return;
    }
    if (['amount', 'payer', 'receiver', 'paid_on', 'reference', 'method'].includes(name)) edited.add(name);
    if (name === 'document_id') {
      const doc = bills.find((d) => d.id === Number(value));
      state.document_id = doc?.id || null;
      if (doc) {
        Object.assign(state, { amount: doc.balance || doc.total, currency: doc.currency, business_id: doc.business_id });
        form.amount.value = state.amount;
        if (form.business_id) form.business_id.value = state.business_id;
        edited.add('amount');
      }
      if (form.business_id) form.business_id.disabled = Boolean(doc);
    } else if (name === 'business_id') state.business_id = Number(value);
    else if (name === 'amount') state.amount = Number(value) || 0;
    else if (name === 'show_image') state.show_image = checked;
    else if (name in state) state[name] = value;
    else if (name === 'record_payment') state.record = checked;
    else if (name === 'shot' && e.target.files[0]) setShot(e.target.files[0]);
    if (['document_id', 'business_id', 'direction'].includes(name)) updateDefaults();
    preview();
  });
  form.addEventListener('click', (e) => {
    if (e.target.closest('[data-shot-retry]')) {
      if (!reading && state.image) startReading(++shotVersion);
      return;
    }
    if (!e.target.closest('[data-shot-rm]')) return;
    e.preventDefault();
    ++shotVersion;
    resetAutomatic();
    reading = false;
    submit.disabled = false;
    state.image = null;
    state.enhanced = null;
    state.show_image = false;
    form.show_image.checked = false;
    form.show_image.disabled = true;
    form.shot.value = '';
    retry.hidden = true;
    status.removeAttribute('aria-busy');
    status.textContent = 'Screenshot removed. You can still enter the payment details.';
    $('[data-shot-view]', el).innerHTML = `${icons.image}<span><b>Add the payment screenshot</b></span>`;
    preview();
  });
  const drop = $('[data-drop]', el);
  drop.addEventListener('keydown', (e) => {
    if (e.target === drop && ['Enter', ' '].includes(e.key)) { e.preventDefault(); form.shot.click(); }
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) setShot(e.dataTransfer.files[0]);
  });
  const onPaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); setShot(file); }
  };
  document.addEventListener('paste', onPaste);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (reading) { toast('Wait for the screenshot to finish reading', 'err'); return; }
    if (!(Number(state.amount) > 0)) { toast('Enter the amount that was paid', 'err'); form.amount.focus(); return; }
    const btn = $('[type=submit]', form);
    btn.disabled = true;
    try {
      const made = await post('/confirmations', {
        document_id: state.document_id, business_id: state.business_id, amount: state.amount, currency: state.currency,
        payer: state.payer, receiver: state.receiver, visibility: state.visibility, direction: state.direction, icon_style: state.icon_style,
        method: state.method, reference: state.reference, paid_on: state.paid_on, note: state.note,
        image: state.image, show_image: form.show_image.checked, record_payment: Boolean(state.direction === 'received' && state.document_id && form.record_payment.checked),
      });
      toast(made.payment_id ? 'Page ready and payment recorded' : 'Page ready');
      location.hash = `#/payments/${made.id}`;
    } catch (err) {
      toastError(err);
      btn.disabled = false;
    }
  });

  preview();
  return { destroy: () => { destroyed = true; ++shotVersion; document.removeEventListener('paste', onPaste); } };
}

/* ---------- detail ---------- */
function whatsappText(c) {
  c = visibleProof(c);
  const biz = settingsFor(c.business_id).business.name;
  const sent = proofDirection(c) === 'sent';
  const party = sent ? c.receiver : c.payer;
  return `Hi${party ? ` ${party}` : ''}, ${sent ? 'we sent a payment' : 'we received your payment'}${c.amount !== undefined ? ` of ${money(c.amount, c.currency)}` : ''}${c.visibility.document && c.document_number ? ` for ${c.document_number}` : ''}.${sent ? '' : ' Thank you!'}${biz ? `\n${biz}` : ''}\n${c.link}`;
}

function detailMarkup(c) {
  const card = cardFor(c);
  return `<div class="page-head">
      <div><a class="label" href="#/payments" style="text-decoration:none">Payment proofs</a>
        <h1 class="page-title">${esc(money(c.amount, c.currency))} ${esc(proofParties(c)[0][0])} ${esc(proofParties(c)[0][1] || (proofDirection(c) === 'sent' ? 'recipient' : 'sender'))}</h1></div>
      <div class="page-actions"><a class="btn btn--ghost" href="${esc(c.link)}" target="_blank" rel="noopener">${icons.globe}<span>Open page</span></a></div>
    </div>
    <div class="detail">
      <div class="proof-preview">${proofCardHtml(card.confirmation, card.business, card.locale)}</div>
      <aside class="detail-side">
        <section class="card card-pad stack" style="gap:10px">
          <span class="label">Share</span>
          <span class="share-url" style="color:var(--ink)">${esc(c.link)}</span>
          <button class="btn btn--red btn--block" data-act="whatsapp">${icons.whatsapp}<span>Send on WhatsApp</span></button>
          <div class="action-grid">
            <button class="btn" data-act="copy">${icons.link}<span>Copy link</span></button>
            <button class="btn" data-act="image">${icons.download}<span>Save image</span></button>
          </div>
        </section>
        <section class="card card-pad stack" style="gap:12px">
          <dl class="kv">
            ${hasManyBusinesses() && businessOf(c.business_id) ? `<dt>Business</dt><dd>${esc(businessOf(c.business_id).code)}</dd>` : ''}
            <dt>Bill</dt><dd>${c.document_id ? `<a href="#/doc/${c.document_id}">${esc(c.document_number)}</a>` : 'Not linked'}</dd>
            ${c.document_id ? `<dt>On the bill</dt><dd>${c.payment_id ? 'Recorded' : 'Not recorded'}</dd>` : ''}
            <dt>Created</dt><dd>${esc(date(c.created_at.slice(0, 10)))}</dd>
          </dl>
          ${c.has_image ? `<a href="/api/confirmations/${c.id}/image" target="_blank" rel="noopener" class="shot-thumb"><img src="/api/confirmations/${c.id}/image" alt="Payment screenshot" loading="lazy"></a>
            <label class="check"><input type="checkbox" data-act="toggle-image" ${c.show_image ? 'checked' : ''}><span>Show the screenshot on the page</span></label>` : '<p class="muted" style="margin:0;font-size:13px">No screenshot attached.</p>'}
        </section>
        <section class="card card-pad stack" style="gap:12px"><span class="label">Details to show</span>
          ${styleControls(c, true)}
          ${c.payment_id ? '<small class="muted">Direction is fixed because this proof records an incoming bill payment.</small>' : ''}
          ${visibilityControls(c.visibility, true)}
          <small class="muted">These choices also apply to the shared page and saved image. The screenshot keeps its original details.</small>
        </section>
        <button class="btn btn--ghost btn--block" data-act="delete" style="color:var(--red)">${icons.trash}<span>Delete page</span></button>
      </aside>
    </div>`;
}

async function mountDetail(el, id) {
  let c;
  const load = async () => { c = await get(`/confirmations/${id}`); el.innerHTML = detailMarkup(c); };
  const actions = {
    whatsapp: () => window.open(`https://wa.me/?text=${encodeURIComponent(whatsappText(c))}`, '_blank', 'noopener'),
    async copy() { await copyText(c.link); toast('Link copied'); },
    image: () => downloadProofCard(cardFor(c)),
    async 'proof-style'(target) {
      const previous = c[target.name];
      target.disabled = true;
      try {
        c = await put(`/confirmations/${id}`, { [target.name]: target.value });
        el.innerHTML = detailMarkup(c);
      } catch (err) { target.value = previous; throw err; }
      finally { target.disabled = false; }
    },
    async 'toggle-image'(target) {
      target.disabled = true;
      try {
        c = await put(`/confirmations/${id}`, { show_image: target.checked });
        el.innerHTML = detailMarkup(c);
        toast(c.show_image ? 'Screenshot is on the page' : 'Screenshot hidden');
      } catch (err) { target.checked = !target.checked; throw err; }
      finally { target.disabled = false; }
    },
    async visibility(target) {
      target.disabled = true;
      try {
        c = await put(`/confirmations/${id}`, { visibility: { [target.dataset.proofField]: target.checked } });
        el.innerHTML = detailMarkup(c);
      } catch (err) { target.checked = !target.checked; throw err; }
      finally { target.disabled = false; }
    },
    async delete() {
      const extra = c.payment_id ? ' The payment stays recorded on the bill. Remove it there if it was wrong.' : '';
      if (!await confirmDialog('Delete this payment page?', `The link stops working.${extra}`, { submit: 'Delete', danger: true })) return;
      await del(`/confirmations/${id}`);
      toast('Deleted');
      location.hash = '#/payments';
    },
  };
  const run = async (e) => {
    const target = e.target.closest('[data-act]');
    if (!target || (e.type === 'click' && (target.type === 'checkbox' || target.tagName === 'SELECT'))) return;
    if (e.type === 'change' && target.type !== 'checkbox' && target.tagName !== 'SELECT') return;
    try { await actions[target.dataset.act]?.(target); } catch (err) { toastError(err); }
  };
  el.addEventListener('click', run);
  el.addEventListener('change', run);
  await load();
  return {
    refresh: (evt) => {
      if (evt.type === 'resume' || (evt.type === 'confirmation' && evt.id === id && !evt.deleted)) load().catch(() => {});
    },
  };
}

export function mount(el, { params, query }) {
  if (params.id === 'new') return mountNew(el, query);
  if (params.id === 'bulk') return import('./payments-bulk.js').then((m) => m.mountBulk(el));
  if (params.id) return mountDetail(el, params.id);
  return mountList(el);
}
