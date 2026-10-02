import { get, post, del } from '../api.js';
import { icons } from '../icons.js';
import {
  $, esc, money, date, timeAgo, statusPill, store, toast, toastError, modal, confirmDialog,
  fitSheet, printSheet, copyText, bindMenus, settingsFor, businessOf, hasManyBusinesses,
} from '../ui.js';
import { DOC_TYPES, PAYMENT_METHODS } from '../shared/doc-types.js';
import { localToday } from '../shared/format.js';
import { renderDocument } from '../shared/render-doc.js';

const isPrivateBase = (url) => /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url || '');

const qrFor = (doc) => (settingsFor(doc.business_id).payment.upiId && doc.currency === 'INR' && DOC_TYPES[doc.type].payable && doc.balance > 0
  ? `/api/documents/${doc.id}/upi.svg?b=${doc.balance}` : '');

function linkWarning() {
  const base = store.settings.meta?.baseUrl;
  if (!isPrivateBase(base)) return '';
  return `<p class="claim" style="margin:0 0 14px">The link points to ${esc(base)}, which only works on your network.
    <a href="#/settings/sharing" data-close-modal><b>Turn on the public link</b></a> so the client can open it anywhere.</p>`;
}

function sidePanel(doc, proofs = []) {
  const t = DOC_TYPES[doc.type];
  const s = doc.display_status;
  const open = !['void', 'paid', 'declined'].includes(s);
  const payable = t.payable && doc.status !== 'void' && doc.balance > 0;
  const convertTargets = { quote: ['invoice', 'proforma'], proforma: ['invoice'], invoice: ['receipt', 'delivery_note', 'credit_note'] }[doc.type] || [];
  return `
  ${doc.claim && s === 'claimed' ? `<div class="claim"><div><b>Client says this is paid.</b><br>
      ${esc(doc.claim.method)}${doc.claim.reference ? `, ref ${esc(doc.claim.reference)}` : ''}${doc.claim.note ? `<br>"${esc(doc.claim.note)}"` : ''}
      <br><small>${esc(timeAgo(doc.claim.at))}</small></div>
      <div class="row" style="gap:8px"><button class="btn btn--primary btn--sm" data-act="paid">${icons.check}<span>Confirm paid</span></button></div></div>` : ''}
  <section class="card card-pad">
    <div class="row-between"><span class="label">${esc(t.label)}</span>${statusPill(s)}</div>
    <div class="amount-big">${esc(money(t.hidePrices ? 0 : doc.total, doc.currency))}</div>
    <dl class="kv">
      ${hasManyBusinesses() && businessOf(doc.business_id) ? `<dt>From</dt><dd><span class="mono">${esc(businessOf(doc.business_id).code)}</span> ${esc(businessOf(doc.business_id).business.name)}</dd>` : ''}
      ${doc.client?.name ? `<dt>Client</dt><dd>${doc.client_id ? `<a href="#/clients/${doc.client_id}">${esc(doc.client.name)}</a>` : esc(doc.client.name)}</dd>` : ''}
      <dt>Issued</dt><dd>${esc(date(doc.issue_date))}</dd>
      ${doc.due_date ? `<dt>${esc(t.dateLabel)}</dt><dd>${esc(date(doc.due_date))}</dd>` : ''}
      ${t.payable ? `<dt>Paid</dt><dd>${esc(money(doc.amount_paid, doc.currency))}</dd><dt>Balance</dt><dd><b>${esc(money(doc.balance, doc.currency))}</b></dd>` : ''}
      ${doc.recurring ? `<dt>Repeats</dt><dd>${esc(doc.recurring.interval)}, next ${esc(date(doc.recurring.next_date))}</dd>` : ''}
      ${doc.reminders_sent ? `<dt>Reminders</dt><dd>${doc.reminders_sent} sent</dd>` : ''}
    </dl>
  </section>
  <section class="card card-pad stack" style="gap:8px">
    ${doc.status !== 'void' ? `<button class="btn btn--red btn--block" data-act="send">${icons.send}<span>${doc.sent_at ? 'Send again' : 'Send to client'}</span></button>` : ''}
    <div class="action-grid">
      ${doc.status !== 'void' ? `<button class="btn" data-act="whatsapp">${icons.whatsapp}<span>WhatsApp</span></button>
      <button class="btn" data-act="copy-link">${icons.link}<span>Copy link</span></button>` : ''}
      <button class="btn" data-act="print">${icons.print}<span>Print / PDF</span></button>
      ${doc.status !== 'void' ? `<a class="btn" href="#/doc/${doc.id}/edit">${icons.edit}<span>Edit</span></a>` : ''}
      ${payable ? `<button class="btn" data-act="payment">${icons.money}<span>Add payment</span></button>
      <button class="btn btn--primary" data-act="paid">${icons.check}<span>Mark paid</span></button>` : ''}
      ${t.payable && doc.status !== 'void' ? `<a class="btn" href="#/payments/new?doc=${doc.id}">${icons.receipt}<span>Payment proof</span></a>` : ''}
      ${t.payable && doc.status === 'paid' ? `<button class="btn" data-act="unpaid">${icons.x}<span>Mark unpaid</span></button>` : ''}
      ${doc.type === 'quote' && open && s !== 'accepted' ? `<button class="btn" data-act="accepted">${icons.check}<span>Accepted</span></button>
      <button class="btn" data-act="declined">${icons.x}<span>Declined</span></button>` : ''}
      ${t.payable && doc.balance > 0 && doc.sent_at && doc.status !== 'void' ? `<button class="btn" data-act="reminder">${icons.send}<span>Reminder</span></button>` : ''}
    </div>
    <div class="menu">
      <button class="btn btn--ghost btn--block" data-menu type="button">${icons.more}<span>More</span></button>
      <div class="menu-list" hidden style="left:0;right:0">
        <button data-act="duplicate">Duplicate</button>
        ${convertTargets.map((k) => `<button data-act="convert" data-type="${k}">Convert to ${esc(DOC_TYPES[k].label.toLowerCase())}</button>`).join('')}
        ${doc.status !== 'void' && doc.status !== 'draft' ? '<button data-act="void">Void</button>' : ''}
        ${doc.status === 'void' ? '<button data-act="draft">Restore as draft</button>' : ''}
        <button data-act="delete" style="color:var(--red)">Delete</button>
      </div>
    </div>
  </section>
  ${doc.payments?.length ? `<section class="card"><div class="card-head"><span class="label">Payments</span></div><ul class="list">
    ${doc.payments.map((p) => `<li class="list-row"><div><div class="t mono">${esc(money(p.amount, doc.currency))}</div>
      <div class="s">${esc(date(p.date))} · ${esc(p.method)}${p.reference ? ` · ${esc(p.reference)}` : ''}</div></div>
      <button class="btn btn--ghost btn--icon btn--sm" data-act="rm-payment" data-pid="${p.id}" aria-label="Remove payment">${icons.trash}</button></li>`).join('')}
  </ul></section>` : ''}
  ${proofs.length ? `<section class="card"><div class="card-head"><span class="label">Payment proofs</span></div><ul class="list">
    ${proofs.map((p) => `<a class="list-row" href="#/payments/${p.id}"><div><div class="t mono">${esc(money(p.amount, p.currency))}</div>
      <div class="s">${esc(date(p.paid_on))} · ${esc(p.method)}${p.reference ? ` · ${esc(p.reference)}` : ''}</div></div></a>`).join('')}
  </ul></section>` : ''}
  ${doc.children?.length ? `<section class="card"><div class="card-head"><span class="label">Linked</span></div><ul class="list">
    ${doc.children.map((c) => `<a class="list-row" href="#/doc/${c.id}"><span class="t">${esc(DOC_TYPES[c.type]?.label)} <span class="mono">${esc(c.number)}</span></span>${statusPill(c.status)}</a>`).join('')}
  </ul></section>` : ''}
  <section class="card"><div class="card-head"><span class="label">Timeline</span></div><ul class="timeline">
    ${(doc.activity || []).map((a) => `<li class="feed-row k-${esc(a.kind)}"><span class="led"></span><div>${esc(a.message)}
      <time datetime="${esc(a.created_at)}">${esc(timeAgo(a.created_at))}</time></div></li>`).join('')}
  </ul></section>`;
}

async function sendDialog(doc, kind) {
  const prefill = await get(`/documents/${doc.id}/email?kind=${kind}`);
  const ready = store.settings.meta?.emailReady;
  const body = `${linkWarning()}
    ${ready ? '' : `<p class="claim" style="margin:0 0 14px">Email is not set up yet. <a href="#/settings/email" data-close-modal><b>Add SMTP details</b></a>, or share by WhatsApp or link instead.</p>`}
    <div class="stack" style="gap:12px">
      <label class="field"><span>To</span><input class="input" name="to" value="${esc(prefill.to)}" placeholder="client@example.com" required></label>
      <label class="field"><span>Cc</span><input class="input" name="cc" placeholder="Optional, comma separated"></label>
      <label class="field"><span>Subject</span><input class="input" name="subject" value="${esc(prefill.subject)}"></label>
      <label class="field"><span>Message</span><textarea class="textarea" name="message" rows="9">${esc(prefill.message)}</textarea></label>
    </div>`;
  return modal({
    title: kind === 'reminder' ? 'Send a reminder' : `Send ${doc.number}`,
    body,
    submit: ready ? 'Send email' : '',
    onOpen: (form, close) => form.querySelectorAll('[data-close-modal]').forEach((a) => a.addEventListener('click', () => close(null))),
  });
}

function paymentDialog(doc) {
  return modal({
    title: 'Record a payment',
    submit: 'Save payment',
    body: `<div class="stack" style="gap:12px">
      <div class="grid-2">
        <label class="field"><span>Amount (${esc(doc.currency)})</span><input class="input mono" name="amount" inputmode="decimal" value="${doc.balance}" required autofocus></label>
        <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${localToday()}"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Method</span><select class="select" name="method">${PAYMENT_METHODS.map((m) => `<option ${doc.claim?.method === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <label class="field"><span>Reference</span><input class="input" name="reference" value="${esc(doc.claim?.reference || '')}" placeholder="UTR, cheque no."></label>
      </div>
      <label class="field"><span>Note</span><input class="input" name="note"></label>
    </div>`,
  });
}

function whatsappUrl(doc) {
  const biz = settingsFor(doc.business_id).business.name || 'us';
  const t = DOC_TYPES[doc.type];
  const amount = t.payable ? ` for ${money(doc.balance || doc.total, doc.currency)}` : '';
  const text = `Hi ${doc.client?.name || ''}, here is your ${t.label.toLowerCase()} ${doc.number}${amount} from ${biz}:\n${doc.link}`;
  const phone = (doc.client?.phone || '').replace(/[^\d]/g, '');
  return `https://wa.me/${phone.length >= 10 ? phone : ''}?text=${encodeURIComponent(text)}`;
}

export async function mount(el, { params }) {
  let doc;
  let proofs = [];
  let stopFit = () => {};

  const paint = () => {
    const t = DOC_TYPES[doc.type];
    el.innerHTML = `
      <div class="page-head">
        <div><a class="label" href="#/documents?type=${doc.type}" style="text-decoration:none">${esc(t.label)}s</a>
          <h1 class="page-title mono" style="font-family:var(--font)">${esc(doc.number)}</h1>
          ${doc.subject ? `<div class="muted" style="margin-top:4px">${esc(doc.subject)}</div>` : ''}</div>
        <div class="page-actions">
          <a class="btn btn--ghost" href="${esc(doc.link)}" target="_blank" rel="noopener">${icons.globe}<span>Client view</span></a>
        </div>
      </div>
      <div class="detail">
        <div class="preview-frame" style="max-height:none"><div class="sheet-fit" data-sheet>${renderDocument(doc, settingsFor(doc.business_id), { qrSrc: qrFor(doc) })}</div></div>
        <aside class="detail-side">${sidePanel(doc, proofs)}</aside>
      </div>`;
    stopFit();
    stopFit = fitSheet($('[data-sheet]', el));
  };
  const load = async () => {
    [doc, proofs] = await Promise.all([
      get(`/documents/${params.id}`),
      get(`/confirmations?document=${params.id}`).catch(() => []),
    ]);
    paint();
  };

  // Reloads right away so the page never waits on the live event stream.
  const run = async (fn, okMessage, { reload = true } = {}) => {
    try {
      const res = await fn();
      if (okMessage) toast(okMessage);
      if (reload) await load();
      return res;
    } catch (err) {
      toastError(err);
      return null;
    }
  };

  const actions = {
    async send(kind = 'send') {
      const data = await sendDialog(doc, kind);
      if (!data) return;
      toast('Sending', 'info');
      await run(() => post(`/documents/${doc.id}/send`, { ...data, kind }), `Emailed to ${data.to}`);
    },
    reminder: () => actions.send('reminder'),
    async whatsapp() {
      if (isPrivateBase(store.settings.meta?.baseUrl)) toast('Tip: turn on the public link so the client can open it', 'info');
      window.open(whatsappUrl(doc), '_blank', 'noopener');
      await run(() => post(`/documents/${doc.id}/shared`, { channel: 'WhatsApp' }));
    },
    async 'copy-link'() {
      await copyText(doc.link);
      toast(isPrivateBase(doc.link) ? 'Copied. This link only works on your network.' : 'Link copied');
      if (doc.status === 'draft') await run(() => post(`/documents/${doc.id}/shared`, { channel: 'link' }));
    },
    print: () => printSheet(renderDocument(doc, settingsFor(doc.business_id), { qrSrc: qrFor(doc) }), doc.format, `${doc.number} ${doc.client?.name || ''}`.trim()),
    async payment() {
      const data = await paymentDialog(doc);
      if (data) await run(() => post(`/documents/${doc.id}/payments`, data), 'Payment recorded');
    },
    paid: () => run(() => post(`/documents/${doc.id}/paid`), 'Marked as paid'),
    async unpaid() {
      if (await confirmDialog(`Mark ${doc.number} as unpaid?`, 'The paid tag and the payments recorded on it are removed. The full amount shows as due again.', { submit: 'Mark unpaid', danger: true })) {
        await run(() => post(`/documents/${doc.id}/unpaid`), 'Marked as unpaid');
      }
    },
    accepted: () => run(() => post(`/documents/${doc.id}/status`, { status: 'accepted' }), 'Marked as accepted'),
    declined: () => run(() => post(`/documents/${doc.id}/status`, { status: 'declined' }), 'Marked as declined'),
    draft: () => run(() => post(`/documents/${doc.id}/status`, { status: 'draft' }), 'Restored'),
    async void() {
      if (await confirmDialog('Void this document?', 'It stays on record but can no longer be paid or edited.', { submit: 'Void', danger: true })) {
        await run(() => post(`/documents/${doc.id}/status`, { status: 'void' }), 'Voided');
      }
    },
    async duplicate() {
      const copy = await run(() => post(`/documents/${doc.id}/copy`, {}), 'Duplicated', { reload: false });
      if (copy) location.hash = `#/doc/${copy.id}/edit`;
    },
    async convert(btn) {
      const copy = await run(() => post(`/documents/${doc.id}/copy`, { type: btn.dataset.type }), 'Converted', { reload: false });
      if (copy) location.hash = `#/doc/${copy.id}/edit`;
    },
    async 'rm-payment'(btn) {
      if (await confirmDialog('Remove this payment?', 'The balance goes back up by this amount.', { submit: 'Remove', danger: true })) {
        await run(() => del(`/documents/payments/${btn.dataset.pid}`), 'Payment removed');
      }
    },
    async delete() {
      if (await confirmDialog(`Delete ${doc.number}?`, 'This removes it and its payments for good. Void keeps a record instead.', { submit: 'Delete', danger: true })) {
        const ok = await run(() => del(`/documents/${doc.id}`), 'Deleted', { reload: false });
        if (ok) location.hash = '#/documents';
      }
    },
  };

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    actions[btn.dataset.act]?.(btn);
  });
  bindMenus(el);

  await load();
  return {
    destroy: () => stopFit(),
    refresh: (evt) => {
      if (evt.type === 'document' && evt.id === doc.id && evt.deleted) return;
      if (evt.type === 'resume' || evt.type === 'confirmation' || (evt.type === 'document' && evt.id === doc.id)) load().catch(() => {});
    },
  };
}
