// Выкуп: купил сломанное → починил → продал. Те же расчёты, что формулы на листах «Устройства» и «Запчасти» в таблице:
// себестоимость = цена покупки + запчасти + прочие расходы, прибыль = цена продажи − себестоимость,
// доходность = прибыль ÷ себестоимость. Продано — когда есть цена продажи (факт).

// Те же списки, что выпадающие списки на листах таблицы
export const DEVICE_STATUSES = ['Куплено', 'В ремонте', 'Ждёт запчасть', 'Готово', 'Выставлено', 'Продано'];
export const DEVICE_CATS = ['Телефон', 'Планшет', 'Ноутбук', 'ПК', 'Приставка', 'Другое'];
export const DEVICE_SOURCES = ['Куфар', 'Онлайнер', 'Знакомые', 'Магазин', 'Другое'];
export const PART_SOURCES = ['AliExpress', 'Куфар', 'Магазин', 'Радиорынок', 'Другое'];
export const PART_STATUSES = ['Нужна', 'Заказана', 'Получена', 'Установлена'];
export const SOLD = 'Продано';
// Операции очереди, которые относятся к выкупу (остальные — заказы и расходы)
export const DEVICE_OPS = ['addDevice', 'updateDevice', 'deleteDevice', 'addPart', 'updatePart', 'deletePart'];

const num = (v) => (typeof v === 'number' ? v : (v === null || v === undefined || v === '' ? 0 : Number(String(v).replace(',', '.')) || 0));
export const empty = (v) => v === null || v === undefined || v === '';

export function isSold(d) {
  return !empty(d.sold);
}

// Статус и цена продажи не сходятся: «Продано» без цены или цена без «Продано» (на листе «Сводка» — «Расхождения»)
export function statusMismatch(d) {
  return (d.status === SOLD) !== isSold(d);
}

// Запчасти устройства: по номеру, а у ещё не отправленного в таблицу — по id его добавления (dref)
export function partsOf(d, parts) {
  return parts.filter((p) => (!empty(d.num) && !empty(p.dnum) && String(p.dnum) === String(d.num)) || (d.pendingId && p.dref === d.pendingId));
}

// Дней между датами «2026-10-01» и «2026-10-20»
export function dayDiff(from, to) {
  const t = (s) => Date.UTC(...s.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
  return Math.round((t(to) - t(from)) / 86400000);
}

// Поля, которые на листе считают формулы. today — для «дней в работе» у непроданного
export function deviceCalc(d, parts, today) {
  const partsSum = partsOf(d, parts).reduce((a, p) => a + num(p.price), 0);
  const cost = num(d.buy) + partsSum + num(d.other);
  const planProfit = empty(d.plan) ? null : num(d.plan) - cost;
  const profit = isSold(d) ? num(d.sold) - cost : null;
  const roi = profit === null ? null : (cost === 0 ? 0 : profit / cost);
  let days = null;
  if (d.date && d.soldDate) days = dayDiff(d.date, d.soldDate);
  else if (d.date && !isSold(d) && today) days = dayDiff(d.date, today);
  return { parts: partsSum, cost, planProfit, profit, roi, days };
}

// Итоги как на листе «Сводка»: вложено, выручка, заработано, ожидается с непроданных
export function deviceSummary(devices, parts, today) {
  const s = { count: 0, sold: 0, open: 0, invested: 0, investedSold: 0, investedOpen: 0, revenue: 0, profit: 0, expected: 0, total: 0, roi: 0, avgDays: null };
  let days = 0;
  let daysN = 0;
  for (const d of devices) {
    const c = deviceCalc(d, parts, today);
    s.count++;
    s.invested += c.cost;
    if (isSold(d)) {
      s.sold++;
      s.investedSold += c.cost;
      s.revenue += num(d.sold);
      s.profit += c.profit;
      if (c.days !== null) { days += c.days; daysN++; }
    } else {
      s.investedOpen += c.cost;
      if (c.planProfit !== null) s.expected += c.planProfit;
    }
  }
  s.open = s.count - s.sold;
  s.total = s.profit + s.expected;
  s.roi = s.investedSold === 0 ? 0 : s.profit / s.investedSold;
  s.avgDays = daysN ? days / daysN : null;
  for (const k of ['invested', 'investedSold', 'investedOpen', 'revenue', 'profit', 'expected', 'total']) s[k] = Math.round(s[k] * 100) / 100;
  return s;
}

// Цена лота на n устройств поровну, до копейки: 50 на 3 → 16,67 + 16,67 + 16,66
export function splitEven(total, n) {
  const cents = Math.round(num(total) * 100);
  const base = Math.floor(cents / n);
  const rest = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < rest ? 1 : 0)) / 100);
}

// Калькулятор перед покупкой. target и min — доходность долей (0.35 = 35 %).
// maxTarget — сколько можно заплатить, чтобы заработать target на вложенное; maxMin — край, при котором ещё min
export function buyCalc({ ask, parts, other, sale, target, min }) {
  const extra = num(parts) + num(other);
  const hasAsk = !empty(ask);
  const hasSale = !empty(sale);
  const cost = hasAsk ? num(ask) + extra : null;
  const profit = hasAsk && hasSale ? num(sale) - cost : null;
  const roi = profit === null ? null : (cost === 0 ? 0 : profit / cost);
  const round = (x) => Math.round(x * 100) / 100;
  const maxTarget = hasSale ? round(num(sale) / (1 + num(target)) - extra) : null;
  const maxMin = hasSale ? round(num(sale) / (1 + num(min)) - extra) : null;
  let verdict = null;
  if (hasAsk && hasSale) verdict = num(ask) <= maxTarget ? 'good' : (num(ask) <= maxMin ? 'haggle' : 'expensive');
  return { cost, profit, roi, maxTarget, maxMin, verdict };
}
