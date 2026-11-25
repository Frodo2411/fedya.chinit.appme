// Склад: позиции и журнал движений общей Google Таблицы.
import { h, fill, field, select, openSheet, parseNum, money, fmtDate, toast } from './ui.js';
import { STOCK_VERSION, STOCK_ARCHIVE_VERSION, STOCK_OPS } from './sheet.js';
import { stockPositions } from './stock.js';
import { norm } from './search.js';

function getItems(app) {
  const archiving = new Set(app.sheet.outbox.filter((op) => op.op === 'archiveStock').map((op) => op.fields.item));
  const items = stockPositions(app.sheet.cache?.stock ?? [], app.sheet.orders());
  for (const item of items) if (archiving.has(item.id)) item.archived = true;
  return items;
}
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

function modelPicker(app, value = '') {
  const customValue = ':custom';
  const catalog = [...new Set(app.data.models.map((model) => model.model))]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  let chosen = !value || catalog.includes(value) ? value : customValue;
  let selectedBySearch = false;
  const custom = stockInput(chosen === customValue ? value : '', { maxLength: 120 });
  const customField = field('Своя модель или совместимость', custom);
  const target = h('div');
  const search = stockInput('', { type: 'search', placeholder: 'Например, iPhone 12 или Galaxy A54',
    oninput: () => draw(true) });
  function draw(typing = false) {
    const query = search.value.trim();
    const hits = query ? app.search.find(query).map((model) => model.model) : catalog;
    if (typing) {
      const words = (text) => norm(text).split(' ').sort().join(' ');
      const exact = query && hits.find((model) => words(model) === words(query));
      if (exact || selectedBySearch) chosen = exact || '';
      selectedBySearch = !!exact;
      customField.hidden = chosen !== customValue;
    }
    const models = [...new Set([...hits, ...(chosen && chosen !== customValue ? [chosen] : [])])];
    fill(target, field('Модель телефона', select([...models, { value: customValue, label: 'Указать самостоятельно' }],
      chosen, (next) => {
        chosen = next;
        selectedBySearch = false;
        customField.hidden = next !== customValue;
      }, { empty: 'Универсальная / без модели' })));
  }
  customField.hidden = chosen !== customValue;
  draw();
  return { el: h('div', {}, field('Найти модель', search), target, customField),
    value: () => chosen === customValue ? custom.value.trim() : chosen };
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
    const items = getItems(app).filter((x) => !x.archived && (x.name + ' ' + x.model).toLowerCase().replace(/ё/g, 'е').includes(q));
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
    const pending = s.outbox.filter((op) => STOCK_OPS.includes(op.op) || op.fields?.stockUse).length;
    const failed = s.failed.filter((op) => STOCK_OPS.includes(op.op));
    const refresh = h('button', { class: 'btn small', text: 'Обновить', disabled: s.busy, onclick: () => s.refresh() });
    const needsSetup = !s.connected || (s.version !== null && s.version < STOCK_VERSION);
    const badHeader = s.connected && !needsSetup && s.version !== null && !ready;
    const status = needsSetup ? (!s.connected ? 'Подключи Google Таблицу, чтобы вести склад.' : 'Для склада нужен Apps Script версии ' + STOCK_VERSION + '.')
      : badHeader ? 'Проверь заголовки листа «Склад (журнал)».' : '';
    const progress = s.error ? (ready ? 'Показаны последние остатки. ' : '') + s.error
      : s.busy ? (ready ? 'Обновляю остатки…' : 'Загружаю остатки…') : pending ? 'Складских операций в очереди: ' + pending
        : !ready && s.connected && !status ? 'Остатки ещё не загружены.' : '';
    fill(sync, status ? h('div', { class: 'banner warn', style: 'margin-bottom:12px' },
      h('div', { text: status }),
      h('div', { class: 'row wrap', style: 'margin-top:8px' }, needsSetup
        ? h('button', { class: 'btn small', text: 'Открыть «Google Таблица»', onclick: () => app.openSheetSetup() }) : refresh)) : null,
    progress ? h('div', { class: 'syncbar', role: 'status' }, h('span', { class: 'grow', text: progress }),
      !ready && !status && !s.busy ? refresh : null) : null,
    s.cache?.stockViewError ? h('div', { class: 'small muted', text: 'Лист остатков: ' + s.cache.stockViewError }) : null,
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
      refresh));
    drawItems();
  }
  return { el: root, draw };
}

function openStockEditor(app, item) {
  const name = stockInput(item?.name, { maxLength: 160 });
  const model = modelPicker(app, item?.model);
  const cost = stockInput(item?.cost, { inputmode: 'decimal' });
  const qty = stockInput('0', { inputmode: 'numeric' });
  const body = h('div', {},
    field('Название *', name), model.el,
    field('Закупочная цена за штуку, р. *', cost, 'Для набора укажи стоимость одной штуки.'),
    item ? null : field('Начальный остаток, шт.', qty));
  const modal = openSheet(item ? 'Изменить позицию' : 'Новая позиция', body, [
    h('button', { class: 'btn', text: 'Отмена', onclick: () => modal.close() }),
    h('button', { class: 'btn primary', text: 'Сохранить', onclick: () => {
      const price = parseNum(cost.value);
      const count = parseNum(qty.value);
      if (!name.value.trim()) return toast('Впиши название');
      if (price === null || price < 0 || price > MAX) return toast('Проверь закупочную цену');
      if (!item && (!Number.isSafeInteger(count) || count < 0 || count > MAX)) return toast('Впиши целое количество от 0 до ' + MAX);
      stockQueue(app, item ? 'editStock' : 'addStock', {
        item: item?.id, name: name.value.trim(), model: model.value(), cost: price, qty: item ? 0 : count,
      }, modal);
    } }),
  ]);
}

function openPosition(app, id) {
  const item = getItems(app).find((x) => x.id === id && !x.archived);
  if (!item) return;
  const body = h('div', {},
    h('p', { class: 'muted', text: [item.model, item.qty + ' шт. в наличии', money(item.cost) + ' / шт.'].filter(Boolean).join(' · ') }),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn small primary', text: 'Пополнить', onclick: () => { modal.close(); openMovement(app, { item, restock: true }); } }),
      h('button', { class: 'btn small', disabled: item.qty <= 0, text: 'Списать', onclick: () => { modal.close(); openMovement(app, { item }); } }),
      h('button', { class: 'btn small', text: 'Изменить позицию', onclick: () => { modal.close(); openStockEditor(app, item); } })),
    h('h2', { text: 'Движения' }),
    h('div', { class: 'list' }, item.history.slice().reverse()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map((row) => {
      const title = row.kind === 'editStock' ? 'Изменение позиции' : row.kind === 'addStock' ? 'Позиция добавлена'
        : row.qty > 0 ? 'Пополнение' : 'Списание';
      return h('div', { class: 'item' }, h('div', { class: 'grow' },
        h('div', { class: 't', text: title + (row.order ? ' · заказ №' + row.order : '') }),
        h('div', { class: 's', text: [fmtDate(String(row.date || '').slice(0, 10), true), money(row.cost) + ' / шт.', row.note].filter(Boolean).join(' · ') })),
      row.qty ? h('b', { class: 'nowrap', text: (row.qty > 0 ? '+' : '') + row.qty + ' шт.' }) : null);
    })));
  const deleteAvailable = app.sheet.version >= STOCK_ARCHIVE_VERSION;
  const modal = openSheet(item.name, body, [
    h('button', { class: 'btn danger', text: 'Удалить со склада', onclick: () => {
      if (!deleteAvailable) {
        app.openSheetSetup();
        return toast('Для удаления со склада обнови Apps Script до версии ' + STOCK_ARCHIVE_VERSION);
      }
      const latest = getItems(app).find((position) => position.id === id && !position.archived);
      if (!latest) { modal.close(); return; }
      if (!confirm('Удалить «' + latest.name + '» со склада? В архив уйдёт позиция с остатком ' + latest.qty + ' шт.')) return;
      stockQueue(app, 'archiveStock', { item: id, expectedQty: latest.qty }, modal);
    } }),
  ]);
}

function openMovement(app, { item, restock = false }) {
  const qty = stockInput('1', { inputmode: 'numeric' });
  const note = stockInput('', { maxLength: 500 });
  const body = h('div', {},
    h('p', { class: 'muted', text: [item.name, item.model, item.qty + ' шт. в наличии'].filter(Boolean).join(' · ') }),
    restock ? null : h('p', { class: 'small muted', text: 'Если деталь использована в ремонте, добавь её из формы заказа.' }),
    field('Количество, шт.', qty), field('Примечание', note));
  const modal = openSheet(restock ? 'Пополнить остаток' : 'Списать со склада отдельно', body, [
    h('button', { class: 'btn', text: 'Отмена', onclick: () => modal.close() }),
    h('button', { class: 'btn primary', text: restock ? 'Пополнить' : 'Списать', onclick: () => {
      const count = parseNum(qty.value);
      if (!Number.isSafeInteger(count) || count < 1 || count > MAX) return toast('Впиши целое количество от 1 до ' + MAX);
      const latest = getItems(app).find((x) => x.id === item.id);
      if (!restock && count > (latest?.qty || 0)) return toast('На складе осталось ' + (latest?.qty || 0) + ' шт.');
      stockQueue(app, 'moveStock', { item: item.id, qty: restock ? count : -count, note: note.value.trim() }, modal);
    } }),
  ]);
}

export function openOrderStockPicker(app, { model, initial, current, editing, estimates, onPick }) {
  const original = new Map(initial.map((part) => [part.item, part]));
  const canonical = app.findModel(model);
  const options = getItems(app)
    .map((item) => {
      const reserved = original.get(item.id)?.qty || 0;
      return { ...item, qty: item.archived ? reserved : item.qty + reserved };
    })
    .filter((item) => editing ? item.id === editing.item : !item.archived && item.qty > 0 && !current.some((part) => part.item === item.id))
    .map((item) => ({ ...item, priority: !item.model ? 1 : canonical && canonical === app.findModel(item.model) ? 2 : 0 }))
    .sort((a, b) => b.priority - a.priority);
  let chosen = editing ? options[0] : null;
  let replacement = editing?.replaces || '';
  const taken = new Set(current.filter((part) => part !== editing).map((part) => part.replaces).filter(Boolean));
  const planned = estimates.filter((part) => !taken.has(part.id));
  const inputQty = stockInput(editing?.qty || '1', { inputmode: 'numeric' });
  const choices = options.map((item) => ({
    value: item.id,
    label: [item.name, item.model, item.qty + ' шт.', money(original.get(item.id)?.cost ?? item.cost) + ' / шт.'].filter(Boolean).join(' · '),
  }));
  const body = h('div', {},
    options.length ? [
      editing ? h('p', { class: 'muted', text: choices[0].label })
        : field('Позиция на складе', select(choices, '', (id) => { chosen = options.find((item) => item.id === id); }, { empty: 'Выбрать' })),
      field('Количество, шт.', inputQty),
      planned.length ? field('Вместо позиции из расчёта', select(planned.map((part) => ({ value: part.id, label: part.name + ' · ' + money(part.cost) })),
        replacement, (value) => { replacement = value; }, { empty: 'Дополнительная деталь' }),
      'В выбранной позиции закупочная цена заменится складской.') : null,
    ] : h('div', { class: 'empty', text: 'Нет доступных позиций. Проверь остатки на складе.' }));
  const modal = openSheet(editing ? 'Деталь со склада' : 'Взять со склада', body, [
    h('button', { class: 'btn', text: 'Отмена', onclick: () => modal.close() }),
    options.length ? h('button', { class: 'btn primary', text: editing ? 'Применить' : 'Добавить', onclick: () => {
      if (!chosen) return toast('Выбери позицию на складе');
      const qty = parseNum(inputQty.value);
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > Math.min(MAX, chosen.qty)) {
        return toast('Доступно ' + Math.max(0, chosen.qty) + ' шт. Проверь количество.');
      }
      const cost = original.get(chosen.id)?.cost ?? chosen.cost;
      modal.close();
      onPick({ item: chosen.id, name: chosen.name, model: chosen.model, qty, cost: Number(cost), replaces: replacement });
    } }) : null,
  ]);
}
