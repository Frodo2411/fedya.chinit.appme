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
    item.qty += Number(row.qty) || 0;
    item.history.push(row);
  }
  for (const order of orders) {
    for (const part of order.stockUse?.items ?? []) {
      const item = items.get(part.item);
      if (!item) continue;
      item.qty -= part.qty;
      item.history.push({ kind: 'orderStock', qty: -part.qty, cost: part.cost, date: order.stockUse.date || order.date,
        order: order.num, note: order.pending ? 'Ожидает синхронизации' : '' });
    }
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.model.localeCompare(b.model, 'ru'));
}

export function currentStock(sheet, orders = sheet.orders()) {
  const archiving = new Set(sheet.outbox.filter((op) => op.op === 'archiveStock').map((op) => op.fields.item));
  const items = stockPositions(sheet.cache?.stock ?? [], orders);
  for (const item of items) if (archiving.has(item.id)) item.archived = true;
  return items;
}
