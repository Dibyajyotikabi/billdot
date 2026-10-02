import { get, post, put, del } from '../api.js';
import { icons } from '../icons.js';
import { $, esc, money, store, debounce, toast, toastError, modal, confirmDialog, emptyState } from '../ui.js';

const itemForm = (it = {}) => {
  const tax = it.tax_rate ?? store.settings.documents.defaultTaxRate;
  return `<div class="stack" style="gap:12px">
    <label class="field"><span>Name</span><input class="input" name="name" value="${esc(it.name || '')}" required autofocus></label>
    <label class="field"><span>Description</span><textarea class="textarea" name="description" rows="2">${esc(it.description || '')}</textarea></label>
    <div class="grid-3">
      <label class="field"><span>Rate</span><input class="input mono" name="rate" inputmode="decimal" value="${esc(it.rate ?? '')}"></label>
      <label class="field"><span>Unit</span><input class="input" name="unit" value="${esc(it.unit || '')}" placeholder="hr, pc, month"></label>
      <label class="field"><span>${esc(store.settings.documents.taxLabel)} %</span><input class="input mono" name="tax_rate" inputmode="decimal" value="${esc(tax)}"></label>
    </div>
  </div>`;
};

function table(list) {
  if (!list.length) return '';
  const cur = store.settings.documents.currency;
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Item</th><th class="r">Rate</th><th class="r hide-sm">${esc(store.settings.documents.taxLabel)}</th><th class="r hide-sm">Used</th><th></th></tr></thead>
    <tbody>${list.map((it) => `<tr data-id="${it.id}" tabindex="0">
      <td><span class="strong">${esc(it.name)}</span>${it.description ? `<div class="sub">${esc(it.description)}</div>` : ''}</td>
      <td class="r num">${esc(money(it.rate, cur))}${it.unit ? `<div class="sub">per ${esc(it.unit)}</div>` : ''}</td>
      <td class="r num hide-sm">${esc(it.tax_rate)}%</td>
      <td class="r num hide-sm">${it.usage_count}</td>
      <td class="r"><button class="btn btn--ghost btn--icon btn--sm" data-rm="${it.id}" aria-label="Delete ${esc(it.name)}">${icons.trash}</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

export async function mount(el) {
  let q = '';
  let list = [];
  el.innerHTML = `
    <div class="page-head">
      <div><div class="label">Catalog</div><h1 class="page-title">Items</h1></div>
      <div class="page-actions"><button class="btn btn--primary" data-new>${icons.plus}<span>New item</span></button></div>
    </div>
    <p class="muted" style="margin:-8px 0 18px;max-width:60ch">Every line you bill is saved here with its latest price, so it fills in next time you type it.</p>
    <div class="toolbar" style="margin-bottom:18px"><input class="search" type="search" placeholder="Search items" aria-label="Search items"></div>
    <div class="card" data-results><div class="skeleton" style="height:160px"></div></div>`;

  const results = $('[data-results]', el);
  let seq = 0;
  const load = async () => {
    const mine = ++seq;
    const found = await get(`/items${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (mine !== seq) return;
    list = found;
    results.innerHTML = table(list) || emptyState(q ? 'No match' : 'No items yet',
      q ? 'Try another word.' : 'Add your services and products, or just start billing.');
  };

  const edit = async (it) => {
    const data = await modal({ title: it ? 'Edit item' : 'New item', body: itemForm(it), submit: 'Save item' });
    if (!data) return;
    try {
      await (it ? put(`/items/${it.id}`, data) : post('/items', data));
      toast('Item saved');
      await load();
    } catch (err) { toastError(err); }
  };

  el.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const it = list.find((x) => x.id === Number(rm.dataset.rm));
      if (!await confirmDialog(`Delete ${it.name}?`, 'Documents that already use it are not changed.', { submit: 'Delete', danger: true })) return;
      try {
        await del(`/items/${it.id}`);
        toast('Item deleted');
        await load();
      } catch (err) { toastError(err); }
      return;
    }
    if (e.target.closest('[data-new]')) return edit(null);
    const row = e.target.closest('tr[data-id]');
    if (row) edit(list.find((x) => x.id === Number(row.dataset.id)));
  });
  el.addEventListener('keydown', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row && e.key === 'Enter' && e.target === row) edit(list.find((x) => x.id === Number(row.dataset.id)));
  });
  const search = debounce(load, 220);
  $('.search', el).addEventListener('input', (e) => { q = e.target.value.trim(); search(); });
  await load();
}
