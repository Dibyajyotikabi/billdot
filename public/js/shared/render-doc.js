// Renders a document as HTML. Used by the editor preview, the detail page,
// the client link and printing, so all of them look identical.
import { DOC_TYPES, STATUS_LABELS, isThermal } from './doc-types.js';
import { computeTotals, round2 } from './calc.js';
import { escapeHtml as e, multiline, formatMoney, formatDate, formatNumber } from './format.js';
import { amountInWords } from './words.js';

const pad2 = (n) => String(n).padStart(2, '0');

function partyLines(p = {}) {
  return [p.company && p.company !== p.name ? p.company : '', p.address, p.email, p.phone, p.tax_id || p.taxId]
    .filter(Boolean);
}

function ctx(doc, settings) {
  const type = DOC_TYPES[doc.type] || DOC_TYPES.invoice;
  const locale = settings.documents?.locale || 'en-IN';
  const currency = doc.currency || settings.documents?.currency || 'INR';
  const totals = computeTotals(doc);
  const paid = Number(doc.amount_paid) || 0;
  return {
    type,
    locale,
    currency,
    totals,
    paid,
    balance: round2(Math.max(totals.total - paid, 0)),
    money: (n) => formatMoney(n, currency, locale),
    date: (d) => formatDate(d, locale),
    qty: (n) => formatNumber(n, locale),
    taxLabel: settings.documents?.taxLabel || 'Tax',
    split: Boolean(settings.documents?.splitTax),
    biz: settings.business || {},
    pay: settings.payment || {},
  };
}

function taxRows(c) {
  return c.totals.taxGroups.flatMap((g) => {
    if (c.split) {
      const half = round2(g.tax / 2);
      return [
        [`C${c.taxLabel} ${g.rate / 2}%`, half],
        [`S${c.taxLabel} ${g.rate / 2}%`, round2(g.tax - half)],
      ];
    }
    return [[`${c.taxLabel} ${g.rate}%`, g.tax]];
  });
}

function stamp(doc) {
  const status = doc.display_status || doc.status;
  if (status === 'paid' && doc.type !== 'quote') return '<div class="nd-stamp">Paid</div>';
  if (status === 'void') return '<div class="nd-stamp nd-stamp--void">Void</div>';
  if (status === 'accepted') return '<div class="nd-stamp">Accepted</div>';
  return '';
}

function paymentBlock(doc, c, qrSrc) {
  if (!c.type.payable || c.balance <= 0 || doc.status === 'void') return '';
  const p = c.pay;
  const rows = [
    ['Bank', p.bankName],
    ['Account name', p.accountName],
    ['Account no.', p.accountNumber],
    ['IFSC', p.ifsc],
    ['SWIFT', p.swift],
    ['UPI', p.upiId],
  ].filter(([, val]) => val);
  if (!rows.length && !p.paymentLink && !p.instructions && !qrSrc) return '';
  return `<div class="nd-pay">
    <div class="nd-label">How to pay</div>
    <div class="nd-pay-grid">
      <dl class="nd-pay-list">${rows.map(([k, val]) => `<dt>${e(k)}</dt><dd>${e(val)}</dd>`).join('')}</dl>
      ${qrSrc ? `<figure class="nd-qr"><img src="${e(qrSrc)}" alt="UPI QR code"><figcaption>Scan to pay</figcaption></figure>` : ''}
    </div>
    ${p.paymentLink ? `<p class="nd-small">Pay online: <a href="${e(p.paymentLink)}">${e(p.paymentLink)}</a></p>` : ''}
    ${p.instructions ? `<p class="nd-small">${multiline(p.instructions)}</p>` : ''}
  </div>`;
}

function itemsTable(c, hidePrices) {
  const head = hidePrices
    ? '<tr><th class="nd-n">#</th><th>Item</th><th class="nd-r">Qty</th></tr>'
    : `<tr><th class="nd-n">#</th><th>Item</th><th class="nd-r">Qty</th><th class="nd-r">Rate</th>
        <th class="nd-r">${e(c.taxLabel)}</th><th class="nd-r">Amount</th></tr>`;
  const rows = c.totals.items.map((it, i) => `<tr>
      <td class="nd-n">${pad2(i + 1)}</td>
      <td><div class="nd-item">${e(it.name)}</div>${it.description ? `<div class="nd-desc">${multiline(it.description)}</div>` : ''}</td>
      <td class="nd-r nd-mono">${c.qty(it.qty)}${it.unit ? ` <span class="nd-unit">${e(it.unit)}</span>` : ''}</td>
      ${hidePrices ? '' : `<td class="nd-r nd-mono">${c.money(it.rate)}</td>
      <td class="nd-r nd-mono">${Number(it.tax_rate) ? `${formatNumber(it.tax_rate)}%` : '-'}</td>
      <td class="nd-r nd-mono">${c.money(it.amount)}</td>`}
    </tr>`).join('');
  const empty = `<tr><td colspan="${hidePrices ? 3 : 6}" class="nd-empty">No items yet</td></tr>`;
  return `<table class="nd-items"><thead>${head}</thead><tbody>${rows || empty}</tbody></table>`;
}

function totalsList(doc, c) {
  const t = c.totals;
  const rows = [['Subtotal', t.subtotal]];
  if (t.discount) rows.push([`Discount${doc.discount_type === 'percent' ? ` ${formatNumber(doc.discount_value)}%` : ''}`, -t.discount]);
  rows.push(...taxRows(c));
  if (t.shipping) rows.push(['Shipping & other', t.shipping]);
  const totalLabel = doc.type === 'credit_note' ? 'Credit total' : 'Total';
  const showBalance = c.type.payable && c.paid > 0;
  return `<dl class="nd-totals">
    ${rows.map(([k, val]) => `<div><dt>${e(k)}</dt><dd>${c.money(val)}</dd></div>`).join('')}
    <div class="nd-grand"><dt>${totalLabel} <span class="nd-cur">${e(c.currency)}</span></dt><dd class="dot">${c.money(t.total)}</dd></div>
    ${showBalance ? `<div><dt>Paid</dt><dd>${c.money(-c.paid)}</dd></div>
      <div class="nd-due"><dt>Balance due</dt><dd>${c.money(c.balance)}</dd></div>` : ''}
  </dl>`;
}

function renderPage(doc, settings, c, opts) {
  const client = doc.client || {};
  const biz = c.biz;
  const showWords = settings.documents?.showAmountInWords && !c.type.hidePrices;
  const meta = [
    ['Number', e(doc.number || 'Draft')],
    ['Issued', c.date(doc.issue_date)],
    c.type.dateLabel && doc.due_date ? [c.type.dateLabel, c.date(doc.due_date)] : null,
    doc.reference ? ['Reference', e(doc.reference)] : null,
    c.type.hidePrices ? null : [c.type.payable && c.paid > 0 ? 'Balance' : 'Amount', c.money(c.type.payable && c.paid > 0 ? c.balance : c.totals.total)],
  ].filter(Boolean);

  return `<article class="nd nd--${e(doc.format || 'a4')} nd--${e(doc.type)}">
    <header class="nd-head">
      <div class="nd-brand">
        ${biz.logo ? `<img class="nd-logo" src="${e(biz.logo)}" alt="">` : ''}
        <div class="nd-brand-name">${e(biz.name || 'Your business')}</div>
        ${biz.tagline ? `<div class="nd-tagline">${e(biz.tagline)}</div>` : ''}
      </div>
      <div class="nd-title">
        <div class="nd-kicker"><span class="nd-led"></span>${e(STATUS_LABELS[doc.display_status] || '')}</div>
        <h1 class="dot">${e(c.type.title)}</h1>
      </div>
    </header>

    <section class="nd-meta">
      ${meta.map(([k, val]) => `<div><div class="nd-label">${e(k)}</div><div class="nd-meta-v">${val}</div></div>`).join('')}
    </section>

    <section class="nd-parties">
      <div>
        <div class="nd-label">From</div>
        <div class="nd-party-name">${e(biz.name || '')}</div>
        ${partyLines({ address: biz.address, email: biz.email, phone: biz.phone, taxId: biz.taxId ? `${c.taxLabel === 'GST' ? 'GSTIN' : 'Tax ID'} ${biz.taxId}` : '' })
          .map((l) => `<div class="nd-line">${multiline(l)}</div>`).join('')}
      </div>
      <div>
        <div class="nd-label">${e(c.type.party)}</div>
        <div class="nd-party-name">${e(client.name || 'Client name')}</div>
        ${partyLines({ ...client, tax_id: client.tax_id ? `${c.taxLabel === 'GST' ? 'GSTIN' : 'Tax ID'} ${client.tax_id}` : '' })
          .map((l) => `<div class="nd-line">${multiline(l)}</div>`).join('')}
      </div>
    </section>

    ${doc.subject ? `<section class="nd-subject"><div class="nd-label">Subject</div><p>${e(doc.subject)}</p></section>` : ''}

    ${itemsTable(c, c.type.hidePrices)}

    ${c.type.hidePrices ? '' : `<section class="nd-summary">
      <div class="nd-summary-left">
        ${showWords ? `<div class="nd-words"><div class="nd-label">In words</div><p>${e(amountInWords(c.totals.total, c.currency))}</p></div>` : ''}
        ${paymentBlock(doc, c, opts.qrSrc)}
      </div>
      ${totalsList(doc, c)}
    </section>`}

    <section class="nd-foot">
      ${doc.notes ? `<div><div class="nd-label">Notes</div><p>${multiline(doc.notes)}</p></div>` : ''}
      ${doc.terms ? `<div><div class="nd-label">Terms</div><p>${multiline(doc.terms)}</p></div>` : ''}
      <div class="nd-sign">
        <div class="nd-sign-line">${biz.signature ? `<img class="nd-sign-img" src="${e(biz.signature)}" alt="">` : ''}</div>
        <div class="nd-label">${e(biz.signatory || 'Authorised signatory')}</div>
      </div>
    </section>

    <footer class="nd-bottom">
      <span class="nd-dots" aria-hidden="true"></span>
      <span>${[biz.website, biz.email, biz.phone].filter(Boolean).map(e).join('  /  ')}</span>
    </footer>
    ${stamp(doc)}
  </article>`;
}

function renderThermal(doc, settings, c, opts) {
  const client = doc.client || {};
  const biz = c.biz;
  const line = (k, val, cls = '') => `<div class="nt-row ${cls}"><span>${k}</span><span>${val}</span></div>`;
  const items = c.totals.items.map((it) => `<div class="nt-item">
      <div class="nt-item-name">${e(it.name)}</div>
      ${c.type.hidePrices
        ? line(`Qty ${c.qty(it.qty)} ${e(it.unit || '')}`, '')
        : line(`${c.qty(it.qty)} x ${c.money(it.rate)}`, c.money(it.amount))}
    </div>`).join('');
  const t = c.totals;
  return `<article class="nd nd--${e(doc.format)} nd--${e(doc.type)} nd-thermal">
    ${biz.logo ? `<img class="nd-logo" src="${e(biz.logo)}" alt="">` : ''}
    <div class="nt-brand dot">${e(biz.name || 'Your business')}</div>
    ${[biz.address, biz.phone, biz.taxId ? `${c.taxLabel === 'GST' ? 'GSTIN' : 'Tax ID'} ${biz.taxId}` : ''].filter(Boolean)
      .map((l) => `<div class="nt-center nt-muted">${multiline(l)}</div>`).join('')}
    <hr>
    <div class="nt-center nt-title"><span class="nd-led"></span>${e(c.type.title)}</div>
    ${line('No.', e(doc.number || 'Draft'))}
    ${line('Date', c.date(doc.issue_date))}
    ${c.type.dateLabel && doc.due_date ? line(e(c.type.dateLabel), c.date(doc.due_date)) : ''}
    ${client.name ? line(e(c.type.party), e(client.name)) : ''}
    <hr>
    ${items || '<div class="nt-center nt-muted">No items yet</div>'}
    <hr>
    ${c.type.hidePrices ? '' : `
      ${line('Subtotal', c.money(t.subtotal))}
      ${t.discount ? line('Discount', c.money(-t.discount)) : ''}
      ${taxRows(c).map(([k, val]) => line(e(k), c.money(val))).join('')}
      ${t.shipping ? line('Other', c.money(t.shipping)) : ''}
      <div class="nt-total"><span>Total</span><span class="dot">${c.money(t.total)}</span></div>
      ${c.type.payable && c.paid > 0 ? line('Paid', c.money(c.paid)) + line('Due', c.money(c.balance), 'nt-strong') : ''}
      ${opts.qrSrc && c.type.payable && c.balance > 0 ? `<figure class="nd-qr nt-qr"><img src="${e(opts.qrSrc)}" alt="UPI QR code"><figcaption>Scan to pay ${e(c.pay.upiId)}</figcaption></figure>` : ''}
    `}
    ${doc.notes ? `<hr><div class="nt-center nt-muted">${multiline(doc.notes)}</div>` : ''}
    <div class="nt-thanks dot">Thank you</div>
    ${stamp(doc)}
  </article>`;
}

export function renderDocument(doc, settings, opts = {}) {
  const c = ctx(doc, settings);
  return isThermal(doc.format) ? renderThermal(doc, settings, c, opts) : renderPage(doc, settings, c, opts);
}

// Physical page sizes, used to scale the preview and to set @page for print.
export const PAGE_SIZES = {
  a4: { w: 210, h: 297 },
  letter: { w: 215.9, h: 279.4 },
  a5: { w: 148, h: 210 },
  thermal80: { w: 80, h: null },
  thermal58: { w: 58, h: null },
};

// Receipts have no fixed height, so the caller passes the measured height in mm.
export function pageCss(format, heightMm = 200) {
  const size = PAGE_SIZES[format] || PAGE_SIZES.a4;
  return `@page { size: ${size.w}mm ${size.h || heightMm}mm; margin: 0; }`;
}
