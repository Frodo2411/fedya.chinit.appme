// Экран «Выкуп»: устройства, купленные сломанными на перепродажу. Себестоимость с запчастями, прибыль план и факт,
// итоги и калькулятор перед покупкой. Данные — листы «Устройства» и «Запчасти» той же Google Таблицы (скрипт версии 5).

import { h, fill, icon, money, number, fmtDate, toast, openSheet, field, select, parseNum } from './ui.js';
import { today } from './store.js';
import { DEVICES_VERSION } from './sheet.js';
import { connectCard } from './view-orders.js';
import {
  DEVICE_STATUSES, DEVICE_CATS, DEVICE_SOURCES, PART_SOURCES, PART_STATUSES, DEVICE_OPS, SOLD,
  deviceCalc, deviceSummary, partsOf, isSold, statusMismatch, splitEven, buyCalc, empty,
} from './devices.js';

const STATUS_CLASS = { 'Куплено': 'later', 'В ремонте': 'work', 'Ждёт запчасть': 'wait', 'Готово': 'ready', 'Выставлено': 'lead', 'Продано': 'done' };
// В работе сверху — то, что ближе к деньгам
const RANK = ['Готово', 'Выставлено', 'Ждёт запчасть', 'В ремонте', 'Куплено'];
const DEVICE_KEYS = ['date', 'device', 'cat', 'source', 'problem', 'buy', 'other', 'status', 'plan', 'sold', 'soldDate', 'note'];
const PART_KEYS = ['name', 'where', 'price', 'date', 'status', 'note'];
// Доходность в калькуляторе по умолчанию, %: меняется там же и запоминается в настройках
export const BUY_TARGET = 35;
export const BUY_MIN = 20;

const blank = (v) => (v === '' || v === undefined ? null : v);
const pct = (x) => (x === null || x === undefined ? '—' : String(Math.round(x * 1000) / 10).replace('.', ',') + '%');
const signed = (n) => (n > 0 ? '+' : '') + money(n);
const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (!empty(o[k])) out[k] = typeof o[k] === 'string' ? o[k].trim() : o[k];
  return out;
};

function statusBadge(s) {
  return s ? h('span', { class: 'badge st-' + (STATUS_CLASS[s] || 'later'), text: s }) : null;
}

// Можно ли записывать: таблица подключена, скрипт умеет выкуп, листы на месте
function mode(app) {
  const s = app.sheet;
  if (!s.connected) return 'connect';
  if (s.version !== null && s.version < DEVICES_VERSION) return 'old';
  if (s.cache && !s.devicesReady) return 'nosheet';
  return 'ok';
}

function oldScriptBanner(app, redraw) {
  return h('div', { class: 'banner warn', style: 'margin-bottom:12px' },
    h('b', { text: 'Обнови скрипт таблицы. ' }),
    'Выкупу нужна версия ' + DEVICES_VERSION + ', а на этом устройстве ' + app.sheet.version + '. «Ещё → Google Таблица» → «Скопировать код скрипта» → '
      + 'вставь в Apps Script вместо старого → «Сохранить» → Развертывание → Управление развертываниями → карандаш → Версия: «Новая версия» → Развернуть. '
      + 'Адрес скрипта останется тем же. Заказы работают и со старым скриптом.',
    h('div', { class: 'row wrap', style: 'margin-top:10px' },
      h('button', { class: 'btn small', text: 'Открыть «Google Таблица»', onclick: () => app.openSheetSetup() }),
      h('button', {
        class: 'btn small', text: 'Я обновил, проверить',
        onclick: async () => { await app.sheet.refresh(); redraw(); if (mode(app) === 'ok') toast('Скрипт обновлён'); },
      })));
}

function describeOp(op) {
  const f = op.fields || {};
  const was = op.was || {};
  if (op.op === 'addDevice') return 'новое устройство ' + (f.device || '');
  if (op.op === 'updateDevice') return 'устройство №' + op.num;
  if (op.op === 'deleteDevice') return 'удаление устройства №' + op.num;
  if (op.op === 'addPart') return 'запчасть ' + (f.name || '');
  if (op.op === 'updatePart') return 'запчасть ' + (was.name || f.name || '');
  return 'удаление запчасти ' + (was.name || '');
}

export function createDevicesView(app) {
  const st = { filter: 'open' };
  const root = h('div');

  function syncBar() {
    const s = app.sheet;
    const mine = s.outbox.filter((o) => DEVICE_OPS.includes(o.op)).length;
    let text;
    if (s.busy) text = h('span', {}, h('span', { class: 'spin' }), ' Связь с таблицей…');
    else if (s.error) text = h('span', { style: 'color:var(--bad)', text: s.error });
    else if (mine) text = 'Не отправлено: ' + mine;
    else text = s.cache ? 'Обновлено в ' + new Date(s.cache.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Ещё не загружено';
    return h('div', { class: 'syncbar' }, h('div', { class: 'grow' }, text),
      h('button', { class: 'btn small', 'aria-label': 'Обновить', disabled: s.busy, onclick: () => s.refresh() }, icon('refresh')));
  }

  function failedBanners() {
    const s = app.sheet;
    return s.failed.filter((f) => DEVICE_OPS.includes(f.op)).map((f) => h('div', { class: 'banner bad', style: 'margin-bottom:10px' },
      h('div', {}, h('b', { text: 'Не записалось в таблицу: ' }), describeOp(f), ' — ', f.error),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn small', text: 'Повторить', onclick: () => { s.dropFailed(f.id); s.outbox.push({ ...f, error: undefined }); s.save(); s.flush(); } }),
        h('button', { class: 'btn small ghost', text: 'Убрать', onclick: () => s.dropFailed(f.id) }))));
  }

  function sorted(devices) {
    const rank = (d) => { const i = RANK.indexOf(d.status); return i < 0 ? RANK.length : i; };
    const open = devices.filter((d) => !isSold(d)).sort((a, b) => rank(a) - rank(b) || String(b.date || '').localeCompare(String(a.date || '')));
    const sold = devices.filter(isSold).sort((a, b) => String(b.soldDate || '').localeCompare(String(a.soldDate || '')));
    if (st.filter === 'open') return open;
    if (st.filter === 'sold') return sold;
    return open.concat(sold);
  }

  function item(d, parts, now) {
    const c = deviceCalc(d, parts, now);
    const sold = isSold(d);
    const money1 = sold ? 'продано за ' + money(d.sold) + ', ' + signed(c.profit) : (c.planProfit !== null ? 'план ' + signed(c.planProfit) : null);
    return h('button', { class: 'item order', onclick: () => openDeviceForm(app, d) },
      h('div', { class: 'grow' },
        h('div', { class: 'row' }, h('span', { class: 'num', text: d.num ? '№' + d.num : '…' }), h('span', { class: 'model grow', text: d.device || 'Без названия' }),
          h('span', { class: 'price', text: money(c.cost) })),
        h('div', { class: 'row' }, h('div', { class: 'prob grow', text: d.problem || '' }), statusBadge(d.status)),
        h('div', { class: 'tiny faint', style: 'margin-top:2px' },
          [d.date ? fmtDate(d.date, true) : null, c.days !== null ? c.days + ' дн.' : null, money1].filter(Boolean).join(' · '),
          statusMismatch(d) ? h('span', { class: 'badge bad', style: 'margin-left:6px', text: 'проверь статус и цену продажи' }) : null,
          d.pending ? h('span', { class: 'badge warn', style: 'margin-left:6px', text: 'не отправлено' }) : null)));
  }

  function draw() {
    const s = app.sheet;
    const m = mode(app);
    const now = today();
    const tile = (label, value, hl) => h('div', { class: 'tile' + (hl ? ' hl' : '') }, h('div', { class: 'v', text: value }), h('div', { class: 'l', text: label }));
    let main = null;
    if (m === 'ok') {
      const devices = s.devices();
      const parts = s.parts();
      const sum = deviceSummary(devices, parts, now);
      const rows = sorted(devices);
      main = [
        h('div', { class: 'tiles four' },
          tile('Вложено в непроданные', money(sum.investedOpen)), tile('Ожидаемая прибыль', signed(sum.expected)),
          tile('Заработано на проданных', signed(sum.profit), true), tile('Продано', sum.sold + ' из ' + sum.count)),
        sum.sold ? h('div', { class: 'small muted', style: 'margin-top:10px' },
          'Доходность проданных ', h('b', { text: pct(sum.roi) }),
          sum.avgDays !== null ? [', продаются в среднем за ', h('b', { text: Math.round(sum.avgDays) + ' дн.' })] : '.') : null,
        h('div', { class: 'row', style: 'margin-top:16px' },
          h('div', { class: 'grow' }, select([
            { value: 'open', label: 'В работе · ' + sum.open }, { value: 'sold', label: 'Продано · ' + sum.sold }, { value: 'all', label: 'Все · ' + sum.count },
          ], st.filter, (v) => { st.filter = v; draw(); }, { label: 'Какие устройства показать' })),
          h('button', { class: 'btn', text: 'Калькулятор', onclick: () => openBuyCalc(app) })),
        h('div', { style: 'height:12px' }),
        rows.length ? h('div', { class: 'list' }, rows.map((d) => item(d, parts, now)))
          : h('div', { class: 'empty', text: st.filter === 'sold' ? 'Проданных пока нет.' : 'Здесь пока пусто. Купил устройство — нажми «+ Устройство».' }),
        h('div', { class: 'tiny faint', style: 'margin-top:12px', text: 'Себестоимость = цена покупки + запчасти + прочие расходы. Доходность = прибыль ÷ себестоимость. Продано — когда вписана цена продажи. Своя работа не считается.' }),
        h('button', { class: 'fab', onclick: () => openDeviceForm(app, null) }, icon('plus'), 'Устройство'),
      ];
    }
    fill(root,
      h('h1', { text: 'Выкуп' }),
      m === 'connect' ? connectCard(app, 'Выкупленные устройства') : syncBar(),
      m === 'old' ? oldScriptBanner(app, draw) : null,
      m === 'nosheet' ? h('div', { class: 'banner warn', style: 'margin-bottom:12px' },
        h('b', { text: 'Не читаются листы выкупа. ' }), s.cache.devicesError || 'В таблице нет листа «Устройства».') : null,
      m === 'connect' ? null : failedBanners(),
      main,
      m === 'ok' ? null : h('div', { class: 'card', style: 'margin-top:12px' },
        h('h3', { text: 'Калькулятор перед покупкой' }),
        h('div', { class: 'small muted', text: 'Сколько можно заплатить за устройство, чтобы заработать нужный процент. Работает и без таблицы.' }),
        h('button', { class: 'btn small primary', style: 'margin-top:12px', text: 'Посчитать', onclick: () => openBuyCalc(app) })));
  }

  return { el: root, draw };
}

// Форма устройства. prefill — из калькулятора (кнопка «Купил»)
export function openDeviceForm(app, device, prefill) {
  const isNew = !device;
  const d = isNew ? { date: today(), status: 'Куплено', cat: 'Телефон', ...prefill } : { ...device };
  const orig = { ...d };
  // Лот: несколько устройств за одну цену — цена делится поровну
  const extras = [];
  const body = h('div');
  const info = h('div', { class: 'small muted', style: 'margin-top:10px' });

  const lotNames = () => extras.map((x) => String(x.device || '').trim()).filter(Boolean);
  const input = (key, label, opts = {}) => field(label, h(opts.area ? 'textarea' : 'input', {
    class: 'input', value: d[key] ?? '', type: opts.area ? null : (opts.type || 'text'), inputmode: opts.inputmode, placeholder: opts.placeholder || '',
    autocomplete: 'off',
    oninput: (e) => {
      const v = e.target.value;
      d[key] = opts.num ? parseNum(v) : (opts.type === 'date' ? v || null : v);
      recalc();
    },
  }));

  function recalc() {
    const n = 1 + lotNames().length;
    const shares = n > 1 && !empty(d.buy) ? splitEven(d.buy, n) : null;
    const c = deviceCalc(shares ? { ...d, buy: shares[0] } : d, isNew ? [] : app.sheet.parts(), today());
    fill(info,
      'Себестоимость ', h('b', { text: money(c.cost) }),
      c.parts ? ' (запчасти ' + money(c.parts) + ')' : null,
      c.planProfit !== null ? [' · прибыль план ', h('b', { text: signed(c.planProfit) })] : null,
      c.profit !== null ? [' · факт ', h('b', { text: signed(c.profit) }), ' (' + pct(c.roi) + ')'] : null,
      shares ? h('div', { class: 'tiny faint', style: 'margin-top:4px', text: 'Цену лота делю поровну: ' + shares.map(number).join(' + ') + ' р. Потом можно поправить у каждого.' }) : null);
  }

  function partsBlock() {
    const parts = partsOf(d, app.sheet.parts());
    return h('div', {},
      h('div', { class: 'row', style: 'margin-top:20px' }, h('h3', { class: 'grow', style: 'margin:0', text: 'Запчасти' }),
        h('button', { class: 'btn small', text: '+ Запчасть', onclick: () => openPartForm(app, d, null, draw) })),
      parts.length ? h('div', { class: 'list', style: 'margin-top:8px' }, parts.map((p) => h('button', { type: 'button', class: 'item', onclick: () => openPartForm(app, d, p, draw) },
        h('div', { class: 'grow' }, h('div', { class: 't', text: p.name || 'Без названия' }),
          h('div', { class: 's' }, [p.status, p.where, p.date ? fmtDate(p.date, true) : null].filter(Boolean).join(' · '),
            p.pending ? h('span', { class: 'badge warn', style: 'margin-left:6px', text: 'не отправлено' }) : null)),
        h('b', { class: 'nowrap', text: money(p.price) }))))
        : h('div', { class: 'tiny faint', style: 'margin-top:8px', text: 'Запчастей пока нет. Их цена войдёт в себестоимость.' }));
  }

  function lotBlock() {
    return h('div', { style: 'margin-top:14px' },
      extras.length ? h('div', { class: 'small muted', text: 'Ещё устройства из этого лота (цена выше — за весь лот):' }) : null,
      extras.map((x, i) => {
        const cat = select(DEVICE_CATS, x.cat, (v) => { x.cat = v; }, { label: 'Категория' });
        return h('div', { class: 'lotrow' },
          h('input', { class: 'input', placeholder: 'AirPods 1, планшет…', value: x.device, autocomplete: 'off', 'aria-label': 'Устройство из лота', oninput: (e) => { x.device = e.target.value; recalc(); } }),
          cat,
          h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Убрать из лота', text: '✕', onclick: () => { extras.splice(i, 1); draw(); } }));
      }),
      h('button', { type: 'button', class: 'btn small', style: 'margin-top:10px', text: '+ Ещё устройство в этом лоте', onclick: () => { extras.push({ device: '', cat: d.cat || 'Телефон' }); draw(); } }));
  }

  function removeDevice() {
    const parts = partsOf(d, app.sheet.parts());
    const what = [device.num ? '№' + device.num : null, device.device].filter(Boolean).join(' · ');
    if (!confirm('Удалить устройство' + (what ? ' ' + what : '') + (parts.length ? ' и его запчасти (' + parts.length + ')' : '') + '? Из таблицы тоже.')) return;
    app.sheet.remove(device, 'deleteDevice');
    toast('Устройство удалено' + (app.sheet.connected ? '' : ' (уйдёт в таблицу, когда будет связь)'));
    sheet.close();
    app.redraw();
  }

  function draw() {
    const showSold = d.status === SOLD || isSold(d);
    fill(body,
      input('device', 'Устройство *', { placeholder: 'Mi 9T, iPhone 11 64 ГБ, Apple Watch S6 44 мм…' }),
      h('div', { class: 'grid2' },
        field('Категория', select(DEVICE_CATS, d.cat || '', (v) => { d.cat = v || null; }, { empty: '—' })),
        field('Статус', select(DEVICE_STATUSES, d.status || '', (v) => {
          d.status = v || null;
          if (v === SOLD && !d.soldDate) d.soldDate = today();
          // передумал: дату продажи, поставленную сейчас, убираем
          if (v !== SOLD && empty(d.sold) && !orig.soldDate) d.soldDate = null;
          draw();
        }, { empty: '—' }))),
      input('problem', 'Что сломано', { placeholder: 'Не включается, разбит экран…' }),
      h('div', { class: 'grid2' },
        input('buy', extras.length ? 'Цена за весь лот, р.' : 'Цена покупки, р.', { inputmode: 'decimal', num: true }),
        input('date', 'Дата покупки', { type: 'date' })),
      isNew ? lotBlock() : null,
      h('div', { class: 'grid2' },
        field('Где куплено', select(DEVICE_SOURCES, d.source || '', (v) => { d.source = v || null; }, { empty: '—' })),
        input('other', 'Прочие расходы, р.', { inputmode: 'decimal', num: true })),
      input('plan', 'Продам за (план), р.', { inputmode: 'decimal', num: true }),
      showSold ? h('div', { class: 'grid2' },
        input('sold', 'Продал за, р.', { inputmode: 'decimal', num: true }),
        input('soldDate', 'Дата продажи', { type: 'date' })) : null,
      info,
      input('note', 'Заметки', { area: true }),
      isNew ? h('div', { class: 'tiny faint', style: 'margin-top:12px', text: 'Запчасти добавишь после записи: открой устройство в списке.' }) : partsBlock(),
      isNew ? null : h('button', { class: 'btn small danger block', style: 'margin-top:20px', text: 'Удалить устройство', onclick: removeDevice }));
    recalc();
  }

  const save = h('button', {
    class: 'btn primary', text: isNew ? 'Записать' : 'Сохранить',
    onclick: () => {
      if (!String(d.device || '').trim()) { toast('Напиши, что за устройство'); return; }
      if (d.status === SOLD && empty(d.sold)) { toast('Впиши, за сколько продал'); return; }
      if (!empty(d.sold)) {
        d.status = SOLD;
        if (!d.soldDate) d.soldDate = today();
      }
      if (mode(app) === 'old') { toast('Сначала обнови скрипт таблицы до версии ' + DEVICES_VERSION, 4000); return; }
      if (isNew) {
        const names = lotNames();
        const all = [{ ...d }, ...extras.filter((x) => String(x.device || '').trim()).map((x) => ({
          device: String(x.device).trim(), cat: x.cat || d.cat, date: d.date, source: d.source, status: d.status,
        }))];
        if (all.length > 1) {
          const shares = empty(d.buy) ? null : splitEven(d.buy, all.length);
          const lot = 'Лот' + (empty(d.buy) ? '' : ' за ' + number(d.buy) + ' р.');
          all.forEach((x, i) => {
            if (shares) x.buy = shares[i];
            const others = [d.device.trim(), ...names].filter((_, j) => j !== i).join(', ');
            x.note = [i === 0 ? String(d.note || '').trim() : '', lot + ' вместе с: ' + others].filter(Boolean).join('. ');
          });
        }
        for (const x of all) app.sheet.add('addDevice', pick(x, DEVICE_KEYS));
        toast((all.length > 1 ? 'Записано устройств: ' + all.length : 'Устройство записано') + (app.sheet.connected ? '' : ' в очередь'));
      } else {
        const changed = {};
        for (const k of DEVICE_KEYS) if (blank(d[k]) !== blank(orig[k])) changed[k] = d[k] ?? '';
        if (!Object.keys(changed).length) { sheet.close(); return; }
        app.sheet.update('updateDevice', device, changed);
        toast('Сохранено');
      }
      sheet.close();
      app.redraw();
    },
  });
  const sheet = openSheet(isNew ? 'Новое устройство' : 'Устройство №' + (device.num || '…'), body,
    [h('button', { class: 'btn', text: 'Отмена', onclick: () => sheet.close() }), save]);
  draw();
}

// Запчасть устройства. after — перерисовать форму устройства (себестоимость поменялась)
export function openPartForm(app, device, part, after) {
  const isNew = !part;
  const p = isNew ? { date: today(), status: 'Заказана' } : { ...part };
  const orig = { ...p };
  const input = (key, label, opts = {}) => field(label, h(opts.area ? 'textarea' : 'input', {
    class: 'input', value: p[key] ?? '', type: opts.area ? null : (opts.type || 'text'), inputmode: opts.inputmode, placeholder: opts.placeholder || '',
    autocomplete: 'off',
    oninput: (e) => { const v = e.target.value; p[key] = opts.num ? parseNum(v) : (opts.type === 'date' ? v || null : v); },
  }));
  const done = () => {
    sheet.close();
    app.redraw();
    if (after) after();
  };
  const body = h('div', {},
    h('div', { class: 'small muted', text: 'Для ' + [device.num ? '№' + device.num : null, device.device].filter(Boolean).join(' · ') }),
    input('name', 'Запчасть *', { placeholder: 'Дисплей, аккумулятор, разъём зарядки…' }),
    h('div', { class: 'grid2' },
      input('price', 'Цена, р.', { inputmode: 'decimal', num: true }),
      input('date', 'Дата', { type: 'date' })),
    h('div', { class: 'grid2' },
      field('Где куплена', select(PART_SOURCES, p.where || '', (v) => { p.where = v || null; }, { empty: '—' })),
      field('Статус', select(PART_STATUSES, p.status || '', (v) => { p.status = v || null; }, { empty: '—' }))),
    input('note', 'Заметки', { area: true }),
    isNew ? null : h('button', {
      class: 'btn small danger block', style: 'margin-top:20px', text: 'Удалить запчасть',
      onclick: () => {
        if (!confirm('Удалить запчасть «' + (part.name || '') + '»? Из таблицы тоже.')) return;
        app.sheet.remove(part, 'deletePart');
        toast('Запчасть удалена');
        done();
      },
    }));
  const save = h('button', {
    class: 'btn primary', text: isNew ? 'Записать' : 'Сохранить',
    onclick: () => {
      if (!String(p.name || '').trim()) { toast('Напиши, что за запчасть'); return; }
      if (isNew) {
        const fields = pick(p, PART_KEYS);
        let extra;
        if (!empty(device.num)) fields.dnum = device.num;
        else if (device.pendingId) extra = { dref: device.pendingId };
        else { toast('Сначала запиши устройство'); return; }
        app.sheet.add('addPart', fields, extra);
        toast('Запчасть записана');
      } else {
        const changed = {};
        for (const k of PART_KEYS) if (blank(p[k]) !== blank(orig[k])) changed[k] = p[k] ?? '';
        if (Object.keys(changed).length) app.sheet.update('updatePart', part, changed);
      }
      done();
    },
  });
  const sheet = openSheet(isNew ? 'Новая запчасть' : 'Запчасть', body, [h('button', { class: 'btn', text: 'Отмена', onclick: () => sheet.close() }), save]);
}

// Калькулятор перед покупкой: цена в объявлении, запчасти и цена продажи → сколько можно заплатить.
// Целевая и минимальная доходность запоминаются в настройках (и уходят в резервную копию в таблице)
export function openBuyCalc(app) {
  const v = { ask: null, parts: null, other: null, sale: null };
  const out = h('div', { class: 'card', style: 'margin-top:14px' });
  const target = () => app.settings.buyTarget ?? BUY_TARGET;
  const min = () => app.settings.buyMin ?? BUY_MIN;
  const money0 = (key, label, placeholder) => field(label, h('input', {
    class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: placeholder || '',
    oninput: (e) => { v[key] = parseNum(e.target.value); recalc(); },
  }));
  const percent = (key, label, def) => field(label, h('input', {
    class: 'input', inputmode: 'decimal', autocomplete: 'off', value: String(app.settings[key] ?? def).replace('.', ','),
    oninput: (e) => {
      const n = parseNum(e.target.value);
      if (n === null || n < 0 || n > 1000) return;
      app.saveSettings({ [key]: n }, { redraw: false });
      recalc();
    },
  }));

  function recalc() {
    const r = buyCalc({ ...v, target: target() / 100, min: min() / 100 });
    if (r.maxTarget === null) {
      fill(out, h('div', { class: 'small muted', text: 'Впиши, за сколько продашь устройство после ремонта: посчитаю, сколько можно за него заплатить.' }));
      return;
    }
    const verdict = {
      good: ['var(--good)', 'Цена в цели, можно брать.'],
      haggle: ['var(--accent)', 'Дороже цели: торгуйся до ' + money(r.maxTarget) + '.'],
      expensive: ['var(--bad)', 'Дороже края: пропусти или сбивай цену хотя бы до ' + money(r.maxMin) + '.'],
    }[r.verdict];
    fill(out,
      h('div', {}, 'Можно заплатить до ', h('b', { text: money(r.maxTarget) }), ', чтобы заработать ' + number(target()) + '%.'),
      h('div', { class: 'small muted', style: 'margin-top:4px' }, 'Край: ', h('b', { text: money(r.maxMin) }), ', тогда заработаешь ' + number(min()) + '%.'),
      r.cost !== null ? h('div', { style: 'margin-top:12px' },
        'По цене из объявления: себестоимость ', h('b', { text: money(r.cost) }), ', прибыль ', h('b', { text: signed(r.profit) }), ' (' + pct(r.roi) + ').') : null,
      verdict ? h('div', { style: 'margin-top:10px;font-weight:700;color:' + verdict[0], text: verdict[1] }) : null);
  }

  const body = h('div', {},
    h('div', { class: 'small muted', text: 'Доходность — сколько заработаешь на вложенное: прибыль ÷ (цена покупки + запчасти + расходы). Своя работа не считается.' }),
    h('div', { class: 'grid2' }, money0('ask', 'Цена в объявлении, р.'), money0('sale', 'Продам за, р.', 'после ремонта')),
    h('div', { class: 'grid2' }, money0('parts', 'Запчасти, р.'), money0('other', 'Прочие расходы, р.', 'доставка…')),
    h('div', { class: 'grid2' }, percent('buyTarget', 'Хочу заработать, %', BUY_TARGET), percent('buyMin', 'Минимум, %', BUY_MIN)),
    out);
  const sheet = openSheet('Калькулятор перед покупкой', body, [
    h('button', { class: 'btn', text: 'Закрыть', onclick: () => sheet.close() }),
    h('button', {
      class: 'btn primary', text: 'Купил', 'aria-label': 'Купил: записать устройство с этими цифрами',
      onclick: () => {
        if (mode(app) !== 'ok') { toast(mode(app) === 'connect' ? 'Сначала подключи Google Таблицу' : 'Сначала обнови скрипт таблицы до версии ' + DEVICES_VERSION, 4000); return; }
        sheet.close();
        openDeviceForm(app, null, {
          buy: v.ask, other: v.other, plan: v.sale,
          note: v.parts ? 'Запчасти по расчёту: ' + number(v.parts) + ' р.' : '',
        });
      },
    }),
  ]);
  recalc();
}
