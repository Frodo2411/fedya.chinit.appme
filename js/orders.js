// Заказы и расходы: те же расчёты, что формулы в Google Таблице (Прибыль, К оплате, Гарантия до, Итоги).

export const DEFAULT_LISTS = {
  sources: ['Kufar', 'Onliner', 'Threads', 'Instagram', 'Сарафан', 'Повторное обращение', 'Другое'],
  devices: ['Телефон', 'Планшет', 'Приставка', 'Геймпад', 'ПК', 'Ноутбук', 'Принтер', 'Другое'],
  statuses: ['Обращение', 'Принят', 'Диагностика', 'Жду запчасть', 'В работе', 'Готов', 'Выдан', 'Долгосрок', 'Отказ'],
  hints: {
    'Обращение': 'позвонил/написал, техника ещё не у меня', 'Принят': 'техника у меня, ещё не смотрел', 'Диагностика': 'ищу причину',
    'Жду запчасть': 'запчасть заказана', 'В работе': 'ремонтирую', 'Готов': 'готово, клиент ещё не забрал', 'Выдан': 'отдал, деньги получил',
    'Долгосрок': 'клиент вернётся позже', 'Отказ': 'клиент отказался',
  },
  expenseCats: ['Инструмент', 'Расходники', 'Запчасти (не под заказ)', 'Реклама', 'Дорога', 'Другое'],
  warrantyMonths: 4,
};

export const ACTIVE = ['Обращение', 'Принят', 'Диагностика', 'Жду запчасть', 'В работе', 'Готов', 'Долгосрок'];
export const IN_REPAIR = ['Принят', 'Диагностика', 'Жду запчасть', 'В работе'];

const num = (v) => (typeof v === 'number' ? v : (v === null || v === undefined || v === '' ? 0 : Number(String(v).replace(',', '.')) || 0));
const empty = (v) => v === null || v === undefined || v === '';

// Гарантийный заказ: в таблице номер «Г1», «Г2»… (своя нумерация), ещё не отправленный — с признаком warrantyOrder,
// записанный старым скриптом с обычным номером — по «Гарантия по №». (o.warranty — это «Гарантия до», не путать)
export function isWarranty(o) {
  return !!o.warrantyOrder || /^\s*Г/i.test(String(o.num ?? '')) || (o.wfor !== null && o.wfor !== undefined && o.wfor !== '');
}

export function monthOf(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : null;
}

export function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

// Поля, которые в таблице считают формулы
export function computed(o, warrantyMonths) {
  const profit = empty(o.price) && empty(o.part) ? null
    : num(o.price) - (o.status === 'Отказ' && o.refusal === 'Вернул' ? 0 : num(o.part));
  const due = empty(o.price) ? null : num(o.price) - num(o.prepay);
  const warranty = o.issued ? addMonths(o.issued, warrantyMonths) : null;
  const month = empty(o.status) ? null : monthOf(o.issued || o.date);
  return { profit, due, warranty, month };
}

// Гарантийные ремонты считаются, как в таблице (запчасть уходит в минус прибыли), и отдельно: сколько их и во что обошлись
export function summary(orders, expenses, month, warrantyMonths) {
  const s = { taken: 0, issued: 0, revenue: 0, profit: 0, expenses: 0, net: 0, warranty: 0, warrantyCost: 0 };
  for (const o of orders) {
    const c = computed(o, warrantyMonths);
    if (monthOf(o.date) === month) s.taken++;
    if (c.month !== month) continue;
    if (o.status === 'Выдан') {
      s.issued++;
      s.revenue += num(o.price);
    }
    if (o.status === 'Выдан' || o.status === 'Отказ') {
      s.profit += c.profit || 0;
      if (isWarranty(o)) {
        s.warranty++;
        s.warrantyCost += num(o.part);
      }
    }
  }
  for (const e of expenses) if (monthOf(e.date) === month) s.expenses += num(e.sum);
  s.net = s.profit - s.expenses;
  return s;
}

export function statusCounts(orders) {
  const c = { lead: 0, repair: 0, ready: 0, later: 0 };
  for (const o of orders) {
    if (o.status === 'Обращение') c.lead++;
    else if (IN_REPAIR.includes(o.status)) c.repair++;
    else if (o.status === 'Готов') c.ready++;
    else if (o.status === 'Долгосрок') c.later++;
  }
  return c;
}

export function months(orders, expenses) {
  const set = new Set();
  for (const o of orders) {
    if (o.date) set.add(monthOf(o.date));
    if (o.issued) set.add(monthOf(o.issued));
  }
  for (const e of expenses) if (e.date) set.add(monthOf(e.date));
  return [...set].filter(Boolean).sort().reverse();
}
