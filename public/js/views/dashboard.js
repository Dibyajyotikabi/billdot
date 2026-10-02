import { get, post } from '../api.js';
import { icons } from '../icons.js';
import { esc, money, date, timeAgo, statusPill, store, toast, toastError, emptyState } from '../ui.js';
import { DOC_TYPES } from '../shared/doc-types.js';

const MONTH = (key) => new Date(`${key}-01T00:00:00`).toLocaleDateString('en', { month: 'short' }).toUpperCase();

// Bars drawn as stacked dots, like a dot-matrix display.
function dotChart(months, currency) {
  const ROWS = 10;
  const max = Math.max(...months.map((m) => m.amount), 1);
  const colW = 100 / months.length;
  const cell = 9;
  const height = ROWS * cell + 26;
  const width = 600;
  const cols = months.map((m, i) => {
    const filled = m.amount > 0 ? Math.max(1, Math.round((m.amount / max) * ROWS)) : 0;
    const cx0 = (i * colW + colW / 2) * (width / 100);
    const isLast = i === months.length - 1;
    const dots = [];
    for (let r = 0; r < ROWS; r += 1) {
      const on = r < filled;
      for (let k = -2; k <= 2; k += 1) {
        const fill = on ? (isLast ? 'var(--red)' : 'var(--ink)') : 'var(--line)';
        dots.push(`<circle cx="${cx0 + k * cell}" cy="${(ROWS - 1 - r) * cell + 5}" r="3" fill="${fill}"/>`);
      }
    }
    return `<g><title>${MONTH(m.month)}: ${esc(money(m.amount, currency))}</title>${dots.join('')}
      <text x="${cx0}" y="${height - 4}" text-anchor="middle">${MONTH(m.month)}</text></g>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Payments collected over the last six months">${cols.join('')}</svg>`;
}

function attentionRow(d) {
  const claimed = d.display_status === 'claimed';
  return `<li class="list-row">
    <a href="#/doc/${d.id}" style="text-decoration:none;min-width:0">
      <div class="t">${esc(d.client?.name || 'No client')} <span class="muted mono" style="font-size:12px">${esc(d.number)}</span></div>
      <div class="s">${claimed ? `Client says paid${d.claim?.reference ? `, ref ${esc(d.claim.reference)}` : ''}` : `Due ${esc(date(d.due_date))}`} · ${esc(money(d.balance, d.currency))}</div>
    </a>
    <div class="row" style="gap:8px">${statusPill(d.display_status)}
      <button class="btn btn--sm ${claimed ? 'btn--primary' : ''}" data-paid="${d.id}" type="button">${icons.check}<span>Paid</span></button></div>
  </li>`;
}

function feedRow(a) {
  return `<li class="feed-row k-${esc(a.kind)}"><span class="led"></span>
    <div>${a.document_id ? `<a href="#/doc/${a.document_id}" style="text-decoration:none">${esc(a.message)}</a>` : esc(a.message)}
    <time datetime="${esc(a.created_at)}">${esc(timeAgo(a.created_at))}</time></div></li>`;
}

function view(d) {
  const cur = d.currency || store.settings.documents.currency;
  const name = store.settings.business.name;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const quick = ['invoice', 'quote', 'receipt', 'delivery_note'].map((t) => `<a class="quick" href="#/new/${t}">
      <span class="label">${t === 'receipt' ? 'Small bill' : 'New'}</span><b>${esc(DOC_TYPES[t].label)}</b></a>`).join('');
  return `
  <div class="page-head">
    <div><div class="label">${esc(hello)}${name ? `, ${esc(name)}` : ''}</div><h1 class="page-title">Overview</h1></div>
    <div class="page-actions"><a class="btn btn--primary" href="#/new/invoice">${icons.plus}<span>New invoice</span></a></div>
  </div>
  <div class="dash">
    <section class="card hero-kpi" aria-label="Outstanding">
      <div class="row-between"><span class="label">Outstanding</span><span class="led led--pulse"></span></div>
      <div class="hero-value">${esc(money(d.outstanding, cur))}</div>
      <div class="hero-sub"><span><b>${d.outstandingCount}</b> open invoice${d.outstandingCount === 1 ? '' : 's'}</span>
        <span><b>${d.drafts}</b> draft${d.drafts === 1 ? '' : 's'}</span><span><b>${d.openQuotes}</b> open quote${d.openQuotes === 1 ? '' : 's'}</span></div>
    </section>
    <div class="kpi-stack">
      <a class="card kpi ${d.overdueCount ? 'kpi--red' : ''}" href="#/documents?type=invoice&status=overdue" style="text-decoration:none">
        <span class="label">Overdue · ${d.overdueCount}</span><span class="kpi-value">${esc(money(d.overdue, cur))}</span></a>
      <div class="card kpi"><span class="label">Collected this month</span><span class="kpi-value">${esc(money(d.collectedThisMonth, cur))}</span></div>
    </div>
    <section class="card chart-card"><div class="card-head"><span class="label">Collected · last 6 months</span></div>
      <div class="chart">${dotChart(d.months, cur)}</div></section>
    <section class="card quick-card"><span class="label">Create</span><div class="quick-grid">${quick}</div></section>
    <section class="card attention-card"><div class="card-head"><span class="label">Needs attention</span></div>
      ${d.attention.length ? `<ul class="list">${d.attention.map(attentionRow).join('')}</ul>`
        : emptyState('All clear', 'Nothing overdue and no payments waiting for your check.')}</section>
    <section class="card activity-card"><div class="card-head"><span class="label">Activity</span></div>
      ${d.activity.length ? `<ul class="list">${d.activity.map(feedRow).join('')}</ul>`
        : emptyState('Quiet', 'Your activity shows up here.')}</section>
  </div>`;
}

export async function mount(el) {
  const load = async () => {
    el.innerHTML = view(await get('/dashboard'));
  };
  await load();
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-paid]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await post(`/documents/${btn.dataset.paid}/paid`);
      toast('Marked as paid');
      await load();
    } catch (err) {
      toastError(err);
      btn.disabled = false;
    }
  });
  return { refresh: () => load().catch(() => {}) };
}
