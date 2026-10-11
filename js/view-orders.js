// Экран «Заказы»: журнал из Google Таблицы, форма заказа, статусы.

import { h, fill, icon, money, fmtDate, toast, openSheet, field, select, parseNum } from './ui.js';
import { ACTIVE, computed } from './orders.js';
import { store, today } from './store.js';

const STATUS_CLASS = {
  'Обращение': 'lead', 'Принят': 'work', 'Диагностика': 'work', 'Жду запчасть': 'wait', 'В работе': 'work',
  'Готов': 'ready', 'Выдан': 'done', 'Отказ': 'bad', 'Долгосрок': 'later',
};
const RANK = ['Готов', 'Жду запчасть', 'В работе', 'Диагностика', 'Принят', 'Обращение', 'Долгосрок'];
const EDITABLE = ['date', 'status', 'device', 'model', 'problem', 'done', 'price', 'part', 'prepay', 'source', 'urgent', 'issued', 'refusal', 'client', 'phone', 'address', 'comment'];

export function statusBadge(s) {
  return s ? h('span', { class: 'badge st-' + (STATUS_CLASS[s] || 'later'), text: s }) : null;
}

// Номер для набора: 375… → +375…, 80… → +375…, девять цифр → +375…
export function telHref(p) {
  const raw = String(p || '').trim();
  const d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('375')) return 'tel:+' + d;
  if (d.length === 11 && d.startsWith('80')) return 'tel:+375' + d.slice(2);
  if (d.length === 9) return 'tel:+375' + d;
  return 'tel:' + (raw.startsWith('+') ? '+' : '') + d;
}

// Как храним в таблице: белорусский номер — 375 и девять цифр
export function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('80')) return '375' + d.slice(2);
  if (d.length === 9) return '375' + d;
  return String(p || '').trim();
}

export function phoneText(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('375')) return '+375 ' + d.slice(3, 5) + ' ' + d.slice(5, 8) + '-' + d.slice(8, 10) + '-' + d.slice(10);
  if (d.length === 11 && d.startsWith('80')) return '8 0' + d.slice(2, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9);
  return String(p || '');
}

export function connectCard(app, what) {
  return h('div', { class: 'card', style: 'margin-top:12px' },
    h('h3', { text: 'Подключи Google Таблицу' }),
    h('div', { class: 'muted small', text: what + ' хранятся в твоей Google Таблице. Подключить нужно один раз, это минут пять с компьютера.' }),
    h('button', { class: 'btn primary block', style: 'margin-top:14px', text: 'Как подключить', onclick: () => app.openSheetSetup() }));
}

export function createOrdersView(app) {
  const st = { filter: 'active', q: '' };
  const root = h('div');
  const listBox = h('div');
  const search = h('input', {
    class: 'search', type: 'search', placeholder: 'Номер, модель, клиент, телефон', autocomplete: 'off', autocorrect: 'off',
    spellcheck: false, 'aria-label': 'Поиск заказа', oninput: () => { st.q = search.value; drawList(); },
  });

  function matches(o, q) {
    if (!q) return true;
    const hay = [o.num, o.model, o.client, o.phone, o.problem, o.done, o.comment, o.device].filter(Boolean).join(' ').toLowerCase().replace(/ё/g, 'е');
    return q.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
  }

  function inFilter(o, f) {
    if (f === 'active') return ACTIVE.includes(o.status) || !o.status;
    if (f === 'ready') return o.status === 'Готов';
    if (f === 'done') return o.status === 'Выдан';
    if (f === 'refused') return o.status === 'Отказ';
    return true;
  }

  function drawList() {
    const all = app.sheet.orders();
    const q = st.q.trim();
    const rows = all.filter((o) => inFilter(o, st.filter) && matches(o, q));
    rows.sort((a, b) => {
      if (st.filter === 'active') {
        const u = (b.urgent === 'Да') - (a.urgent === 'Да');
        if (u) return u;
        const r = RANK.indexOf(a.status) - RANK.indexOf(b.status);
        if (r) return r;
      }
      return String(b.date || '').localeCompare(String(a.date || '')) || (Number(b.num) || 1e9) - (Number(a.num) || 1e9);
    });
    fill(listBox, rows.length ? h('div', { class: 'list' }, rows.map(orderItem))
      : h('div', { class: 'empty', text: q ? 'Ничего не нашлось.' : 'Здесь пока пусто.' }));
  }

  function orderItem(o) {
    const lm = app.sheet.lists.warrantyMonths;
    const c = computed(o, lm);
    return h('button', { class: 'item order', onclick: () => openOrderForm(app, o) },
      h('div', { class: 'grow' },
        h('div', { class: 'row' }, h('span', { class: 'num', text: o.num ? '№' + o.num : '…' }), h('span', { class: 'model grow', text: o.model || o.device || 'Без модели' }),
          o.price !== null && o.price !== undefined && o.price !== '' ? h('span', { class: 'price', text: money(o.price) }) : null),
        h('div', { class: 'row' }, h('div', { class: 'prob grow', text: o.problem || o.done || '' }), statusBadge(o.status)),
        h('div', { class: 'tiny faint', style: 'margin-top:2px' },
          [fmtDate(o.date, true), o.source, o.urgent === 'Да' ? 'срочно' : null, o.client,
            o.status === 'Выдан' && c.warranty ? 'гарантия до ' + fmtDate(c.warranty) : null].filter(Boolean).join(' · '),
          o.pending ? h('span', { class: 'badge warn', style: 'margin-left:6px', text: 'не отправлено' }) : null)));
  }

  // Постоянная часть экрана: строку поиска не пересоздаём, иначе при фоновом обновлении закрывается клавиатура
  const title = h('h1', { text: 'Заказы' });
  const connectBox = h('div');
  const syncBox = h('div', { class: 'syncbar' });
  const failedBox = h('div');
  const chipsBox = h('div');
  const connected = h('div', {},
    syncBox, failedBox,
    h('div', { class: 'searchbar', style: 'padding-top:0;margin-top:0;top:var(--safe-t)' }, search),
    chipsBox, h('div', { style: 'height:12px' }), listBox,
    h('button', { class: 'fab', onclick: () => openOrderForm(app, null) }, icon('plus'), 'Заказ'));
  root.append(title, connectBox, connected);

  function draw() {
    if (!app.sheet.connected) {
      connected.hidden = true;
      fill(connectBox, connectCard(app, 'Заказы'));
      return;
    }
    fill(connectBox);
    connected.hidden = false;
    const all = app.sheet.orders();
    const count = (f) => all.filter((o) => inFilter(o, f)).length;
    const s = app.sheet;
    let syncText;
    if (s.busy) syncText = h('span', {}, h('span', { class: 'spin' }), ' Связь с таблицей…');
    else if (s.error) syncText = h('span', { style: 'color:var(--bad)', text: s.error });
    else if (s.outbox.length) syncText = 'Не отправлено: ' + s.outbox.length;
    else syncText = s.cache ? 'Обновлено в ' + new Date(s.cache.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Ещё не загружено';
    fill(syncBox, h('div', { class: 'grow' }, syncText),
      h('button', { class: 'btn small', 'aria-label': 'Обновить', disabled: s.busy, onclick: () => s.refresh() }, icon('refresh')));
    fill(failedBox, s.failed.map((f) => h('div', { class: 'banner bad', style: 'margin-bottom:10px' },
      h('div', {}, h('b', { text: 'Не записалось в таблицу: ' }), describeOp(f), ' — ', f.error),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn small', text: 'Повторить', onclick: () => { s.dropFailed(f.id); s.outbox.push({ ...f, error: undefined }); s.save(); s.flush(); } }),
        h('button', { class: 'btn small ghost', text: 'Убрать', onclick: () => s.dropFailed(f.id) })))));
    fill(chipsBox, select([
      { value: 'active', label: 'Активные · ' + count('active') }, { value: 'ready', label: 'Готов · ' + count('ready') },
      { value: 'done', label: 'Выданы · ' + count('done') }, { value: 'refused', label: 'Отказ · ' + count('refused') }, { value: 'all', label: 'Все · ' + all.length },
    ], st.filter, (v) => { st.filter = v; drawList(); }, { label: 'Какие заказы показать' }));
    drawList();
  }

  return { el: root, draw };
}

function describeOp(op) {
  const f = op.fields || {};
  if (op.op === 'addOrder') return 'новый заказ ' + (f.model || f.problem || '');
  if (op.op === 'updateOrder') return 'заказ №' + op.num;
  if (op.op === 'addExpense') return 'расход ' + (f.what || '');
  return 'расход';
}

// Форма заказа. prefill — из экрана «Цены».
export function openOrderForm(app, order, prefill) {
  const lists = app.sheet.lists;
  const isNew = !order;
  const o = isNew
    ? { date: today(), status: 'Обращение', urgent: 'Нет', device: 'Телефон', source: store.get('lastSource', ''), ...prefill }
    : { ...order };
  const orig = { ...o };
  const body = h('div');
  const info = h('div', { class: 'small muted', style: 'margin-top:10px' });
  const statusHint = h('div', { class: 'tiny faint', style: 'margin-top:6px' });
  const refusalBox = h('div');
  const issuedInput = h('input', { class: 'input', type: 'date', value: o.issued || '', oninput: (e) => { o.issued = e.target.value || null; recalc(); } });

  const text = (key, label, opts = {}) => field(label, h(opts.area ? 'textarea' : 'input', {
    class: 'input', value: o[key] ?? '', type: opts.area ? null : (opts.type || 'text'), inputmode: opts.inputmode, placeholder: opts.placeholder || '',
    autocomplete: 'off', autocapitalize: opts.type === 'tel' ? 'off' : 'sentences',
    oninput: (e) => { o[key] = opts.num ? parseNum(e.target.value) : e.target.value; recalc(); },
  }));

  function recalc() {
    const c = computed(o, lists.warrantyMonths);
    fill(info, 
      'Прибыль ', h('b', { text: c.profit === null ? '—' : money(c.profit) }),
      ' · к оплате ', h('b', { text: c.due === null ? '—' : money(c.due) }),
      c.warranty ? ' · гарантия до ' + fmtDate(c.warranty) : '');
    statusHint.textContent = lists.hints[o.status] || '';
    refusalBox.hidden = o.status !== 'Отказ';
  }
  fill(refusalBox, field('Если отказ: запчасть', select(['Вернул', 'Осталась у меня'], o.refusal || '', (v) => { o.refusal = v || null; recalc(); }, { empty: '—' })));

  const clientOpen = !!(o.client || o.phone || o.address);
  body.append(
    field('Статус', select(lists.statuses, o.status || '', (v) => {
      o.status = v || null;
      if (v === 'Выдан' && !o.issued) { o.issued = today(); issuedInput.value = o.issued; }
      recalc();
    }, { empty: '—' })),
    statusHint,
    refusalBox,
    h('div', { class: 'grid2' },
      field('Дата приёма', h('input', { class: 'input', type: 'date', value: o.date || '', oninput: (e) => { o.date = e.target.value || null; recalc(); } })),
      field('Дата выдачи', issuedInput)),
    field('Устройство', select(lists.devices, o.device || '', (v) => { o.device = v || null; }, { empty: '—' })),
    text('model', 'Модель', { placeholder: 'iPhone 13, Redmi Note 8 Pro…' }),
    text('problem', 'Неисправность', { placeholder: 'Разбит дисплей, замена АКБ…' }),
    text('done', 'Что сделано'),
    h('div', { class: 'grid3' },
      text('price', 'Цена, р.', { inputmode: 'decimal', num: true }),
      text('part', 'Запчасть, р.', { inputmode: 'decimal', num: true }),
      text('prepay', 'Предоплата', { inputmode: 'decimal', num: true })),
    info,
    field('Источник', select(lists.sources, o.source || '', (v) => { o.source = v || null; }, { empty: '—' })),
    h('label', { class: 'switch', style: 'margin-top:8px' },
      h('input', { type: 'checkbox', checked: o.urgent === 'Да', onchange: (e) => { o.urgent = e.target.checked ? 'Да' : 'Нет'; } }), 'Срочно'),
    h('details', { open: clientOpen },
      h('summary', { text: 'Клиент (необязательно)' }),
      text('client', 'Имя'),
      text('phone', 'Телефон', { type: 'tel', inputmode: 'tel' }),
      o.phone ? h('a', { href: telHref(o.phone), class: 'small', text: 'Позвонить ' + phoneText(o.phone) }) : null,
      text('address', 'Адрес')),
    text('comment', 'Комментарий', { area: true }),
  );
  recalc();

  const save = h('button', {
    class: 'btn primary', text: isNew ? 'Записать' : 'Сохранить',
    onclick: () => {
      if (o.phone) o.phone = normPhone(o.phone);
      if (isNew) {
        const fields = {};
        for (const k of EDITABLE) if (o[k] !== null && o[k] !== undefined && o[k] !== '') fields[k] = o[k];
        if (!fields.model && !fields.problem && !fields.client) { toast('Заполни модель или неисправность'); return; }
        if (fields.source) store.set('lastSource', fields.source);
        app.sheet.add('addOrder', fields);
        toast('Заказ записан' + (app.sheet.connected ? '' : ' в очередь'));
      } else {
        const changed = {};
        for (const k of EDITABLE) if ((o[k] ?? null) !== (orig[k] ?? null)) changed[k] = o[k] ?? '';
        if (!Object.keys(changed).length) { sheet.close(); return; }
        app.sheet.update('updateOrder', order, changed);
        toast('Сохранено');
      }
      sheet.close();
      app.redraw();
    },
  });
  const sheet = openSheet(isNew ? 'Новый заказ' : 'Заказ №' + (order.num || '…'), body,
    [h('button', { class: 'btn', text: 'Отмена', onclick: () => sheet.close() }), save]);
}
