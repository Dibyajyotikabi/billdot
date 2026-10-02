import { get, post } from './api.js';
import { icons } from './icons.js';
import { $, esc, store, money, date, statusPill, toast, toastError, modal, fitSheet, printSheet } from './ui.js';
import { DOC_TYPES, PAYMENT_METHODS } from './shared/doc-types.js';
import { renderDocument } from './shared/render-doc.js';

const root = $('#pub');
const token = location.pathname.split('/').filter(Boolean).pop();
const api = `/public/${encodeURIComponent(token)}`;
let stopFit = () => {};

const qrFor = (doc) => (store.settings.payment.upiId && doc.currency === 'INR' && DOC_TYPES[doc.type].payable && doc.balance > 0
  ? `/api${api}/upi.svg?b=${doc.balance}` : '');

function headline(doc) {
  const t = DOC_TYPES[doc.type];
  const s = doc.display_status;
  if (t.hidePrices) return { label: t.label, value: doc.number, sub: `Issued ${date(doc.issue_date)}` };
  if (t.payable && s === 'paid') return { label: 'Paid in full', value: money(doc.total, doc.currency), sub: 'Thank you. Nothing left to pay.' };
  if (t.payable) {
    const due = doc.due_date ? `${s === 'overdue' ? 'Was due' : 'Due'} ${date(doc.due_date)}` : '';
    return { label: doc.amount_paid > 0 ? 'Balance due' : 'Amount due', value: money(doc.balance, doc.currency), sub: due };
  }
  if (t.respondable) return { label: 'Quotation total', value: money(doc.total, doc.currency), sub: doc.due_date ? `Valid until ${date(doc.due_date)}` : '' };
  return { label: t.label, value: money(doc.total, doc.currency), sub: `Issued ${date(doc.issue_date)}` };
}

function actions(doc) {
  const t = DOC_TYPES[doc.type];
  const s = doc.display_status;
  const pay = store.settings.payment;
  const canPay = t.payable && doc.balance > 0 && s !== 'void';
  const canRespond = t.respondable && !['accepted', 'declined', 'void'].includes(doc.status);
  return `
    ${canPay && pay.paymentLink ? `<a class="btn btn--red" href="${esc(pay.paymentLink)}" target="_blank" rel="noopener">${icons.money}<span>Pay now</span></a>` : ''}
    ${canPay && s !== 'claimed' ? `<button class="btn ${pay.paymentLink ? '' : 'btn--primary'}" data-act="claim">${icons.check}<span>I have paid</span></button>` : ''}
    ${canRespond ? `<button class="btn btn--primary" data-act="accepted">${icons.check}<span>Accept</span></button>
      <button class="btn" data-act="declined">${icons.x}<span>Decline</span></button>` : ''}
    <button class="btn" data-act="pdf">${icons.download}<span>Save PDF</span></button>`;
}

function notice(doc) {
  const s = doc.display_status;
  if (s === 'claimed') return '<p class="pub-note">Thanks, we got your payment note. We will confirm once it reaches us.</p>';
  if (s === 'void') return '<p class="pub-note pub-note--red">This document was cancelled and is no longer payable.</p>';
  if (s === 'accepted') return '<p class="pub-note">You accepted this quotation. We will be in touch.</p>';
  if (s === 'declined') return '<p class="pub-note">You declined this quotation.</p>';
  return '';
}

function paint({ document: doc, isOwner }) {
  const biz = store.settings.business;
  const h = headline(doc);
  document.title = `${DOC_TYPES[doc.type].label} ${doc.number}${biz.name ? ` from ${biz.name}` : ''}`;
  root.innerHTML = `
    ${isOwner ? '<div class="pub-owner"><span>You are signed in, so this visit is not counted as a client view.</span><a href="/">Back to app</a></div>' : ''}
    <header class="pub-head">
      <div class="pub-brand">
        ${biz.logo ? `<img src="${esc(biz.logo)}" alt="" height="28">` : '<span class="led led--pulse"></span>'}
        <span>${esc(biz.name || 'Billing')}</span>
      </div>
      ${statusPill(doc.display_status)}
    </header>
    <section class="pub-hero">
      <span class="label">${esc(h.label)} · <span class="mono">${esc(doc.number)}</span></span>
      <div class="pub-amount">${esc(h.value)}</div>
      ${h.sub ? `<div class="muted">${esc(h.sub)}</div>` : ''}
      ${notice(doc)}
      <div class="pub-actions">${actions(doc)}</div>
    </section>
    <section class="pub-sheet" aria-label="Document">
      <div class="sheet-fit" data-sheet>${renderDocument(doc, store.settings, { qrSrc: qrFor(doc) })}</div>
    </section>
    <footer class="pub-foot">
      ${biz.email ? `Questions? <a href="mailto:${esc(biz.email)}?subject=${encodeURIComponent(`${DOC_TYPES[doc.type].label} ${doc.number}`)}">${esc(biz.email)}</a>` : ''}
      ${biz.phone ? ` · <a href="tel:${esc(biz.phone)}">${esc(biz.phone)}</a>` : ''}
    </footer>`;
  stopFit();
  stopFit = fitSheet($('[data-sheet]', root));
}

async function claim(doc) {
  const data = await modal({
    title: 'Tell us you have paid',
    submit: 'Send',
    body: `<div class="stack" style="gap:12px">
      <p class="muted" style="margin:0;font-size:14px">We will check and mark ${esc(doc.number)} as paid.</p>
      <label class="field"><span>How did you pay?</span><select class="select" name="method">
        ${PAYMENT_METHODS.map((m) => `<option ${m === (store.settings.payment.upiId ? 'UPI' : 'Bank transfer') ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <label class="field"><span>Transaction reference</span><input class="input mono" name="reference" placeholder="UTR or transaction ID" maxlength="120"></label>
      <label class="field"><span>Note</span><textarea class="textarea" name="note" rows="2" maxlength="500"></textarea></label>
    </div>`,
  });
  if (!data) return false;
  await post(`${api}/claim`, data);
  toast('Thanks, we have been notified');
  return true;
}

async function respond(action) {
  const accepting = action === 'accepted';
  const data = await modal({
    title: accepting ? 'Accept this quotation' : 'Decline this quotation',
    submit: accepting ? 'Accept' : 'Decline',
    danger: !accepting,
    body: `<label class="field"><span>Your name</span><input class="input" name="name" autocomplete="name" maxlength="120" autofocus></label>`,
  });
  if (!data) return false;
  await post(`${api}/respond`, { action, name: data.name });
  toast(accepting ? 'Accepted. Thank you.' : 'Response sent');
  return true;
}

async function load() {
  const data = await get(api);
  store.settings = data.settings;
  paint(data);
  return data;
}

async function start() {
  let data;
  try {
    data = await load();
  } catch (err) {
    root.innerHTML = `<div class="pub-missing"><span class="label">Error ${err.status || ''}</span>
      <h1 class="pub-amount">Not found</h1><p class="muted">This link is not valid anymore. Ask the sender for a new one.</p></div>`;
    return;
  }
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const doc = data.document;
    try {
      if (act === 'pdf') {
        printSheet(renderDocument(doc, store.settings, { qrSrc: qrFor(doc) }), doc.format, `${doc.number} ${store.settings.business.name || ''}`.trim());
        return;
      }
      const changed = act === 'claim' ? await claim(doc) : await respond(act);
      if (changed) data = await load();
    } catch (err) {
      toastError(err);
    }
  });
}

start();
