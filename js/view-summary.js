// Экран «Итоги»: месяц, выручка, прибыль, расходы. Считается так же, как лист «Итоги» в таблице.

import { h, fill, icon, money, number, fmtDate, monthTitle, toast, openSheet, field, select, parseNum } from './ui.js';
import { summary, statusCounts, months, sourceSummary } from './orders.js';
import { today } from './store.js';
import { connectCard } from './view-orders.js';
import { currentStock, stockCost } from './stock.js';

export function createSummaryView(app) {
  const st = { month: today().slice(0, 7) };
  const root = h('div');

  function shift(delta) {
    const [y, m] = st.month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    st.month = d.toISOString().slice(0, 7);
    draw();
  }

  function draw() {
    if (!app.sheet.connected) {
      fill(root, h('h1', { text: 'Итоги' }), connectCard(app, 'Заказы и расходы'));
      return;
    }
    const orders = app.sheet.orders();
    const expenses = app.sheet.expenses();
    const sNode = app.sheet;
    let syncText;
    if (sNode.busy) syncText = h('span', {}, h('span', { class: 'spin' }), ' Связь с таблицей…');
    else if (sNode.error) syncText = h('span', { style: 'color:var(--bad)', text: sNode.error });
    else if (sNode.outbox.length) syncText = 'Не отправлено: ' + sNode.outbox.length;
    else syncText = sNode.cache ? 'Обновлено в ' + new Date(sNode.cache.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Ещё не загружено';
    const expFailed = sNode.failed.filter((f) => f.op === 'addExpense' || f.op === 'updateExpense');
    const wm = app.sheet.lists.warrantyMonths;
    const s = summary(orders, expenses, st.month, wm);
    const stockValue = Array.isArray(app.sheet.cache?.stock)
      ? stockCost(currentStock(app.sheet, orders).filter((item) => !item.archived && item.qty > 0)) : null;
    const now = statusCounts(orders);
    const ms = [...new Set([today().slice(0, 7), ...months(orders, expenses)])].sort().reverse().slice(0, 12);
    const monthExpenses = expenses.filter((e) => (e.date || '').startsWith(st.month)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const tile = (label, value, hl) => h('div', { class: 'tile' + (hl === true ? ' hl' : hl ? ' ' + hl : '') }, h('div', { class: 'v', text: value }), h('div', { class: 'l', text: label }));
    fill(root, 
      h('h1', { text: 'Итоги' }),
      h('div', { class: 'syncbar' }, h('div', { class: 'grow' }, syncText),
        h('button', { class: 'btn small', 'aria-label': 'Обновить', disabled: sNode.busy, onclick: () => sNode.refresh() }, icon('refresh'))),
      expFailed.map((f) => h('div', { class: 'banner bad', style: 'margin-bottom:10px' },
        h('div', {}, h('b', { text: 'Расход не записался: ' }), (f.fields && f.fields.what) || '', ' — ', f.error),
        h('div', { class: 'row wrap', style: 'margin-top:8px' },
          h('button', { class: 'btn small', text: 'Повторить', onclick: () => sNode.retryFailed(f.id) }),
          h('button', { class: 'btn small ghost', text: 'Убрать', onclick: () => sNode.dropFailed(f.id) })))),
      h('div', { class: 'month' },
        h('button', { class: 'btn', 'aria-label': 'Прошлый месяц', text: '‹', onclick: () => shift(-1) }),
        h('b', { text: monthTitle(st.month) }),
        h('button', { class: 'btn', 'aria-label': 'Следующий месяц', text: '›', onclick: () => shift(1) })),
      h('div', { class: 'tiles' },
        tile('Принято заказов', String(s.taken)), tile('Выдано', String(s.issued)),
        tile('Выручка', money(s.revenue)), tile('Прибыль с заказов', money(s.profit)),
        tile('Расходы', money(s.expenses)), tile('Чистая прибыль', money(s.net), s.net < 0 ? 'hl-bad' : 'hl')),
      stockValue !== null ? h('div', { class: 'card row wrap', style: 'margin-top:12px' },
        h('div', { class: 'grow' }, h('b', { text: 'Склад сейчас' }),
          h('div', { class: 'small muted', text: 'Закупочная стоимость текущих остатков' })),
        h('b', { class: 'nowrap', text: money(stockValue) })) : null,
      s.stockCost ? h('div', { class: 'small muted', style: 'margin-top:10px' },
        'Детали со склада в себестоимости заказов: ', h('b', { text: money(s.stockCost) }), '. Уже учтены в прибыли.') : null,
      s.warranty ? h('div', { class: 'small muted', style: 'margin-top:10px' },
        'Гарантийных ремонтов: ', h('b', { text: String(s.warranty) }), ', запчасти на них ', h('b', { text: money(s.warrantyCost) }),
        ' — уже вычтены из прибыли.') : null,
      s.discounted ? h('div', { class: 'small muted', style: 'margin-top:10px' },
        'Выдано со скидкой: ', h('b', { text: String(s.discounted) }), ', скидки на ', h('b', { text: money(s.discountSum) }),
        ' — выручка и прибыль уже с ними.') : null,
      sourceTable(sourceSummary(orders, st.month)),
      h('h2', { text: 'Сейчас' }),
      h('div', { class: 'tiles four' },
        tile('Обращений (ещё не принёс)', String(now.lead)), tile('В ремонте', String(now.repair)),
        tile('Готово, ждёт клиента', String(now.ready)), tile('Долгосрок', String(now.later))),
      h('div', { class: 'row', style: 'margin-top:22px' }, h('h2', { class: 'grow', style: 'margin:0', text: 'Расходы за ' + monthTitle(st.month, false) }),
        h('button', { class: 'btn small primary', text: '+ Расход', onclick: () => openExpenseForm(app, null) })),
      h('div', { style: 'height:10px' }),
      monthExpenses.length ? h('div', { class: 'list' }, monthExpenses.map((e) => h('button', { class: 'item', onclick: () => openExpenseForm(app, e) },
        h('div', { class: 'grow' }, h('div', { class: 't', text: e.what || 'Без названия' }),
          h('div', { class: 's' }, [fmtDate(e.date, true), e.cat, e.where].filter(Boolean).join(' · '),
            e.pending ? h('span', { class: 'badge warn', style: 'margin-left:6px', text: 'не отправлено' }) : null)),
        h('b', { class: 'nowrap', text: money(e.sum) }))))
        : h('div', { class: 'empty', text: 'Расходов за этот месяц нет.' }),
      h('h2', { text: 'По месяцам' }),
      h('div', { class: 'card scrollx', style: 'padding:6px 10px' },
        h('table', { class: 'tbl clickable' },
          h('thead', {}, h('tr', {}, ['Месяц', 'Принято', 'Выдано', 'Выручка', 'Прибыль', 'Расходы', 'Чистая'].map((t) => h('th', { text: t })))),
          h('tbody', {}, ms.map((m) => {
            const x = summary(orders, expenses, m, wm);
            return h('tr', { class: m === st.month ? 'on' : null, onclick: () => { st.month = m; draw(); window.scrollTo(0, 0); } },
              [monthTitle(m), x.taken, x.issued, number(Math.round(x.revenue)), number(Math.round(x.profit)), number(Math.round(x.expenses)), number(Math.round(x.net))].map((v) => h('td', { text: String(v) })));
          })))),
      h('div', { class: 'tiny faint', style: 'margin-top:10px', text: 'Прибыль с заказов = цена − запчасть по выданным заказам и отказам, налог не вычитается. Месяц заказа — по дате выдачи, а если её нет — по дате приёма.' }),
    );
  }

  return { el: root, draw };
}

function sourceTable(rows) {
  return h('section', {},
    h('h2', { text: 'Откуда пришли клиенты' }),
    rows.length ? h('div', {},
      h('p', { class: 'small muted', text: 'Заказы, принятые в выбранном месяце, и их текущие статусы. Гарантии в статистику не входят.' }),
      h('div', { class: 'card scrollx', style: 'padding:6px 10px' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, ['Источник', 'Обращения', 'Выдано', 'Отказы'].map((title) => h('th', { scope: 'col', text: title })))),
        h('tbody', {}, rows.map((row) => h('tr', {},
          [row.source, row.total, row.issued, row.refused].map((value) => h('td', { text: String(value) }))))))))
      : h('div', { class: 'empty', text: 'В этом месяце обращений нет.' }));
}

export function openExpenseForm(app, exp) {
  const lists = app.sheet.lists;
  const isNew = !exp;
  const e = isNew ? { date: today(), cat: '', what: '', sum: null, where: '', comment: '' } : { ...exp };
  const orig = { ...e };
  const input = (key, label, opts = {}) => field(label, h('input', {
    class: 'input', type: opts.type || 'text', value: e[key] ?? '', inputmode: opts.inputmode, autocomplete: 'off',
    oninput: (ev) => {
      const v = ev.target.value;
      e[key] = opts.num ? parseNum(v) : (opts.type === 'date' ? v || null : v);
    },
  }));
  const body = h('div', {},
    input('what', 'Что купил'),
    h('div', { class: 'grid2' }, input('sum', 'Сумма, р.', { inputmode: 'decimal', num: true }), input('date', 'Дата', { type: 'date' })),
    field('Категория', select(lists.expenseCats, e.cat || '', (v) => { e.cat = v; }, { empty: '—' })),
    input('where', 'Где купил'),
    input('comment', 'Комментарий'));
  const KEYS = ['date', 'what', 'cat', 'sum', 'where', 'comment'];
  const sheet = openSheet(isNew ? 'Новый расход' : 'Расход', body, [
    h('button', { class: 'btn', text: 'Отмена', onclick: () => sheet.close() }),
    h('button', {
      class: 'btn primary', text: isNew ? 'Записать' : 'Сохранить',
      onclick: () => {
        if (!String(e.what || '').trim() || e.sum === null || e.sum < 0) { toast('Заполни, что купил, и корректную сумму'); return; }
        if (isNew) {
          const fields = {};
          for (const k of KEYS) if (e[k] !== null && e[k] !== '') fields[k] = e[k];
          app.sheet.add('addExpense', fields);
        } else {
          const changed = {};
          for (const k of KEYS) if ((e[k] ?? null) !== (orig[k] ?? null)) changed[k] = e[k] ?? '';
          if (Object.keys(changed).length) app.sheet.update('updateExpense', exp, changed);
        }
        toast('Сохранено');
        sheet.close();
        app.redraw();
      },
    }),
  ]);
}
