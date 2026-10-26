// Экран «Корзина»: детали, которые надо купить, по поставщикам — где, что, сколько и почём.
// Добавляются кнопкой «В корзину» в «Ценах». Купленное отмечается галочкой.

import { h, fill, icon, money, toast, copyText, openSheet } from './ui.js';
import { cartGroups, cartText, cartCount, cartReplace } from './cart.js';
import { OWN_NAME, OWN } from './engine.js';
import { linkify, supplierStock } from './view-prices.js';

export function createCartView(app) {
  const root = h('div');
  const cart = () => app.settings.cart || [];
  const save = (next) => app.saveSettings({ cart: next });
  const update = (id, patch) => save(cart().map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const supName = (k) => {
    const s = app.pricer.data.suppliers[k];
    return (s && s.name) || (k === OWN ? OWN_NAME : 'Поставщика больше нет в прайсе');
  };
  // другие детали того же варианта — купить у другого поставщика
  const alternatives = (x) => (x.model && x.svc && x.tier && !x.glue ? app.pricer.partsFor(x.model, x.svc, x.tier) : []);

  function openSwap(x) {
    const rows = alternatives(x);
    const body = h('div', {},
      h('div', { class: 'small muted', style: 'margin-top:8px', text: (x.uses || [])[0] || x.name }),
      h('div', { class: 'others' }, rows.map((r) => h('div', { class: 'other' },
        h('div', { class: 'grow' },
          h('div', { class: 'small' }, h('b', { text: supName(r.sup) + ' · ' + money(r.cost) }), ' ', supplierStock(app, r.sup, r.stock)),
          h('div', { class: 'tiny muted break', text: r.name })),
        r.sup === x.sup && r.name === x.name ? h('span', { class: 'small on', text: 'в корзине' })
          : h('button', {
            class: 'btn small', text: 'Выбрать',
            onclick: () => { save(cartReplace(cart(), x.id, r)); sheet.close(); toast('Теперь у поставщика ' + supName(r.sup)); },
          })))));
    const sheet = openSheet('Купить у другого', body, [h('button', { class: 'btn', text: 'Закрыть', onclick: () => sheet.close() })]);
  }

  function itemRow(x) {
    const alts = alternatives(x).length;
    return h('div', { class: 'cart-item' + (x.done ? ' done' : '') },
      h('input', { type: 'checkbox', class: 'cart-check', checked: x.done, 'aria-label': 'Куплено', onchange: (e) => update(x.id, { done: e.target.checked }) }),
      h('div', { class: 'grow' },
        h('button', {
          class: 'cart-name', 'aria-label': 'Скопировать название', text: x.name,
          onclick: async () => { if (await copyText(x.name)) toast('Название скопировано'); },
        }),
        h('div', { class: 'cart-meta tiny muted' },
          (x.uses || []).length ? h('span', { text: 'для ' + x.uses.join('; ') }) : null,
          x.gone ? h('span', { class: 'badge bad', text: 'нет в прайсе' }) : supplierStock(app, x.sup, x.stock)),
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('div', { class: 'qty' },
            h('button', { 'aria-label': 'Меньше', text: '−', disabled: x.qty <= 1, onclick: () => update(x.id, { qty: x.qty - 1 }) }),
            h('span', { text: x.qty + ' шт.' }),
            h('button', { 'aria-label': 'Больше', text: '+', onclick: () => update(x.id, { qty: x.qty + 1 }) })),
          alts > 1 ? h('button', { class: 'link', text: 'Другой поставщик', onclick: () => openSwap(x) }) : null,
          h('span', { class: 'grow' }),
          h('b', { class: 'nowrap', text: money(Math.round((x.cost || 0) * x.qty * 100) / 100) }),
          h('button', { class: 'cart-x', 'aria-label': 'Убрать из корзины', text: '✕', onclick: () => save(cart().filter((y) => y.id !== x.id)) }))));
  }

  function group(g) {
    const site = app.supplierSite(g.sup);
    const note = (app.settings.supplierNotes || {})[g.sup];
    return h('div', { class: 'card cart-group' },
      h('div', { class: 'row' }, h('h3', { class: 'grow', style: 'margin:0', text: supName(g.sup) }),
        h('b', { class: 'nowrap', text: g.left ? money(g.total) : 'всё куплено ✓' })),
      g.left ? h('div', { class: 'tiny muted', text: 'купить: ' + g.left + ' поз.' }) : null,
      note ? h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Как заказать: ', linkify(note)) : null,
      h('div', { class: 'row wrap', style: 'margin-top:10px' },
        site ? h('a', { class: 'btn small', href: site, target: '_blank', rel: 'noopener' }, 'Открыть ' + site.replace(/^https?:\/\//, '').replace(/\/$/, '') + ' ↗') : null,
        g.left ? h('button', {
          class: 'btn small', onclick: async () => { if (await copyText(cartText(supName(g.sup), g.items))) toast('Список скопирован'); },
        }, icon('copy'), 'Скопировать список') : null),
      h('div', { class: 'cart-items' }, g.items.map(itemRow)));
  }

  function draw() {
    const items = cart();
    if (!items.length) {
      fill(root, h('h1', { text: 'Корзина' }),
        h('div', { class: 'empty' }, 'Корзина пустая.', h('br'), 'В «Ценах» у детали нажми «В корзину» — здесь будет видно, что у какого поставщика купить.'));
      return;
    }
    const groups = cartGroups(items, app.pricer.data);
    const total = Math.round(groups.reduce((a, g) => a + g.total, 0) * 100) / 100;
    const left = cartCount(items);
    const bought = items.length - left;
    fill(root,
      h('h1', { text: 'Корзина' }),
      h('div', { class: 'small muted', text: left ? 'Купить: ' + left + ' поз. на ' + money(total) + ' у ' + groups.filter((g) => g.left).length + ' пост.' : 'Всё куплено ✓' }),
      h('div', { class: 'row wrap', style: 'margin:12px 0 14px' },
        left ? h('button', {
          class: 'btn small', onclick: async () => {
            const text = groups.filter((g) => g.left).map((g) => cartText(supName(g.sup), g.items)).join('\n\n');
            if (await copyText(text)) toast('Вся корзина скопирована');
          },
        }, icon('copy'), 'Скопировать всё') : null,
        bought ? h('button', { class: 'btn small', text: 'Убрать купленное · ' + bought, onclick: () => save(items.filter((x) => !x.done)) }) : null,
        h('button', { class: 'btn small danger', text: 'Очистить', onclick: () => { if (confirm('Убрать из корзины всё?')) save([]); } })),
      groups.map(group),
      h('div', { class: 'tiny faint', style: 'margin-top:12px', text: 'Цены и наличие — по последним прайсам. Нажми на название — оно скопируется, останется вставить в поиск на сайте поставщика. Корзина хранится вместе с настройками: при подключённой Google Таблице она одна и та же на телефоне и на компьютере.' }));
  }

  return { el: root, draw };
}
