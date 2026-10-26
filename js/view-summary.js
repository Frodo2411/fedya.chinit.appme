// Экран «Итоги»: месяц, выручка, прибыль, расходы. Считается так же, как лист «Итоги» в таблице.

import { h, fill, money, fmtDate, monthTitle, toast, openSheet, field, select, parseNum } from './ui.js';
import { summary, statusCounts, months } from './orders.js';
import { today } from './store.js';
import { connectCard } from './view-orders.js';

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
    const wm = app.sheet.lists.warrantyMonths;
    const s = summary(orders, expenses, st.month, wm);
    const now = statusCounts(orders);
    const ms = [...new Set([today().slice(0, 7), ...months(orders, expenses)])].sort().reverse().slice(0, 12);
    const monthExpenses = expenses.filter((e) => (e.date || '').startsWith(st.month)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const tile = (label, value, hl) => h('div', { class: 'tile' + (hl ? ' hl' : '') }, h('div', { class: 'v', text: value }), h('div', { class: 'l', text: label }));
    fill(root, 
      h('h1', { text: 'Итоги' }),
      h('div', { class: 'month' },
        h('button', { class: 'btn', 'aria-label': 'Прошлый месяц', text: '‹', onclick: () => shift(-1) }),
        h('b', { text: monthTitle(st.month) }),
        h('button', { class: 'btn', 'aria-label': 'Следующий месяц', text: '›', onclick: () => shift(1) })),
      h('div', { class: 'tiles' },
        tile('Принято заказов', String(s.taken)), tile('Выдано', String(s.issued)),
        tile('Выручка', money(s.revenue)), tile('Прибыль с заказов', money(s.profit)),
        tile('Расходы', money(s.expenses)), tile('Чистая прибыль', money(s.net), true)),
      s.warranty ? h('div', { class: 'small muted', style: 'margin-top:10px' },
        'Гарантийных ремонтов: ', h('b', { text: String(s.warranty) }), ', запчасти на них ', h('b', { text: money(s.warrantyCost) }),
        ' — уже вычтены из прибыли.') : null,
      h('h2', { text: 'Сейчас' }),
      h('div', { class: 'tiles' },
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
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {}, ['Месяц', 'Принято', 'Выдано', 'Выручка', 'Прибыль', 'Расходы', 'Чистая'].map((t) => h('th', { text: t })))),
          h('tbody', {}, ms.map((m) => {
            const x = summary(orders, expenses, m, wm);
            return h('tr', { onclick: () => { st.month = m; draw(); window.scrollTo(0, 0); } },
              [monthTitle(m), x.taken, x.issued, Math.round(x.revenue), Math.round(x.profit), Math.round(x.expenses), Math.round(x.net)].map((v) => h('td', { text: String(v) })));
          })))),
      h('div', { class: 'tiny faint', style: 'margin-top:10px', text: 'Прибыль с заказов = цена − запчасть по выданным заказам и отказам, налог не вычитается. Месяц заказа — по дате выдачи, а если её нет — по дате приёма.' }),
    );
  }

  return { el: root, draw };
}

export function openExpenseForm(app, exp) {
  const lists = app.sheet.lists;
  const isNew = !exp;
  const e = isNew ? { date: today(), cat: '', what: '', sum: null, where: '', comment: '' } : { ...exp };
  const orig = { ...e };
  const input = (key, label, opts = {}) => field(label, h('input', {
    class: 'input', type: opts.type || 'text', value: e[key] ?? '', inputmode: opts.inputmode, autocomplete: 'off',
    oninput: (ev) => { e[key] = opts.num ? parseNum(ev.target.value) : ev.target.value; },
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
        if (!e.what || e.sum === null) { toast('Заполни, что купил, и сумму'); return; }
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
