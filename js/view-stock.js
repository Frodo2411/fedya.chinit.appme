// Склад: позиции и журнал движений общей Google Таблицы.
import { h, fill, icon, field, select, openSheet, parseNum, money, fmtDate, toast } from './ui.js';
import { STOCK_VERSION, STOCK_ARCHIVE_VERSION, STOCK_OPS } from './sheet.js';
import { currentStock, stockCost } from './stock.js';
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

function searchField(input, onClear) {
  const clear = h('button', { class: 'clear', type: 'button', 'aria-label': 'Очистить', text: '✕', hidden: !input.value,
    onclick: () => { input.value = ''; clear.hidden = true; onClear(); input.focus(); } });
  input.addEventListener('input', () => { clear.hidden = !input.value; });
  return { el: h('div', { class: 'search-wrap' }, input, clear), clear };
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
  const limitHint = h('div', { class: 'tiny faint', style: 'margin-top:4px' });
  const custom = stockInput(unlisted.join(', '), { maxLength: MODEL_TEXT_LIMIT, placeholder: 'Названия через запятую',
    oninput: () => drawLimit() });
  const search = stockInput('', { type: 'search', placeholder: 'Например, айфон 15 или Galaxy A54',
    oninput: () => drawResults() });
  const searchWrap = searchField(search, () => drawResults());
  const combined = () => [...new Set([...chosen, ...compatibleModelNames(custom.value)])].join(', ');
  function drawLimit() {
    const len = combined().length;
    limitHint.textContent = len > 80 ? 'Длина списка: ' + len + ' из ' + MODEL_TEXT_LIMIT + ' симв.' : '';
    limitHint.style.color = len > MODEL_TEXT_LIMIT ? 'var(--bad)' : '';
  }
  function drawSelected() {
    fill(selected, chosen.size ? h('div', { class: 'chips', style: 'margin:8px 0' }, [...chosen].map((name) =>
      h('button', { type: 'button', class: 'chip on', 'aria-label': 'Убрать ' + name, text: name + ' ×',
        onclick: () => {
          chosen.delete(name);
          drawSelected();
          drawResults();
          drawLimit();
        } }))) : null);
    drawLimit();
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
    el: h('div', {}, field('Совместимые модели', searchWrap.el), selected, limitHint, results,
      h('details', { open: unlisted.length > 0, style: 'margin-top:8px' },
        h('summary', { class: 'small muted', text: 'Указать модели вручную' }), field('Совместимость', custom))),
    value: combined,
  };
}

export function createStockView(app) {
  const root = h('div');
  const sync = h('div');
  const summary = h('div', { class: 'small muted', style: 'margin-bottom:10px' });
  const list = h('div');
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Название или модель', 'aria-label': 'Поиск по складу',
    autocomplete: 'off', autocorrect: 'off', spellcheck: false, oninput: () => drawItems() });
  const searchBox = h('div', { class: 'searchbar', style: 'padding-top:0;margin-top:0;top:var(--safe-t)' }, searchField(search, () => drawItems()).el);
  const fab = h('button', { class: 'fab', onclick: () => openStockEditor(app) }, icon('plus'), 'Позиция');
  root.append(h('h1', { text: 'Склад' }), sync, searchBox, summary, list, fab);

  function drawItems() {
    const q = search.value.trim();
    const active = currentStock(app.sheet).filter((item) => !item.archived);
    const totalQty = active.reduce((sum, item) => sum + Math.max(0, item.qty), 0);
    const totalValue = stockCost(active.filter((item) => item.qty > 0));
    summary.hidden = !active.length;
    if (active.length) {
      summary.textContent = 'Позиций: ' + active.length + ' · ' + totalQty + ' шт. · на ' + money(totalValue);
    }
    const items = filterStock(app, active, q);
    fill(list, items.length ? h('div', { class: 'list' }, items.map((item) =>
      h('button', { class: 'item' + (item.qty <= 0 ? ' dim' : ''), type: 'button', onclick: () => openPosition(app, item.id) },
        h('div', { class: 'grow' },
          h('div', { class: 't' }, item.name, item.pending ? h('span', { class: 'badge warn', style: 'margin-left:6px', text: 'не отправлено' }) : null),
          h('div', { class: 's', text: [item.model || 'Универсальная', money(item.cost) + ' / шт.'].filter(Boolean).join(' · ') })),
        h('b', { class: 'nowrap mono' + (item.qty <= 0 ? ' muted' : ''), text: item.qty + ' шт.' }))))
      : h('div', { class: 'empty', text: q ? 'Ничего не нашлось.' : 'На складе пока нет позиций.' }));
  }

  function draw() {
    const s = app.sheet;
    const ready = stockReady(app);
    const pending = s.outbox.filter((op) => STOCK_OPS.includes(op.op) || op.fields?.stockUse).length;
    const failed = s.failed.filter((op) => STOCK_OPS.includes(op.op));
    const refreshBtn = h('button', { class: 'btn small', 'aria-label': 'Обновить', disabled: s.busy, onclick: () => s.refresh() }, icon('refresh'));
    const needsSetup = !s.connected || (s.version !== null && s.version < STOCK_VERSION);
    const badHeader = s.connected && !needsSetup && s.version !== null && !ready;
    const status = needsSetup ? (!s.connected ? 'Подключи Google Таблицу, чтобы вести склад.' : 'Для склада нужен Apps Script версии ' + STOCK_VERSION + '.')
      : badHeader ? 'Проверь заголовки листа «Склад (журнал)».' : '';
    let syncText;
    if (s.busy) syncText = h('span', {}, h('span', { class: 'spin' }), ' Связь с таблицей…');
    else if (s.error) syncText = h('span', { style: 'color:var(--bad)', text: (ready ? 'Показаны последние остатки. ' : '') + s.error });
    else if (pending) syncText = 'Складских операций в очереди: ' + pending;
    else syncText = s.cache ? 'Обновлено в ' + new Date(s.cache.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Ещё не загружено';
    fill(sync,
      s.connected ? h('div', { class: 'syncbar', role: 'status' }, h('div', { class: 'grow' }, syncText), refreshBtn) : null,
      status ? h('div', { class: 'banner warn', style: 'margin-bottom:12px' },
        h('div', { text: status }),
        h('div', { class: 'row wrap', style: 'margin-top:8px' }, needsSetup
          ? h('button', { class: 'btn small', text: 'Открыть «Google Таблица»', onclick: () => app.openSheetSetup() })
          : h('button', { class: 'btn small', text: 'Обновить', disabled: s.busy, onclick: () => s.refresh() }))) : null,
      s.cache?.stockViewError ? h('div', { class: 'small muted', style: 'margin-bottom:8px', text: 'Лист остатков: ' + s.cache.stockViewError }) : null,
      failed.map((op) => h('div', { class: 'banner bad', style: 'margin-bottom:10px' },
        h('div', { text: 'Складская операция не записалась. ' + op.error }),
        h('div', { class: 'row wrap', style: 'margin-top:8px' },
          h('button', { class: 'btn small', text: 'Повторить', onclick: () => s.retryFailed(op.id) }),
          h('button', { class: 'btn small ghost', text: 'Убрать', onclick: () => s.dropFailed(op.id) })))));
    searchBox.hidden = list.hidden = fab.hidden = !ready;
    if (!ready) { summary.hidden = true; return; }
    drawItems();
  }
  return { el: root, draw };
}

function openStockEditor(app, item) {
  const name = stockInput(item?.name, { maxLength: 160 });
  const model = modelPicker(app, item?.model);
  const cost = stockInput(item?.cost != null ? String(item.cost).replace('.', ',') : '', { inputmode: 'decimal' });
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
  const deleteAvailable = app.sheet.version >= STOCK_ARCHIVE_VERSION;
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
        h('div', { class: 't' }, title + (row.order ? ' · заказ №' + row.order : ''),
          row.pending ? h('span', { class: 'badge warn', style: 'margin-left:6px', text: 'не отправлено' }) : null),
        h('div', { class: 's', text: [fmtDate(String(row.date || '').slice(0, 10), true), money(row.cost) + ' / шт.', row.note].filter(Boolean).join(' · ') })),
      row.qty ? h('b', { class: 'nowrap mono', style: row.qty > 0 ? 'color:var(--good)' : 'color:var(--bad)', text: (row.qty > 0 ? '+' : '') + row.qty + ' шт.' }) : null);
    })),
    h('button', { class: 'btn small danger block', style: 'margin-top:20px', text: 'Удалить со склада', onclick: () => {
      if (!deleteAvailable) {
        app.openSheetSetup();
        return toast('Для удаления со склада обнови Apps Script до версии ' + STOCK_ARCHIVE_VERSION);
      }
      const latest = currentStock(app.sheet).find((position) => position.id === id && !position.archived);
      if (!latest) { modal.close(); return; }
      if (!confirm('Удалить «' + latest.name + '» со склада? В архив уйдёт позиция с остатком ' + latest.qty + ' шт.')) return;
      stockQueue(app, 'archiveStock', { item: id, expectedQty: latest.qty }, modal);
    } }));
  const modal = openSheet(item.name, body, [
    h('button', { class: 'btn', text: 'Закрыть', onclick: () => modal.close() }),
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
  let onlyModel = false;
  let replacement = editing?.replaces || '';
  const taken = new Set(current.filter((part) => part !== editing).map((part) => part.replaces).filter(Boolean));
  const planned = estimates.filter((part) => !taken.has(part.id));
  const inputQty = stockInput(editing?.qty || '1', { inputmode: 'numeric' });
  const label = (item) => [item.model || 'Универсальная', item.qty + ' шт.', money(original.get(item.id)?.cost ?? item.cost) + ' / шт.']
    .filter(Boolean).join(' · ');
  const matches = h('div');
  const hasModelMatch = !editing && canonical && options.some((item) => item.priority === 2);
  const search = stockInput('', { type: 'search', placeholder: 'Например, айфон 12 или проклейка',
    oninput: () => { onlyModel = false; if (modelFilterBtn) modelFilterBtn.classList.remove('on'); drawMatches(); } });
  const searchWrap = searchField(search, () => drawMatches());
  const modelFilterBtn = hasModelMatch ? h('button', { type: 'button', class: 'chip', style: 'margin-bottom:8px', text: 'Только для ' + canonical,
    onclick: () => { onlyModel = !onlyModel; modelFilterBtn.classList.toggle('on', onlyModel); drawMatches(); } }) : null;
  function drawMatches() {
    const base = onlyModel ? options.filter((item) => item.priority === 2) : options;
    const rows = filterStock(app, base, search.value);
    if (chosen && !rows.includes(chosen)) chosen = null;
    fill(matches, rows.length ? h('div', { class: 'list', style: 'max-height:min(38vh,280px);overflow-y:auto' },
      rows.map((item) => h('button', { class: 'item', type: 'button', 'aria-pressed': String(chosen === item),
        onclick: () => { chosen = item; drawMatches(); } },
      h('div', { class: 'grow' },
        h('div', { class: 't' }, item.name,
          item.priority === 2 ? h('span', { class: 'badge good', style: 'margin-left:6px', text: 'подходит' })
            : item.priority === 1 && canonical ? h('span', { class: 'badge info', style: 'margin-left:6px', text: 'универсальная' }) : null),
        h('div', { class: 's', text: label(item) })),
      chosen === item ? h('span', { class: 'badge warn', text: 'Выбрано' }) : null)))
      : h('div', { class: 'empty', text: 'По этому запросу деталей в наличии нет.' }));
  }
  if (!editing && options.length) drawMatches();
  const body = h('div', {},
    options.length ? [
      editing ? h('p', { class: 'muted', text: chosen.name + ' · ' + label(chosen) })
        : [field('Найти модель или деталь', searchWrap.el), modelFilterBtn, matches],
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
