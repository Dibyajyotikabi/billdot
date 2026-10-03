import { get, post, put, del } from '../api.js';
import { icons } from '../icons.js';
import {
  $, esc, store, debounce, toast, toastError, copyText, modal, confirmDialog, money, date, settingsFor, businessOf, hasManyBusinesses,
} from '../ui.js';
import { DOC_TYPES, FORMATS } from '../shared/doc-types.js';
import { FONT_OPTIONS, STYLE_OPTIONS, fontTheme, applyAppearance } from '../shared/appearance.js';
import { PROOF_ICONS } from '../shared/proof-details.js';

const TABS = [
  ['businesses', 'Businesses'], ['business', 'Business details'], ['payments', 'Payments'], ['documents', 'Documents'], ['numbering', 'Numbering'],
  ['appearance', 'Appearance'], ['email', 'Email'], ['automation', 'Automation'], ['sharing', 'Public link'], ['account', 'Account'], ['data', 'Backup'],
];

const pathGet = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);

// The business whose details, payment info and numbers are being edited.
// Stays picked while you move between tabs.
let editing = null;
const editingId = () => (businessOf(editing) ? editing : store.settings.defaultBusinessId);
const current = () => settingsFor(editingId());

// Field helpers. `data-k` holds the settings path, e.g. "business.name".
const input = (k, label, { type = 'text', hint = '', placeholder = '', mono = false } = {}) => `
  <label class="field"><span>${esc(label)}</span>
    <input class="input ${mono ? 'mono' : ''}" data-k="${k}" type="${type}" value="${esc(pathGet(current(), k) ?? '')}" placeholder="${esc(placeholder)}">
    ${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;
const area = (k, label, { rows = 3, hint = '' } = {}) => `
  <label class="field"><span>${esc(label)}</span>
    <textarea class="textarea" data-k="${k}" rows="${rows}">${esc(pathGet(current(), k) ?? '')}</textarea>
    ${hint ? `<small class="muted">${hint}</small>` : ''}</label>`;
const check = (k, label, hint = '') => `
  <label class="check"><input type="checkbox" data-k="${k}" ${pathGet(current(), k) ? 'checked' : ''}>
    <span>${esc(label)}${hint ? `<br><small class="muted">${esc(hint)}</small>` : ''}</span></label>`;
const section = (title, body) => `<section class="card card-pad stack" style="gap:14px"><span class="label">${esc(title)}</span>${body}</section>`;

const PLACEHOLDERS = '{client} {type} {number} {total} {balance} {due} {link} {business}';

// Shown on the tabs that belong to one business, so you always know which one you are changing.
function businessSwitcher() {
  if (!hasManyBusinesses()) return '';
  const id = editingId();
  return `<section class="card card-pad biz-switch"><span class="label">Editing</span>
    <div class="seg" role="tablist">${store.settings.businesses.map((b) => `<button type="button" data-edit-biz="${b.id}" class="${b.id === id ? 'on' : ''}">
      <span class="mono">${esc(b.code)}</span> ${esc(b.business.name || b.name)}</button>`).join('')}</div>
    <small class="muted">Business details, payment info and numbers are saved per business. Everything else is shared.</small></section>`;
}

function businessesTab() {
  const list = store.settings.businesses || [];
  const cur = store.settings.documents.currency;
  return `<section class="card">
    <div class="card-head"><span class="label">Your businesses</span>
      <button class="btn btn--primary btn--sm" type="button" data-biz-add>${icons.plus}<span>Add business</span></button></div>
    <ul class="biz-list">${list.map((b) => `<li class="biz-row">
      <div class="biz-id"><span class="biz-code">${esc(b.code)}</span>${b.isDefault ? '<span class="pill pill--paid">Default</span>' : ''}</div>
      <div class="biz-main">
        <div class="t">${esc(b.business.name || b.name || 'Unnamed')}</div>
        <div class="s">${[b.business.taxId && `GSTIN ${b.business.taxId}`, b.business.email, b.payment.upiId && `UPI ${b.payment.upiId}`].filter(Boolean).map(esc).join(' · ') || 'No details yet'}</div>
        <dl class="biz-stats">
          <div><dt>Invoices</dt><dd>${b.invoices}</dd></div>
          <div><dt>All bills</dt><dd>${b.documents}</dd></div>
          <div><dt>Billed</dt><dd>${esc(money(b.billed, cur))}</dd></div>
          <div><dt>Collected</dt><dd>${esc(money(b.collected, cur))}</dd></div>
          <div><dt>Due</dt><dd class="${b.outstanding > 0 ? 'due' : ''}">${esc(money(b.outstanding, cur))}</dd></div>
          <div><dt>Last bill</dt><dd>${esc(b.last_issued ? date(b.last_issued) : '-')}</dd></div>
        </dl>
      </div>
      <div class="biz-actions">
        <a class="btn btn--sm" href="#/documents?business=${b.id}">${icons.docs}<span>Bills</span></a>
        <button class="btn btn--sm" type="button" data-biz-edit="${b.id}">${icons.edit}<span>Edit details</span></button>
        ${b.isDefault ? '' : `<button class="btn btn--ghost btn--sm" type="button" data-biz-default="${b.id}">Make default</button>`}
        ${b.isDefault || b.documents ? '' : `<button class="btn btn--ghost btn--sm" type="button" data-biz-rm="${b.id}" style="color:var(--red)">Delete</button>`}
      </div></li>`).join('')}</ul></section>
    <p class="muted" style="margin:0;font-size:13px">The default business is picked for new bills. You can change it per bill in the editor.
      New businesses get their own number series, like B02-INV-2026-0001, so numbers never clash.</p>`;
}

const tabs = {
  businesses: businessesTab,
  appearance: () => section('Style', `
    <label class="field"><span>Site and bill style</span><select class="select" data-k="appearance.style">
      ${Object.entries(STYLE_OPTIONS).map(([id, label]) => `<option value="${id}" ${current().appearance?.style === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}
    </select><small>Notion uses a quiet monochrome layout, flat surfaces and minimal bills and payment proofs.</small></label>
    <label class="field"><span>Default payment proof icon</span><select class="select" data-k="appearance.proofIcon">
      ${Object.entries(PROOF_ICONS).map(([id, label]) => `<option value="${id}" ${current().appearance?.proofIcon === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}
    </select><small>You can choose a different icon for each proof.</small></label>
    `) + section('Typography', `
    <label class="field"><span>Font throughout the app</span><select class="select" data-k="appearance.font">
      ${Object.entries(FONT_OPTIONS).map(([id, f]) => `<option value="${id}" ${current().appearance?.font === id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
    </select><small>Applies to all businesses, documents, shared pages and saved payment images. Fonts work offline.</small></label>
    <div class="font-samples">${Object.entries(FONT_OPTIONS).map(([id, f]) => `<div style="font-family:${esc(fontTheme(id).display)}"><strong>${esc(f.label)}</strong><span>Billdot · ₹3,500.00 · Payment received</span></div>`).join('')}</div>`),
  business: () => businessSwitcher() + section(hasManyBusinesses() ? `${businessOf(editingId())?.code} details` : 'Your business', `
    ${imageField('logo', 'logo')}
    <div class="grid-2">${input('business.name', 'Business name')}${input('business.tagline', 'Tagline')}</div>
    <div class="grid-2">${input('business.email', 'Email', { type: 'email' })}${input('business.phone', 'Phone', { type: 'tel' })}</div>
    <div class="grid-2">${input('business.website', 'Website')}${input('business.taxId', 'Tax ID / GSTIN', { mono: true })}</div>
    ${area('business.address', 'Address')}
    ${input('business.signatory', 'Signature name', { hint: 'Printed under the signature line.' })}
    ${imageField('signature', 'signature', 'Shown above the signature name on invoices and quotes. A dark signature on a white or transparent background works best.')}`),

  payments: () => businessSwitcher() + section('How clients pay you', `
    <div class="grid-2">${input('payment.bankName', 'Bank')}${input('payment.accountName', 'Account name')}</div>
    <div class="grid-3">${input('payment.accountNumber', 'Account number', { mono: true })}${input('payment.ifsc', 'IFSC', { mono: true })}${input('payment.swift', 'SWIFT', { mono: true })}</div>
    ${input('payment.upiId', 'UPI ID', { mono: true, placeholder: 'name@bank', hint: 'Adds a scan to pay QR with the amount filled in on INR documents.' })}
    ${input('payment.paymentLink', 'Payment link', { placeholder: 'https://', hint: 'Razorpay, Stripe or PayPal link. Shown as a Pay button on the client page.' })}
    ${area('payment.instructions', 'Payment instructions')}`),

  documents: () => `${section('Defaults', `
    <div class="grid-3">${input('documents.currency', 'Currency', { mono: true, placeholder: 'INR' })}
      ${input('documents.locale', 'Number format', { mono: true, placeholder: 'en-IN' })}
      <label class="field"><span>Default format</span><select class="select" data-k="documents.defaultFormat">
        ${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}" ${store.settings.documents.defaultFormat === k ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></label></div>
    <div class="grid-3">${input('documents.taxLabel', 'Tax name', { placeholder: 'GST' })}
      ${input('documents.defaultTaxRate', 'Default tax %', { type: 'number', mono: true })}
      ${input('documents.defaultDueDays', 'Pay within (days)', { type: 'number', mono: true })}</div>
    ${input('documents.quoteValidDays', 'Quotes valid for (days)', { type: 'number', mono: true })}
    ${check('documents.splitTax', 'Split tax into CGST and SGST', 'For intra-state GST invoices.')}
    ${check('documents.showAmountInWords', 'Show amount in words')}`)}
    ${section('Default text', `${area('documents.notes', 'Notes')}${area('documents.terms', 'Terms', { rows: 4 })}`)}`,

  numbering: () => businessSwitcher() + section('Document numbers', `
    <p class="muted" style="margin:0;font-size:14px">Use {YYYY}, {YY} and {MM} in the prefix. Numbers that already exist are skipped.</p>
    ${Object.entries(DOC_TYPES).map(([k, t]) => `
      <div class="grid-3" data-num="${k}">
        ${input(`numbering.${k}.prefix`, t.label, { mono: true })}
        ${input(`numbering.${k}.next`, 'Next number', { type: 'number', mono: true })}
        <label class="field"><span>Preview</span><div class="input mono" data-preview style="display:flex;align-items:center"></div></label>
      </div>`).join('')}`),

  email: () => `${section('SMTP server', `
    <p class="muted" style="margin:0;font-size:14px">For Gmail use smtp.gmail.com, port 465, your address and an
      <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">app password</a>.</p>
    <div class="grid-3">${input('email.host', 'Host', { mono: true, placeholder: 'smtp.gmail.com' })}${input('email.port', 'Port', { type: 'number', mono: true })}
      <label class="field"><span>Security</span>${check('email.secure', 'SSL (port 465)')}</label></div>
    <div class="grid-2">${input('email.user', 'Username', { mono: true })}
      <label class="field"><span>Password</span><input class="input mono" type="password" data-k="email.pass" autocomplete="new-password"
        placeholder="${store.settings.email.passSet ? 'Saved. Type to replace.' : ''}"></label></div>
    <div class="grid-2">${input('email.fromName', 'From name')}${input('email.fromEmail', 'From email', { type: 'email' })}</div>
    ${input('email.bcc', 'Bcc me at', { type: 'email', hint: 'Get a copy of every bill you send.' })}
    <div><button class="btn" type="button" data-test-email>${icons.send}<span>Send a test email</span></button></div>`)}
    ${section('Message templates', `<p class="muted" style="margin:0;font-size:13px">Placeholders: <span class="mono">${esc(PLACEHOLDERS)}</span></p>
      ${input('email.subject', 'Subject')}${area('email.message', 'Message', { rows: 8 })}
      ${input('email.reminderSubject', 'Reminder subject')}${area('email.reminderMessage', 'Reminder message', { rows: 8 })}`)}`,

  automation: () => section('On autopilot', `
    ${check('automation.reminders', 'Email payment reminders', 'Sent to the client after the due date while a balance is left.')}
    <label class="field"><span>Remind after (days past due)</span>
      <input class="input mono" data-k="automation.reminderDays" data-list value="${esc(store.settings.automation.reminderDays.join(', '))}">
      <small class="muted">Comma separated, up to six. Example: 1, 7, 14</small></label>
    ${check('automation.recurring', 'Create recurring invoices', 'Copies a recurring invoice on its next date and emails it if email is set up.')}
    ${store.settings.meta?.emailReady ? '' : '<p class="claim" style="margin:0">Email is not set up, so reminders and recurring invoices cannot be emailed yet.</p>'}`),

  sharing: () => `<section class="card card-pad stack" style="gap:16px" data-share>
    <span class="label">Public link</span>
    <p class="muted" style="margin:0;font-size:14px">Opens a temporary https address through Cloudflare so you and your clients can reach this app from any phone or laptop.
      The address changes each time you turn it on. Needs <span class="mono">cloudflared</span> (brew install cloudflared).</p>
    <div data-share-body><div class="skeleton" style="height:120px"></div></div>
  </section>`,

  account: () => section('Change password', `
    <form class="stack" style="gap:12px" data-password>
      <label class="field"><span>Current password</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span>New password</span><input class="input" type="password" name="next" autocomplete="new-password" minlength="6" required></label>
      <div><button class="btn btn--primary" type="submit">Update password</button></div>
      <p class="muted" style="margin:0;font-size:13px">Every other device gets signed out.</p>
    </form>`),

  data: () => section('Backup', `
    <p class="muted" style="margin:0;font-size:14px">Everything lives in <span class="mono">data/billdot.db</span> on this computer.
      Download a JSON copy of your clients, items, documents and payments any time.</p>
    <div><a class="btn" href="/api/export" download>${icons.download}<span>Download backup</span></a></div>`),
};

function shareBody(s) {
  if (s.running && s.url) {
    return `<div class="share-box">
      <div class="row-between"><span class="row" style="gap:8px"><span class="led led--pulse"></span><span class="label" style="color:inherit">Live</span></span>
        <button class="btn btn--sm" data-share-stop type="button">Turn off</button></div>
      <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div class="qr-box"><img src="/api/share/qr.svg?u=${encodeURIComponent(s.url)}" alt="QR code for the public link" width="130" height="130"></div>
        <div class="stack" style="gap:10px;min-width:0;flex:1">
          <span class="share-url">${esc(s.url)}</span>
          <div class="row" style="gap:8px"><button class="btn btn--sm" data-share-copy type="button">${icons.copy}<span>Copy</span></button>
            <a class="btn btn--sm" href="${esc(s.url)}" target="_blank" rel="noopener">${icons.globe}<span>Open</span></a></div>
          <small style="opacity:.7">Scan on your phone and sign in with your password. Bill links you send now use this address.</small>
        </div>
      </div></div>`;
  }
  return `<div class="stack" style="gap:12px">
    ${s.error ? `<p class="claim" style="margin:0">${esc(s.error)}</p>` : ''}
    <p style="margin:0;font-size:14px">Right now links use <span class="mono">${esc(s.baseUrl)}</span>, which only works on this network.</p>
    <div><button class="btn btn--red" data-share-start type="button">${icons.globe}<span>Turn on public link</span></button></div></div>`;
}

const numberPreview = (cfg) => {
  const d = new Date();
  const prefix = String(cfg.prefix || '').replace('{YYYY}', d.getFullYear()).replace('{YY}', String(d.getFullYear()).slice(2))
    .replace('{MM}', String(d.getMonth() + 1).padStart(2, '0'));
  return `${prefix}${String(cfg.next || 1).padStart(Number(cfg.pad) || 1, '0')}`;
};

// Logo and signature uploads share one block and one save path.
const IMAGE_SIZES = { logo: { width: 600, height: 240 }, signature: { width: 600, height: 200 } };
const imageField = (key, label, hint = '') => {
  const src = current().business[key];
  return `<div class="logo-drop">
      ${src ? `<img src="${esc(src)}" alt="${label}">` : `<span class="muted">No ${label}</span>`}
      <div class="stack" style="gap:6px">
        <div class="row" style="gap:8px">
          <label class="btn btn--sm">${icons.plus}<span>Upload ${label}</span><input type="file" accept="image/*" data-image="${key}" hidden></label>
          ${src ? `<button class="btn btn--ghost btn--sm" data-image-rm="${key}" type="button">Remove</button>` : ''}
        </div>
        ${hint ? `<small class="muted">${hint}</small>` : ''}
      </div>
    </div>`;
};

// Converts a picked image to a small PNG data URL so the settings stay light.
function readImage(file, { width, height }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, width / img.width, height / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image we can read.')); };
    img.src = url;
  });
}

// Builds a nested patch like {business: {name: 'x'}} from a dotted path.
const patchFor = (path, value) => path.split('.').reduceRight((acc, k) => ({ [k]: acc }), value);
const mergeDeep = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeDeep(out[k] || {}, v) : v;
  return out;
};

export async function mount(el, { params, refreshSettings }) {
  const tab = tabs[params.tab] ? params.tab : (hasManyBusinesses() ? 'businesses' : 'business');
  let pending = {};

  const paint = () => {
    el.innerHTML = `
      <div class="page-head"><div><div class="label">Workspace</div><h1 class="page-title">Settings</h1></div>
        <div class="page-actions"><span class="save-state" data-save hidden><span class="led"></span><span>Saved</span></span></div></div>
      <div class="settings">
        <nav class="settings-nav" aria-label="Settings sections">${TABS.map(([k, l]) => `<a href="#/settings/${k}" class="${k === tab ? 'on' : ''}">${esc(l)}</a>`).join('')}</nav>
        <div class="stack" style="gap:18px" data-tab>${tabs[tab]()}</div>
      </div>`;
    el.querySelectorAll('[data-num]').forEach(updatePreview);
  };

  const saveState = (state, text) => {
    const box = $('[data-save]', el);
    if (!box) return;
    box.hidden = false;
    box.className = `save-state ${state}`;
    box.lastElementChild.textContent = text;
  };

  const flush = async () => {
    const patch = pending;
    pending = {};
    if (!Object.keys(patch).length) return;
    try {
      await put(`/settings?business=${editingId()}`, patch);
      await refreshSettings();
      saveState('', 'Saved');
    } catch (err) {
      if (patch.appearance) applyAppearance(store.settings);
      saveState('err', 'Not saved');
      toastError(err);
    }
  };
  const save = debounce(flush, 600);

  function updatePreview(row) {
    const k = row.dataset.num;
    const cfg = {
      ...current().numbering[k],
      prefix: $(`[data-k="numbering.${k}.prefix"]`, row).value,
      next: $(`[data-k="numbering.${k}.next"]`, row).value,
    };
    $('[data-preview]', row).textContent = numberPreview(cfg);
  }

  const valueOf = (field) => {
    if (field.type === 'checkbox') return field.checked;
    if (field.type === 'number') return Number(field.value) || 0;
    if (field.hasAttribute('data-list')) {
      return field.value.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
    }
    return field.value;
  };

  const onField = (e) => {
    const field = e.target.closest('[data-k]');
    if (!field) return;
    if (field.dataset.k === 'email.pass' && !field.value) return;
    if (['appearance.font', 'appearance.style'].includes(field.dataset.k)) {
      applyAppearance({ appearance: { ...current().appearance, ...pending.appearance, [field.dataset.k.split('.')[1]]: field.value } });
    }
    pending = mergeDeep(pending, patchFor(field.dataset.k, valueOf(field)));
    saveState('dirty', 'Saving');
    const row = field.closest('[data-num]');
    if (row) updatePreview(row);
    save();
  };
  el.addEventListener('input', onField);
  el.addEventListener('change', (e) => { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') onField(e); });

  el.addEventListener('change', async (e) => {
    const key = e.target.dataset.image;
    const file = e.target.files?.[0];
    if (!key || !file) return;
    try {
      const image = await readImage(file, IMAGE_SIZES[key]);
      await put(`/settings?business=${editingId()}`, { business: { [key]: image } });
      await refreshSettings();
      paint();
      toast(key === 'logo' ? 'Logo saved' : 'Signature saved');
    } catch (err) { toastError(err); }
  });

  const addBusiness = async () => {
    const data = await modal({
      title: 'Add a business',
      submit: 'Create',
      body: `<div class="stack" style="gap:12px">
        <label class="field"><span>Business name</span><input class="input" name="name" required autofocus maxlength="200"></label>
        <label class="field"><span>Tax ID / GSTIN</span><input class="input mono" name="taxId"></label>
        <label class="field"><span>UPI ID</span><input class="input mono" name="upiId" placeholder="name@bank"></label>
        <small class="muted">You can fill in the address, logo and bank details next.</small></div>`,
    });
    if (!data) return;
    try {
      const made = await post('/businesses', { name: data.name, business: { taxId: data.taxId }, payment: { upiId: data.upiId } });
      await refreshSettings();
      editing = made.id;
      toast(`${made.code} created. Add its details here.`);
      location.hash = '#/settings/business';
    } catch (err) { toastError(err); }
  };

  const loadShare = async () => {
    const body = $('[data-share-body]', el);
    if (body) body.innerHTML = shareBody(await get('/share'));
  };

  el.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-image-rm]')) {
      const key = t.closest('[data-image-rm]').dataset.imageRm;
      await put(`/settings?business=${editingId()}`, { business: { [key]: '' } }).catch(toastError);
      await refreshSettings();
      paint();
    } else if (t.closest('[data-edit-biz]')) {
      await flush();
      editing = Number(t.closest('[data-edit-biz]').dataset.editBiz);
      paint();
    } else if (t.closest('[data-biz-edit]')) {
      editing = Number(t.closest('[data-biz-edit]').dataset.bizEdit);
      location.hash = '#/settings/business';
    } else if (t.closest('[data-biz-add]')) {
      await addBusiness();
    } else if (t.closest('[data-biz-default]')) {
      const id = Number(t.closest('[data-biz-default]').dataset.bizDefault);
      try {
        await post(`/businesses/${id}/default`);
        await refreshSettings();
        paint();
        toast(`${businessOf(id).code} is now the default`);
      } catch (err) { toastError(err); }
    } else if (t.closest('[data-biz-rm]')) {
      const b = businessOf(t.closest('[data-biz-rm]').dataset.bizRm);
      if (!b || !await confirmDialog(`Delete ${b.code}?`, `${b.business.name || b.name} and its saved details are removed. It has no bills.`, { submit: 'Delete', danger: true })) return;
      try {
        await del(`/businesses/${b.id}`);
        await refreshSettings();
        paint();
        toast(`${b.code} deleted`);
      } catch (err) { toastError(err); }
    } else if (t.closest('[data-test-email]')) {
      await save.flush?.();
      const data = await modal({
        title: 'Send a test email',
        submit: 'Send',
        body: `<label class="field"><span>Send to</span><input class="input" name="to" type="email" required autofocus
          value="${esc(store.settings.business.email || store.settings.email.fromEmail)}"></label>`,
      });
      if (!data) return;
      toast('Sending', 'info');
      try {
        const res = await post('/settings/test-email', data);
        toast(`Test email sent to ${res.to}`);
      } catch (err) { toastError(err); }
    } else if (t.closest('[data-share-start]')) {
      const btn = t.closest('button');
      btn.disabled = true;
      btn.lastElementChild.textContent = 'Starting, this takes a few seconds';
      try {
        const s = await post('/share/start');
        if (s.error) toast(s.error, 'err');
        await refreshSettings();
        await loadShare();
      } catch (err) {
        toastError(err);
        await loadShare();
      }
    } else if (t.closest('[data-share-stop]')) {
      await post('/share/stop').catch(toastError);
    } else if (t.closest('[data-share-copy]')) {
      await copyText(store.settings.sharing.publicUrl);
      toast('Link copied');
    }
  });

  el.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-password]')) return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    try {
      await post('/auth/password', data);
      e.target.reset();
      toast('Password updated');
    } catch (err) { toastError(err); }
  });

  paint();
  if (tab === 'sharing') await loadShare();
  return {
    beforeLeave: async () => { await flush(); return true; },
    destroy: () => save.cancel?.(),
    refresh: (evt) => {
      if (evt.type === 'tunnel' && tab === 'sharing') setTimeout(() => loadShare().catch(() => {}), 300);
      if (tab === 'businesses' && (evt.type === 'document' || evt.type === 'resume')) refreshSettings().then(paint).catch(() => {});
    },
  };
}
