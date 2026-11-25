// Склад: позиции и журнал движений общей Google Таблицы.
import { h, fill, field, select, openSheet, parseNum, money, fmtDate, toast } from './ui.js';
import { STOCK_VERSION, STOCK_OPS } from './sheet.js';

export function stockPositions(rows) {
  const items = new Map();
  for (const row of rows) {
    if (row.kind === 'addStock') items.set(row.item, { id: row.item, qty: 0, history: [] });
    const item = items.get(row.item);
    if (!item) continue;
    if (row.kind === 'addStock' || row.kind === 'editStock') {
      Object.assign(item, { name: row.name, model: row.model, cost: row.cost });
    }
    item.qty += Number(row.qty) || 0;
    item.history.push(row);
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.model.localeCompare(b.model, 'ru'));
}

const getItems = (app) => stockPositions(app.sheet.cache?.stock ?? []);
export const stockReady = (app) => app.sheet.connected && Array.isArray(app.sheet.cache?.stock);
const MAX = 1000000;

function stockQueue(app, kind, fields, modal) {
  app.sheet.add(kind, fields);
  modal.close();
  toast('Складская операция отправлена в очередь');
}

function stockInput(value = '', attrs = {}) {
  return h('input', { class: 'input', value, autocomplete: 'off', ...attrs });
}

export function createStockView(app) {
  const root = h('div');
  const sync = h('div');
  const list = h('div');
  const actions = h('div');
  const search = stockInput('', { type: 'search', placeholder: 'Название или модель', 'aria-label': 'Поиск по складу',
    oninput: () => drawItems() });
  root.append(h('h1', { text: 'Склад' }), sync, actions, search, list);

  function drawItems() {
    const q = search.value.trim().toLowerCase().replace(/ё/g, 'е');
    const items = getItems(app).filter((x) => (x.name + ' ' + x.model).toLowerCase().replace(/ё/g, 'е').includes(q));
    fill(list, items.length ? h('div', { class: 'list', style: 'margin-top:12px' }, items.map((item) =>
      h('button', { class: 'item', type: 'button', onclick: () => openPosition(app, item.id) },
        h('div', { class: 'grow' }, h('div', { class: 't', text: item.name }),
          h('div', { class: 's', text: [item.model, money(item.cost) + ' / шт.'].filter(Boolean).join(' · ') })),
        h('b', { class: 'nowrap', text: item.qty + ' шт.' }))))
      : h('div', { class: 'empty', text: q ? 'Ничего не нашлось.' : 'На складе пока нет позиций.' }));
  }

  function draw() {
    const s = app.sheet;
    const ready = stockReady(app);
    const pending = s.outbox.filter((op) => STOCK_OPS.includes(op.op)).length;
    const failed = s.failed.filter((op) => STOCK_OPS.includes(op.op));
    const refresh = h('button', { class: 'btn small', text: 'Обновить', disabled: s.busy, onclick: () => s.refresh() });
    const status = !s.connected ? 'Подключи Google Таблицу, чтобы вести склад.'
      : s.version !== null && s.version < STOCK_VERSION ? 'Для склада нужен Apps Script версии ' + STOCK_VERSION + '.'
      : s.error || (s.busy ? 'Связь с таблицей…' : s.version === null ? 'Склад ещё не загружен.'
        : !ready ? 'Проверь заголовки листа «Склад (журнал)».' : '');
    fill(sync, status ? h('div', { class: 'banner', style: 'margin-bottom:12px' },
      h('div', { text: status }),
      h('div', { class: 'row wrap', style: 'margin-top:8px' },
        !s.connected || (s.version !== null && s.version < STOCK_VERSION)
          ? h('button', { class: 'btn small', text: 'Открыть «Google Таблица»', onclick: () => app.openSheetSetup() }) : null,
        s.connected ? refresh : null)) : null,
    pending ? h('div', { class: 'small muted', style: 'margin-bottom:8px', text: 'Складских операций ждут синхронизации: ' + pending }) : null,
    failed.map((op) => h('div', { class: 'banner bad', style: 'margin-bottom:10px' },
      h('div', { text: 'Складская операция не записалась. ' + op.error }),
      h('div', { class: 'row wrap', style: 'margin-top:8px' },
        h('button', { class: 'btn small', text: 'Повторить', onclick: () => {
          s.dropFailed(op.id);
          const { error, ...retry } = op;
          s.outbox.push(retry);
          s.save();
          s.flush();
        } }),
        h('button', { class: 'btn small ghost', text: 'Убрать', onclick: () => s.dropFailed(op.id) })))));
    search.hidden = list.hidden = actions.hidden = !ready;
    if (!ready) return;
    fill(actions, h('div', { class: 'row wrap', style: 'margin-bottom:12px' },
      h('button', { class: 'btn small primary', text: '+ Позиция', onclick: () => openStockEditor(app) }),
      status ? null : refresh));
    drawItems();
  }
  return { el: root, draw };
}

function openStockEditor(app, item) {
  const name = stockInput(item?.name, { maxLength: 160 });
  const model = stockInput(item?.model, { maxLength: 120 });
  const cost = stockInput(item?.cost, { inputmode: 'decimal' });
  const qty = stockInput('0', { inputmode: 'numeric' });
  const body = h('div', {},
    field('Название *', name), field('Модель или совместимость', model),
    field('Закупочная цена за штуку, р. *', cost), item ? null : field('Начальный остаток, шт.', qty));
  const modal = openSheet(item ? 'Изменить позицию' : 'Новая позиция', body, [
    h('button', { class: 'btn', text: 'Отмена', onclick: () => modal.close() }),
    h('button', { class: 'btn primary', text: 'Сохранить', onclick: () => {
      const price = parseNum(cost.value);
      const count = parseNum(qty.value);
      if (!name.value.trim()) return toast('Впиши название');
      if (price === null || price < 0 || price > MAX) return toast('Проверь закупочную цену');
      if (!item && (!Number.isSafeInteger(count) || count < 0 || count > MAX)) return toast('Впиши целое количество от 0 до ' + MAX);
      stockQueue(app, item ? 'editStock' : 'addStock', {
        item: item?.id, name: name.value.trim(), model: model.value.trim(), cost: price, qty: item ? 0 : count,
      }, modal);
    } }),
  ]);
}

function openPosition(app, id) {
  const item = getItems(app).find((x) => x.id === id);
  if (!item) return;
  const body = h('div', {},
    h('p', { class: 'muted', text: [item.model, item.qty + ' шт. в наличии', money(item.cost) + ' / шт.'].filter(Boolean).join(' · ') }),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn small primary', text: 'Пополнить', onclick: () => { modal.close(); openMovement(app, { item, restock: true }); } }),
      h('button', { class: 'btn small', disabled: item.qty <= 0, text: 'Списать', onclick: () => { modal.close(); openMovement(app, { item }); } }),
      h('button', { class: 'btn small', text: 'Изменить позицию', onclick: () => { modal.close(); openStockEditor(app, item); } })),
    h('h2', { text: 'Движения' }),
    h('div', { class: 'list' }, item.history.slice().reverse().map((row) => {
      const title = row.kind === 'editStock' ? 'Изменение позиции' : row.kind === 'addStock' ? 'Позиция добавлена'
        : row.qty > 0 ? 'Пополнение' : 'Списание';
      return h('div', { class: 'item' }, h('div', { class: 'grow' },
        h('div', { class: 't', text: title + (row.order ? ' · заказ №' + row.order : '') }),
        h('div', { class: 's', text: [fmtDate(String(row.date || '').slice(0, 10), true), money(row.cost) + ' / шт.', row.note].filter(Boolean).join(' · ') })),
      row.qty ? h('b', { class: 'nowrap', text: (row.qty > 0 ? '+' : '') + row.qty + ' шт.' }) : null);
    })));
  const modal = openSheet(item.name, body);
}

export function openOrderStock(app, order) {
  openMovement(app, { order });
}

function openMovement(app, { item, order, restock = false }) {
  const available = getItems(app).filter((x) => x.qty > 0);
  let current = item;
  const qty = stockInput('1', { inputmode: 'numeric' });
  const note = stockInput('', { maxLength: 500 });
  const forOrder = order ? ' для заказа №' + order.num : '';
  const options = available.map((x) => ({
    value: x.id, label: [x.name, x.model, x.qty + ' шт.'].filter(Boolean).join(' · '),
  }));
  const body = h('div', {},
    item ? h('p', { class: 'muted', text: [item.name, item.model, item.qty + ' шт. в наличии'].filter(Boolean).join(' · ') })
      : available.length ? field('Позиция на складе', select(options, '', (value) => { current = available.find((x) => x.id === value); },
        { empty: 'Выбрать' })) : h('div', { class: 'empty', text: 'На складе нет позиций в наличии.' }),
    item || available.length ? [field('Количество, шт.', qty), field('Примечание', note)] : null);
  const modal = openSheet(restock ? 'Пополнить остаток' : 'Списать' + forOrder, body, [
    h('button', { class: 'btn', text: 'Отмена', onclick: () => modal.close() }),
    item || available.length ? h('button', { class: 'btn primary', text: restock ? 'Пополнить' : 'Списать', onclick: () => {
      if (!current) return toast('Выбери позицию на складе');
      const count = parseNum(qty.value);
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX) return toast('Впиши целое количество от 1 до ' + MAX);
      const latest = getItems(app).find((x) => x.id === current.id);
      if (!restock && count > (latest?.qty || 0)) return toast('На складе осталось ' + (latest?.qty || 0) + ' шт.');
      stockQueue(app, 'moveStock', { item: current.id, qty: restock ? count : -count, order: order?.num, note: note.value.trim() }, modal);
    } }) : null,
  ]);
}
