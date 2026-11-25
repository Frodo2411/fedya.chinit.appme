// Склад: позиции и журнал движений общей Google Таблицы.
import { h, fill, field, select, openSheet, parseNum, money, fmtDate, toast } from './ui.js';
import { STOCK_VERSION, STOCK_ARCHIVE_VERSION, STOCK_OPS } from './sheet.js';
import { currentStock } from './stock.js';
import { norm } from './search.js';

export const stockReady = (app) => app.sheet.connected && Array.isArray(app.sheet.cache?.stock);
const MAX = 1000000;
const MODEL_TEXT_LIMIT = 120;

function stockQueue(app, kind, fields, modal) {
  app.sheet.add(kind, fields);
  modal.close();
  toast('Складская операция отправлена в очередь');
}

function stockInput(value = '', attrs = {}) {
  return h('input', { class: 'input', value, autocomplete: 'off', ...attrs });
}

const modelKey = (text) => norm(text).split(' ').sort().join(' ');

function modelPicker(app, value = '') {
  const catalog = new Map(app.data.models.map(({ model }) => [modelKey(model), model]));
  const chosen = new Set();
  const unlisted = [];
  for (const name of compatibleModelNames(value)) {
    const canonical = catalog.get(modelKey(name));
    if (canonical) chosen.add(canonical);
    else unlisted.push(name);
  }
  const selected = h('div');
  const results = h('div');
  const custom = stockInput(unlisted.join(', '), { maxLength: MODEL_TEXT_LIMIT, placeholder: 'Названия через запятую' });
  const search = stockInput('', { type: 'search', placeholder: 'Например, айфон 15 или Galaxy A54',
    oninput: () => drawResults() });
  function drawSelected() {
    fill(selected, chosen.size ? h('div', { class: 'chips', style: 'margin:8px 0' }, [...chosen].map((name) =>
      h('button', { type: 'button', class: 'chip on', 'aria-label': 'Убрать ' + name, text: name + ' ×',
        onclick: () => {
          chosen.delete(name);
          drawSelected();
          drawResults();
        } }))) : null);
  }
  function drawResults() {
    const query = search.value.trim();
    const hits = query ? [...new Set(app.search.find(query).map((entry) => entry.model))] : [];
    fill(results, hits.length ? h('div', { class: 'list', style: 'max-height:min(32vh,230px);overflow-y:auto' },
      hits.map((name) => h('label', { class: 'item' },
        h('input', { type: 'checkbox', checked: chosen.has(name), onchange: (e) => {
          if (e.target.checked) chosen.add(name);
          else chosen.delete(name);
          drawSelected();
        } }), name)))
      : query ? h('div', { class: 'small muted', text: 'Модели не найдены.' }) : null);
  }
  drawSelected();
  return {
    el: h('div', {}, field('Совместимые модели', search), selected, results,
      h('details', { open: unlisted.length > 0, style: 'margin-top:8px' },
        h('summary', { class: 'small muted', text: 'Указать модели вручную' }), field('Совместимость', custom))),
    value: () => [...new Set([...chosen, ...compatibleModelNames(custom.value)])].join(', '),
  };
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
    const q = search.value.trim();
    const items = filterStock(app, currentStock(app.sheet).filter((item) => !item.archived), q);
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
      const compatibility = model.value();
      if (!name.value.trim()) return toast('Впиши название');
      if (price === null || price < 0 || price > MAX) return toast('Проверь закупочную цену');
      if (!item && (!Number.isSafeInteger(count) || count < 0 || count > MAX)) return toast('Впиши целое количество от 0 до ' + MAX);
      if (compatibility.length > MODEL_TEXT_LIMIT) return toast('Сократи список совместимых моделей до ' + MODEL_TEXT_LIMIT + ' символов');
      stockQueue(app, item ? 'editStock' : 'addStock', {
        item: item?.id, name: name.value.trim(), model: compatibility, cost: price, qty: item ? 0 : count,
      }, modal);
    } }),
  ]);
}

function openPosition(app, id) {
  const item = currentStock(app.sheet).find((x) => x.id === id && !x.archived);
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
      const latest = currentStock(app.sheet).find((position) => position.id === id && !position.archived);
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
      const latest = currentStock(app.sheet).find((x) => x.id === item.id);
      if (!restock && count > (latest?.qty || 0)) return toast('На складе осталось ' + (latest?.qty || 0) + ' шт.');
      stockQueue(app, 'moveStock', { item: item.id, qty: restock ? count : -count, note: note.value.trim() }, modal);
    } }),
  ]);
}

function compatibleModelNames(model) {
  const names = String(model || '').trim().split(/\s*(?:[,;/|]|\s+и\s+)\s*/i);
  const prefix = names[0].match(/^[^\d]+/)?.[0] || '';
  return names.map((name, i) => i && /^\d/.test(name) ? prefix + name : name).filter(Boolean);
}

function hasModel(item, key) {
  return compatibleModelNames(item.model).some((name) => modelKey(name) === key);
}

function filterStock(app, items, input) {
  const query = input.trim().toLowerCase().replace(/ё/g, 'е');
  if (!query) return items;
  const key = modelKey(query);
  if (key && app.search.find(query).some((entry) => modelKey(entry.model) === key)) {
    return items.filter((item) => hasModel(item, key));
  }
  const terms = key.split(' ').filter(Boolean);
  return items.filter((item) => {
    const text = (item.name + ' ' + item.model).toLowerCase().replace(/ё/g, 'е');
    const words = norm(text).split(' ');
    return text.includes(query) || (terms.length > 0 && terms.every((term) => words.some((word) => word.startsWith(term))));
  });
}

export function openOrderStockPicker(app, { model, initial, current, editing, estimates, onPick }) {
  const original = new Map(initial.map((part) => [part.item, part]));
  const canonical = app.findModel(model);
  const key = canonical ? modelKey(canonical) : '';
  const options = currentStock(app.sheet)
    .map((item) => {
      const reserved = original.get(item.id)?.qty || 0;
      return { ...item, qty: item.archived ? reserved : item.qty + reserved };
    })
    .filter((item) => editing ? item.id === editing.item : !item.archived && item.qty > 0 && !current.some((part) => part.item === item.id))
    .map((item) => ({ ...item, priority: !item.model ? 1 : key && hasModel(item, key) ? 2 : 0 }))
    .sort((a, b) => b.priority - a.priority);
  let chosen = editing ? options[0] : null;
  let replacement = editing?.replaces || '';
  const taken = new Set(current.filter((part) => part !== editing).map((part) => part.replaces).filter(Boolean));
  const planned = estimates.filter((part) => !taken.has(part.id));
  const inputQty = stockInput(editing?.qty || '1', { inputmode: 'numeric' });
  const label = (item) => [item.model, item.qty + ' шт.', money(original.get(item.id)?.cost ?? item.cost) + ' / шт.']
    .filter(Boolean).join(' · ');
  const matches = h('div');
  const search = stockInput(canonical || '', { type: 'search', placeholder: 'Например, айфон 12 или проклейка',
    oninput: () => drawMatches() });
  function drawMatches() {
    const rows = filterStock(app, options, search.value);
    if (chosen && !rows.includes(chosen)) chosen = null;
    fill(matches, rows.length ? h('div', { class: 'list', style: 'max-height:min(38vh,280px);overflow-y:auto' },
      rows.map((item) => h('button', { class: 'item', type: 'button', 'aria-pressed': String(chosen === item),
        onclick: () => { chosen = item; drawMatches(); } },
      h('div', { class: 'grow' }, h('div', { class: 't', text: item.name }), h('div', { class: 's', text: label(item) })),
      chosen === item ? h('span', { class: 'badge', text: 'Выбрано' }) : null)))
      : h('div', { class: 'empty', text: 'По этому запросу деталей в наличии нет.' }));
  }
  if (!editing && options.length) drawMatches();
  const body = h('div', {},
    options.length ? [
      editing ? h('p', { class: 'muted', text: chosen.name + ' · ' + label(chosen) })
        : [field('Найти модель или деталь', search), matches],
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
