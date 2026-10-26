// Экран «Заказы»: журнал из Google Таблицы, форма заказа, статусы.

import { h, fill, icon, money, fmtDate, toast, openSheet, field, select, chips, parseNum } from './ui.js';
import { ACTIVE, computed, isWarranty } from './orders.js';
import { store, today } from './store.js';
import { SERVICES, ORDER } from './engine.js';
import { REPAIR, VAR_APP, lcFirst, cartPart, cartGlues } from './view-prices.js';

const STATUS_CLASS = {
  'Обращение': 'lead', 'Принят': 'work', 'Диагностика': 'work', 'Жду запчасть': 'wait', 'В работе': 'work',
  'Готов': 'ready', 'Выдан': 'done', 'Отказ': 'bad', 'Долгосрок': 'later',
};
const RANK = ['Готов', 'Жду запчасть', 'В работе', 'Диагностика', 'Принят', 'Обращение', 'Долгосрок'];
const EDITABLE = ['date', 'status', 'device', 'model', 'problem', 'done', 'price', 'part', 'prepay', 'source', 'urgent', 'issued', 'refusal', 'client', 'phone', 'address', 'comment', 'wfor'];

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

// Поиск заказа: все слова запроса есть в номере, модели, клиенте, телефоне или описании
export function matchOrder(o, q) {
  if (!q) return true;
  const hay = [o.num, o.model, o.client, o.phone, o.problem, o.done, o.comment, o.device].filter(Boolean).join(' ').toLowerCase().replace(/ё/g, 'е');
  return q.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

// Детали заказа для корзины. Сначала — из комментария: «Записать заказ» пишет туда «Деталь: Поставщик — название
// цена р.»; если там не нашлось (поставщика переименовали, комментарий переписан) — по «Неисправности» вида
// «Замена дисплея (копия ЖК)» и модели: нынешняя деталь этого варианта
export function orderCartItems(pricer, o) {
  const text = String(o.comment || '');
  const supName = (k) => (pricer.data.suppliers[k] || {}).name || k;
  const hits = [];
  if (text) {
    for (const p of pricer.data.parts) {
      if (!p.cost || !p.models.length || !ORDER[p.svc] || !ORDER[p.svc].includes(p.tier)) continue;
      const needle = supName(p.sup) + ' — ' + p.name + ' ';
      const at = text.indexOf(needle);
      if (at >= 0 && !hits.some((x) => x.p.sup === p.sup && x.p.name === p.name)) hits.push({ p, at, end: at + needle.length });
    }
  }
  // «… — Дисплей iPhone 11 » внутри «… — Дисплей iPhone 11 Pro …» — не та деталь: берём самые длинные совпадения
  const exact = hits.filter((a) => !hits.some((b) => b !== a && b.at <= a.at && b.end >= a.end && b.end - b.at > a.end - a.at));
  if (exact.length) {
    return exact.sort((a, b) => a.at - b.at)
      .map(({ p }) => cartPart(p.models.includes(o.model) ? o.model : p.models[0], p.svc, p.tier, p));
  }
  const low = String(o.model || '').trim().toLowerCase();
  const model = low ? [...pricer.byName.keys()].find((m) => m.toLowerCase() === low) : null;
  if (!model) return [];
  const entry = pricer.model(model);
  const prob = String(o.problem || '').toLowerCase();
  const out = [];
  for (const svc of SERVICES) {
    for (const tier of ORDER[svc]) {
      if (!prob.includes((lcFirst(REPAIR[svc]) + ' (' + lcFirst(VAR_APP[tier]) + ')').toLowerCase())) continue;
      const opt = entry.services[svc].opts.find((x) => x.tier === tier);
      if (opt) out.push(cartPart(model, svc, tier, { sup: opt.sup, name: opt.part, cost: opt.cost }));
    }
  }
  return out;
}

// Номер для сортировки: «Г12» → 12, без номера (ещё не отправлен) — в начало
const seq = (o) => Number(String(o.num ?? '').replace(/^\s*Г\s*/i, '')) || 1e9;

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

  function inFilter(o, f) {
    if (f === 'active') return ACTIVE.includes(o.status) || !o.status;
    if (f === 'ready') return o.status === 'Готов';
    if (f === 'done') return o.status === 'Выдан';
    if (f === 'refused') return o.status === 'Отказ';
    if (f === 'warranty') return isWarranty(o);
    return true;
  }

  function drawList() {
    const all = app.sheet.orders();
    const q = st.q.trim();
    const rows = all.filter((o) => inFilter(o, st.filter) && matchOrder(o, q));
    rows.sort((a, b) => {
      if (st.filter === 'active') {
        const u = (b.urgent === 'Да') - (a.urgent === 'Да');
        if (u) return u;
        const r = RANK.indexOf(a.status) - RANK.indexOf(b.status);
        if (r) return r;
      }
      return String(b.date || '').localeCompare(String(a.date || '')) || seq(b) - seq(a);
    });
    fill(listBox, rows.length ? h('div', { class: 'list' }, rows.map(orderItem))
      : h('div', { class: 'empty', text: q ? 'Ничего не нашлось.' : 'Здесь пока пусто.' }));
  }

  function orderItem(o) {
    const lm = app.sheet.lists.warrantyMonths;
    const c = computed(o, lm);
    const w = isWarranty(o);
    // у гарантийного цена обычно 0 — вместо неё значок
    const showPrice = o.price !== null && o.price !== undefined && o.price !== '' && !(w && Number(o.price) === 0);
    return h('button', { class: 'item order', onclick: () => openOrderForm(app, o) },
      h('div', { class: 'grow' },
        h('div', { class: 'row' }, h('span', { class: 'num' + (w ? ' w' : ''), text: o.num ? '№' + o.num : '…' }), h('span', { class: 'model grow', text: o.model || o.device || 'Без модели' }),
          w ? h('span', { class: 'badge violet', text: 'гарантия' }) : null,
          showPrice ? h('span', { class: 'price', text: money(o.price) }) : null),
        h('div', { class: 'row' }, h('div', { class: 'prob grow', text: o.problem || o.done || '' }), statusBadge(o.status)),
        h('div', { class: 'tiny faint', style: 'margin-top:2px' },
          [fmtDate(o.date, true), w && o.wfor ? 'по заказу №' + o.wfor : null, o.source, o.urgent === 'Да' ? 'срочно' : null, o.client,
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
      { value: 'done', label: 'Выданы · ' + count('done') }, { value: 'refused', label: 'Отказ · ' + count('refused') },
      { value: 'warranty', label: 'Гарантия · ' + count('warranty') }, { value: 'all', label: 'Все · ' + all.length },
    ], st.filter, (v) => { st.filter = v; drawList(); }, { label: 'Какие заказы показать' }));
    drawList();
  }

  return { el: root, draw };
}

function describeOp(op) {
  const f = op.fields || {};
  if (op.op === 'addOrder') return (op.warranty ? 'новый гарантийный заказ ' : 'новый заказ ') + (f.model || f.problem || '');
  if (op.op === 'updateOrder') return 'заказ №' + op.num;
  if (op.op === 'addExpense') return 'расход ' + (f.what || '');
  return 'расход';
}

// Гарантия по заказу: клиент и телефон те же, ремонт бесплатный. cart — детали того заказа (галочка «Те же детали
// в корзину», по умолчанию выключена: по гарантии может понадобиться другая деталь)
export function warrantyPrefill(app, order) {
  const items = orderCartItems(app.pricer, order);
  return {
    warrantyOrder: true, wfor: order.num, price: 0,
    client: order.client || '', phone: order.phone || '', address: order.address || '',
    device: order.device || 'Телефон', model: order.model || '', source: order.source || store.get('lastSource', ''),
    cart: items.length ? { items, glues: cartGlues(app.pricer, items[0].model, items.map((x) => x.svc)), same: true } : undefined,
  };
}

// Форма заказа. prefill — из экрана «Цены» или из заказа, по которому оформляется гарантия (warrantyPrefill).
export function openOrderForm(app, order, prefill) {
  const lists = app.sheet.lists;
  const isNew = !order;
  // cart — детали заказа из «Цен» ({ items, glues }): по галочке «Детали в корзину» лягут в корзину
  const { cart: cartPlan, ...pre } = prefill || {};
  let toCartOn = cartPlan && cartPlan.same ? false : store.get('orderToCart', true);
  const o = isNew
    ? { date: today(), status: 'Обращение', urgent: 'Нет', device: 'Телефон', source: store.get('lastSource', ''), ...pre }
    : { ...order };
  const orig = { ...o };
  // цену из «Цен» запоминаем: переключил на гарантию и обратно — она вернётся
  let paid = isWarranty(o) ? null : o.price;
  const body = h('div');
  const info = h('div', { class: 'small muted', style: 'margin-top:10px' });
  const statusHint = h('div', { class: 'tiny faint', style: 'margin-top:6px' });
  const refusalBox = h('div');

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

  function setWarranty(on) {
    if (on === isWarranty(o)) return;
    o.warrantyOrder = on || undefined;
    if (on) {
      paid = o.price;
      o.price = 0;
    } else {
      o.price = paid ?? null;
      o.wfor = null;
    }
    sheet.el.querySelector('.sheet-head h3').textContent = on ? 'Гарантия' : 'Новый заказ';
    draw();
  }

  // Для корзины: «для чего» — с заказом; что ляжет — списком
  const forOrder = (x) => ({ ...x, use: x.use + ' · заказ' + (o.num ? ' №' + o.num : '') + (o.client ? ' · ' + o.client : '') });
  const planText = (items, glues) => items.map((x) => x.name).join('; ')
    + (app.settings.cartGlue !== false && glues.flat().length ? ' + проклейка' : '');

  // Записанный заказ: его детали — в корзину, цены этой модели
  function orderActions() {
    const found = orderCartItems(app.pricer, o);
    const model = app.findModel(o.model);
    if (!found.length && !model) return null;
    const glues = found.length ? cartGlues(app.pricer, found[0].model, found.map((x) => x.svc)) : [];
    return h('div', { style: 'margin-top:16px' },
      found.length ? h('div', {},
        h('button', {
          class: 'btn small', onclick: (e) => {
            app.addToCart(found.map(forOrder), glues);
            toast('В корзине: ' + found.length + ' дет.' + (app.settings.cartGlue !== false && glues.flat().length ? ' с проклейкой' : ''));
            // второй раз по ошибке не положить
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = '✓ Добавлено в корзину';
          },
        }, icon('cart'), 'Детали в корзину'),
        h('div', { class: 'tiny faint', style: 'margin-top:6px', text: 'Положу: ' + planText(found, glues) })) : null,
      model ? h('button', { class: 'btn small', style: found.length ? 'margin-top:12px' : null, text: 'Цены: ' + model, onclick: () => { sheet.close(); app.showModel(model); } }) : null);
  }

  // Скрипт таблицы до гарантии нумеровал бы такой заказ как обычный
  const oldScript = () => isNew && isWarranty(o) && app.sheet.connected && app.sheet.version !== null && app.sheet.version < 2;

  function clientFields(required) {
    const mark = required ? ' *' : '';
    return [
      text('client', 'Имя' + mark),
      text('phone', 'Телефон' + mark, { type: 'tel', inputmode: 'tel' }),
      o.phone ? h('a', { href: telHref(o.phone), class: 'small', text: 'Позвонить ' + phoneText(o.phone) }) : null,
      text('address', 'Адрес'),
    ];
  }

  function draw() {
    const w = isWarranty(o);
    const issuedInput = h('input', { class: 'input', type: 'date', value: o.issued || '', oninput: (e) => { o.issued = e.target.value || null; recalc(); } });
    fill(body,
      isNew ? h('div', { style: 'margin-top:8px' }, chips([{ value: 'order', label: 'Заказ' }, { value: 'warranty', label: 'Гарантия' }],
        w ? 'warranty' : 'order', (v) => setWarranty(v === 'warranty'))) : null,
      oldScript() ? h('div', { class: 'banner warn', style: 'margin-top:12px' },
        h('b', { text: 'Обнови скрипт таблицы. ' }), 'Старый скрипт даст гарантийному заказу обычный номер, а не Г1, Г2… ',
        '«Ещё → Google Таблица» → «Скопировать код скрипта» → вставь в Apps Script вместо старого → «Сохранить» → Развертывание → Управление развертываниями → карандаш → Версия: «Новая версия» → Развернуть.',
        h('div', { class: 'row wrap', style: 'margin-top:10px' },
          h('button', { class: 'btn small', text: 'Открыть «Google Таблица»', onclick: () => app.openSheetSetup() }),
          h('button', { class: 'btn small', text: 'Я обновил, проверить', onclick: async () => { await app.sheet.refresh(); draw(); if (!oldScript()) toast('Скрипт обновлён'); } }))) : null,
      !isNew && w ? h('div', { class: 'banner', style: 'margin-top:8px' }, h('b', { text: 'Гарантийный ремонт' }), o.wfor ? ' по заказу №' + o.wfor : '') : null,
      // гарантия: клиент обязателен и идёт первым
      w ? h('div', {},
        h('h3', { style: 'margin-top:16px', text: 'Клиент' }),
        clientFields(true),
        originPicker(app, o, (x) => {
          o.wfor = x ? x.num : null;
          if (x) {
            o.client = x.client || o.client;
            o.phone = x.phone || o.phone;
            o.address = x.address || o.address;
            if (!o.model) { o.model = x.model || ''; o.device = x.device || o.device; }
          }
          draw();
        }),
        h('h3', { style: 'margin-top:20px', text: 'Ремонт' })) : null,
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
      text('problem', 'Неисправность', { placeholder: w ? 'Что случилось: треснула задняя крышка…' : 'Разбит дисплей, замена АКБ…' }),
      text('done', 'Что сделано'),
      h('div', { class: 'grid3' },
        text('price', 'Цена, р.', { inputmode: 'decimal', num: true }),
        text('part', 'Запчасть, р.', { inputmode: 'decimal', num: true }),
        text('prepay', 'Предоплата', { inputmode: 'decimal', num: true })),
      w ? h('div', { class: 'tiny faint', style: 'margin-top:6px', text: 'По гарантии клиент не платит: цена 0. Запчасть — твой расход, уйдёт в минус прибыли месяца.' }) : null,
      info,
      field('Источник', select(lists.sources, o.source || '', (v) => { o.source = v || null; }, { empty: '—' })),
      h('label', { class: 'switch', style: 'margin-top:8px' },
        h('input', { type: 'checkbox', checked: o.urgent === 'Да', onchange: (e) => { o.urgent = e.target.checked ? 'Да' : 'Нет'; } }), 'Срочно'),
      w ? null : h('details', { open: !!(o.client || o.phone || o.address) },
        h('summary', { text: 'Клиент (необязательно)' }),
        clientFields(false)),
      text('comment', 'Комментарий', { area: true }),
      isNew && cartPlan && cartPlan.items.length ? h('label', { class: 'switch', style: 'margin-top:10px' },
        h('input', {
          type: 'checkbox', checked: toCartOn,
          onchange: (e) => { toCartOn = e.target.checked; if (!cartPlan.same) store.set('orderToCart', toCartOn); },
        }),
        h('span', {}, cartPlan.same ? 'Те же детали в корзину' : 'Детали в корзину',
          h('span', { class: 'tiny faint', style: 'display:block', text: planText(cartPlan.items, cartPlan.glues) }))) : null,
      isNew ? null : orderActions(),
      // по выданному заказу можно сразу оформить гарантию
      !isNew && !w && o.num ? h('button', {
        class: 'btn small block', style: 'margin-top:16px', text: 'Гарантия по этому заказу',
        onclick: () => { sheet.close(); openOrderForm(app, null, warrantyPrefill(app, order)); },
      }) : null,
    );
    recalc();
  }

  const save = h('button', {
    class: 'btn primary', text: isNew ? 'Записать' : 'Сохранить',
    onclick: () => {
      const w = isWarranty(o);
      if (o.phone) o.phone = normPhone(o.phone);
      if (w && (!String(o.client || '').trim() || !String(o.phone || '').trim())) { toast('Для гарантии заполни имя и телефон клиента'); return; }
      if (w && String(o.phone).replace(/\D/g, '').length < 7) { toast('Проверь телефон клиента'); return; }
      if (oldScript()) { toast('Сначала обнови скрипт таблицы: иначе заказ получит обычный номер', 4000); return; }
      if (isNew) {
        const fields = {};
        for (const k of EDITABLE) if (o[k] !== null && o[k] !== undefined && o[k] !== '') fields[k] = o[k];
        if (!fields.model && !fields.problem && !fields.client) { toast('Заполни модель или неисправность'); return; }
        if (fields.source) store.set('lastSource', fields.source);
        app.sheet.add('addOrder', fields, w ? { warranty: true } : undefined);
        const toCart = cartPlan && cartPlan.items.length && toCartOn;
        if (toCart) app.addToCart(cartPlan.items.map(forOrder), cartPlan.glues);
        toast((w ? 'Гарантийный заказ записан' : 'Заказ записан') + (app.sheet.connected ? '' : ' в очередь') + (toCart ? ', детали в корзине' : ''));
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
  const w0 = isWarranty(o);
  const sheet = openSheet(isNew ? (w0 ? 'Гарантия' : 'Новый заказ') : (w0 ? 'Гарантия №' : 'Заказ №') + (order.num || '…'), body,
    [h('button', { class: 'btn', text: 'Отмена', onclick: () => sheet.close() }), save]);
  draw();
}

// По какому заказу гарантия: поиск по номеру, клиенту, телефону, модели. Без запроса — последние выданные.
// onPick(order) — выбран заказ, onPick(null) — убрать
function originPicker(app, o, onPick) {
  const lists = app.sheet.lists;
  const all = app.sheet.orders().filter((x) => x.num && !isWarranty(x));
  const describe = (x) => {
    const c = computed(x, lists.warrantyMonths);
    const ended = c.warranty && c.warranty < today();
    return h('span', {},
      [x.model || x.device, x.client, x.problem, x.issued ? 'выдан ' + fmtDate(x.issued) : null].filter(Boolean).join(' · '),
      c.warranty ? h('span', { style: ended ? 'color:var(--bad)' : null, text: (ended ? ' · гарантия закончилась ' : ' · гарантия до ') + fmtDate(c.warranty) }) : null);
  };
  if (o.wfor) {
    const x = all.find((y) => String(y.num) === String(o.wfor));
    return h('div', { class: 'card', style: 'margin-top:14px' },
      h('div', { class: 'row' }, h('b', { class: 'grow', text: 'По заказу №' + o.wfor }),
        h('button', { class: 'btn small ghost', text: 'Убрать', onclick: () => onPick(null) })),
      x ? h('div', { class: 'small muted', style: 'margin-top:4px' }, describe(x)) : null);
  }
  const results = h('div');
  const show = (q) => {
    const rows = q.trim()
      ? all.filter((x) => matchOrder(x, q.trim())).sort((a, b) => seq(b) - seq(a)).slice(0, 6)
      : all.filter((x) => x.status === 'Выдан').sort((a, b) => String(b.issued || b.date || '').localeCompare(String(a.issued || a.date || '')) || seq(b) - seq(a)).slice(0, 5);
    fill(results, rows.length
      ? h('div', { class: 'list', style: 'margin-top:8px' }, rows.map((x) => h('button', { type: 'button', class: 'item', onclick: () => onPick(x) },
        h('div', { class: 'grow' }, h('div', { class: 't', text: '№' + x.num }), h('div', { class: 's' }, describe(x))))))
      : h('div', { class: 'tiny faint', style: 'margin-top:8px', text: q.trim() ? 'Такого заказа нет. Можно записать гарантию и без него.' : '' }));
  };
  const input = h('input', {
    class: 'input', type: 'search', placeholder: 'Номер, имя, телефон или модель', autocomplete: 'off', autocorrect: 'off', spellcheck: false,
    oninput: () => show(input.value),
  });
  show('');
  return h('div', {}, field('По какому заказу (если есть в журнале)', input), results);
}
