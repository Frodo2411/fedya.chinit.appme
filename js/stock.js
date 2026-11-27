import { today } from './store.js';

const cents = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100);
export const ORDER_STOCK_LIMIT = 40;

export function stockCost(parts = []) {
  return parts.reduce((total, part) => total + cents(part.cost) * part.qty, 0) / 100;
}

export function orderPartTotal(direct, parts) {
  return parts.length ? (cents(direct) + cents(stockCost(parts))) / 100 : direct;
}

export function stockPositions(rows, orders = []) {
  const items = new Map();
  for (const row of rows) {
    if (row.kind === 'addStock') items.set(row.item, { id: row.item, qty: 0, history: [] });
    const item = items.get(row.item);
    if (!item) continue;
    if (row.kind === 'addStock' || row.kind === 'editStock') {
      Object.assign(item, { name: String(row.name || ''), model: String(row.model || ''), cost: row.cost });
    }
    if (row.kind === 'archiveStock') item.archived = true;
    if (row.pending) item.pending = true;
    item.qty += Number(row.qty) || 0;
    item.history.push(row.kind === 'moveStock' && row.cost == null ? { ...row, cost: item.cost } : row);
  }
  for (const order of orders) {
    for (const part of order.stockUse?.items ?? []) {
      const item = items.get(part.item);
      if (!item) continue;
      item.qty -= part.qty;
      item.history.push({ kind: 'orderStock', qty: -part.qty, cost: part.cost, date: order.stockUse.date || order.date,
        order: order.num, note: order.pending ? 'Ожидает синхронизации' : '', pending: !!order.pending });
    }
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.model.localeCompare(b.model, 'ru'));
}

function pendingDate(at) {
  if (!at) return today();
  const d = new Date(at);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function currentStock(sheet, orders = sheet.orders()) {
  const base = (sheet.cache?.stock ?? []).slice();
  const seen = new Set(base.map((row) => row.id));
  for (const op of sheet.outbox || []) {
    if (seen.has(op.id)) continue;
    const f = op.fields || {};
    const date = pendingDate(op.at);
    if (op.op === 'addStock') {
      base.push({ id: op.id, item: op.id, kind: 'addStock', date, name: f.name, model: f.model, cost: f.cost, qty: f.qty, order: '', note: '', pending: true });
    } else if (op.op === 'editStock') {
      base.push({ id: op.id, item: f.item, kind: 'editStock', date, name: f.name, model: f.model, cost: f.cost, qty: 0, order: '', note: '', pending: true });
    } else if (op.op === 'moveStock') {
      base.push({ id: op.id, item: f.item, kind: 'moveStock', date, name: '', model: '', cost: null, qty: f.qty, order: f.order || '', note: f.note || '', pending: true });
    } else if (op.op === 'archiveStock') {
      base.push({ id: op.id, item: f.item, kind: 'archiveStock', date, name: '', model: '', cost: null, qty: 0, order: '', note: '', pending: true });
    }
  }
  return stockPositions(base, orders);
}
