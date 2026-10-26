// Корзина мастера: детали, которые надо купить, по поставщикам. Лежит в настройках приложения
// (их зашифрованная копия есть в таблице), поэтому одна и та же на телефоне и на компьютере.
// Деталь:    { id, sup, name, cost, qty, model, svc, tier, uses: ['iPhone 11 · дисплей (копия)'], glues: {ключ проклейки: штук}, done, at }
// Проклейка: { id, sup, name, cost, qty, glue: 'gd', need: сколько штук нужно, per: штук в наборе, extra: наборов сверх нужного, … }
// Проклейка к детали кладётся вместе с ней (glues) и следует за её количеством: убрал деталь — её проклейка ушла.
// Набор «(5шт)» — один на пять ремонтов.

import { newId } from './store.js';

const key = (x) => x.sup + '|' + x.name;
const round2 = (n) => Math.round(n * 100) / 100;
const PACK = /\((\d+)\s*шт\.?\)/i;
const packOf = (name) => {
  const m = PACK.exec(name);
  return m && Number(m[1]) > 1 ? Number(m[1]) : 1;
};
const mergeUses = (a, b) => [...new Set([...(a || []), ...(b || [])])].slice(-5);
const usesOf = (item) => [...(item.uses || []), ...(item.use ? [item.use] : [])];
// строка проклейки из прошлой версии (без need): количество как было
const norm = (g) => (g.need === undefined ? { ...g, need: g.qty, per: 1, extra: 0 } : g);
const withQty = (g) => ({ ...g, qty: Math.max(1, Math.ceil(g.need / g.per) + (g.extra || 0)) });

function addPart(cart, item, n) {
  const have = cart.find((x) => !x.glue && key(x) === key(item));
  if (have) return cart.map((x) => (x === have ? { ...x, qty: x.qty + n, done: false, uses: mergeUses(x.uses, usesOf(item)) } : x));
  return [...cart, {
    id: newId(), sup: item.sup, name: item.name, cost: item.cost, qty: n,
    model: item.model || null, svc: item.svc || null, tier: item.tier || null, glue: null, glues: {},
    uses: mergeUses([], usesOf(item)), done: false, at: Date.now(),
  }];
}

function addGlue(cart, g, n) {
  const have = cart.find((x) => x.glue && key(x) === key(g));
  if (have) {
    const cur = norm(have);
    return cart.map((x) => (x === have ? withQty({ ...cur, need: cur.need + n, done: false, uses: mergeUses(cur.uses, usesOf(g)) }) : x));
  }
  return [...cart, withQty({
    id: newId(), sup: g.sup, name: g.name, cost: g.cost, glue: g.glue, model: g.model || null,
    need: n, per: packOf(g.name), extra: 0, uses: mergeUses([], usesOf(g)), done: false, at: Date.now(),
  })];
}

// Проклейке нужно на d штук больше (меньше); не нужна совсем — строка уходит
function adjustGlue(cart, k, d) {
  const g0 = d ? cart.find((x) => x.glue && key(x) === k) : null;
  if (!g0) return cart;
  const g = norm(g0);
  if (g.need + d <= 0) return cart.filter((x) => x !== g0);
  return cart.map((x) => (x === g0 ? withQty({ ...g, need: g.need + d }) : x));
}

// Проклейку убрали или купили: детали её больше не ведут
const unlink = (cart, k) => cart.map((x) => {
  if (!x.glues || !(k in x.glues)) return x;
  const glues = { ...x.glues };
  delete glues[k];
  return { ...x, glues };
});

// Добавить деталь (или проклейку, item.glue). Та же позиция того же поставщика — +1 к количеству (и снова «не куплено»).
// glues — проклейки, которые нужны этой детали: кладутся вместе с ней. item.use — для чего деталь.
export function cartAdd(cart, item, glues = []) {
  const n = item.qty || 1;
  if (item.glue) return addGlue(cart, item, n);
  let out = addPart(cart, item, n);
  for (const g of glues) {
    out = addGlue(out, g, n);
    out = out.map((x) => (!x.glue && key(x) === key(item) ? { ...x, glues: { ...x.glues, [key(g)]: ((x.glues || {})[key(g)] || 0) + n } } : x));
  }
  return out;
}

// Количество: у детали за ним идёт её проклейка, у проклейки — лишние наборы сверх нужного
export function cartSetQty(cart, id, qty) {
  const x = cart.find((y) => y.id === id);
  if (!x || qty < 1) return cart;
  if (x.glue) {
    const g = norm(x);
    return cart.map((y) => (y === x ? withQty({ ...g, extra: qty - Math.max(1, Math.ceil(g.need / g.per)) }) : y));
  }
  const delta = qty - x.qty;
  const glues = {};
  let out = cart;
  for (const [k, n] of Object.entries(x.glues || {})) {
    glues[k] = Math.min(qty, Math.max(0, n + delta));
    out = adjustGlue(out, k, glues[k] - n);
  }
  return out.map((y) => (y.id === id ? { ...y, qty, glues } : y));
}

// Убрать строку (не нужна): у детали уходит и её проклейка, если она больше ни для чего не нужна
export function cartRemove(cart, id) {
  const x = cart.find((y) => y.id === id);
  if (!x) return cart;
  let out = cart.filter((y) => y !== x);
  if (x.glue) return unlink(out, key(x));
  for (const [k, n] of Object.entries(x.glues || {})) out = adjustGlue(out, k, -n);
  return out;
}

// Убрать купленное. Проклейка, которую ещё не купили, остаётся: она нужна для этих ремонтов
export function cartClearDone(cart) {
  let out = cart.filter((x) => !x.done);
  for (const g of cart.filter((x) => x.done && x.glue)) out = unlink(out, key(g));
  return out;
}

// Купить у другого поставщика: деталь меняется, количество, «для чего» и проклейка остаются
export function cartReplace(cart, id, part) {
  const x = cart.find((y) => y.id === id);
  if (!x || x.glue) return cart;
  const same = cart.find((y) => y !== x && !y.glue && key(y) === key(part));
  if (!same) return cart.map((y) => (y === x ? { ...y, sup: part.sup, name: part.name, cost: part.cost, done: false } : y));
  const glues = { ...(same.glues || {}) };
  for (const [k, n] of Object.entries(x.glues || {})) glues[k] = (glues[k] || 0) + n;
  return cart.filter((y) => y !== x)
    .map((y) => (y === same ? { ...y, qty: y.qty + x.qty, uses: mergeUses(y.uses, x.uses), glues, done: false } : y));
}

export function cartQty(cart, sup, name) {
  const x = (cart || []).find((y) => y.sup === sup && y.name === name);
  return x ? x.qty : 0;
}

// Сколько позиций ещё купить
export function cartCount(cart) {
  return (cart || []).filter((x) => !x.done).length;
}

// По поставщикам, основной первым. Цена и наличие — из нынешнего прайса: если цена поменялась, видна новая;
// позиция пропала из прайса — цена из корзины и пометка gone. total — сколько осталось купить
export function cartGroups(cart, data) {
  const now = new Map();
  for (const p of data.parts) if (p.cost && !now.has(key(p))) now.set(key(p), p);
  const groups = new Map();
  for (const x of cart || []) {
    const cur = now.get(key(x));
    const line = { ...x, cost: cur ? cur.cost : x.cost, stock: cur ? cur.stock : null, gone: !cur };
    if (!groups.has(x.sup)) groups.set(x.sup, { sup: x.sup, items: [], total: 0, left: 0 });
    const g = groups.get(x.sup);
    g.items.push(line);
    if (!x.done) {
      g.total += (line.cost || 0) * line.qty;
      g.left++;
    }
  }
  const rank = (k) => (data.suppliers[k] && data.suppliers[k].rank !== undefined ? data.suppliers[k].rank : 9);
  return [...groups.values()].map((g) => ({ ...g, total: round2(g.total) })).sort((a, b) => rank(a.sup) - rank(b.sup));
}

// Текст для поставщика или для себя: что ещё не куплено, без цен
export function cartText(title, items) {
  const left = items.filter((x) => !x.done);
  return [title + ':', ...left.map((x) => '• ' + x.name + ' — ' + x.qty + (x.glue && x.per > 1 ? ' наб.' : ' шт.'))].join('\n');
}
