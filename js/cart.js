// Корзина мастера: детали, которые надо купить, по поставщикам. Лежит в настройках приложения
// (их зашифрованная копия есть в таблице), поэтому одна и та же на телефоне и на компьютере.
// Строка: { id, sup, name, cost, qty, model, svc, tier, glue, uses: ['iPhone 11 · дисплей (копия)'], done, at }

import { newId } from './store.js';

const key = (x) => x.sup + '|' + x.name;
const round2 = (n) => Math.round(n * 100) / 100;

// Добавить деталь. Та же позиция того же поставщика — +1 к количеству (и снова «не куплено»).
// item.use — для чего деталь (строка), item.uses — список (при замене поставщика)
export function cartAdd(cart, item) {
  const uses = [...(item.uses || []), ...(item.use ? [item.use] : [])];
  const have = cart.find((x) => key(x) === key(item));
  if (have) {
    const merged = [...new Set([...(have.uses || []), ...uses])].slice(-5);
    return cart.map((x) => (x === have ? { ...x, qty: x.qty + (item.qty || 1), done: false, uses: merged } : x));
  }
  return [...cart, {
    id: newId(), sup: item.sup, name: item.name, cost: item.cost, qty: item.qty || 1,
    model: item.model || null, svc: item.svc || null, tier: item.tier || null, glue: item.glue || null,
    uses: [...new Set(uses)], done: false, at: Date.now(),
  }];
}

// Купить у другого поставщика: строка меняет деталь, количество и «для чего» остаются
export function cartReplace(cart, id, part) {
  const x = cart.find((y) => y.id === id);
  if (!x) return cart;
  const rest = cart.filter((y) => y.id !== id);
  return cartAdd(rest, { ...x, sup: part.sup, name: part.name, cost: part.cost, use: null });
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
  return [title + ':', ...left.map((x) => '• ' + x.name + ' — ' + x.qty + ' шт.')].join('\n');
}
