// Обновление прайса поставщика из его файла.
// Знакомые позиции (то же точное название) берут прошлую разметку, новые размечаются правилами из rules.js.
// Столбцы с названием, ценой и наличием ищутся сами; цену узнаём по совпадению с прошлыми ценами.

import { kindOf, families, mapRow, siteIndex, BRAND_FAM } from './rules.js';
import { Pricer, SERVICES } from './engine.js';

export const IN_STOCK = 'В наличии';
export const OUT_OF_STOCK = 'Нет в наличии';

export function keyOf(name) {
  return String(name).replace(/\s+/g, ' ').trim();
}

export function parsePrice(v) {
  if (typeof v === 'number') return v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normStock(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 0 ? IN_STOCK : OUT_OF_STOCK;
  const s = String(v).trim();
  if (/нет в наличии|отсутств|^нет\b|^-$|^0$/i.test(s)) return OUT_OF_STOCK;
  if (/в наличии|^есть|много|^\+$|^>\s*\d|^\d+$|^да$/i.test(s)) return IN_STOCK;
  return s;
}

const colName = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export { colName };

// Найти лист и столбцы
export function detect(sheets, supKey, data) {
  let best = null;
  sheets.forEach((sh, si) => {
    const counts = [];
    for (const row of sh.rows) row.forEach((v, ci) => { if (typeof v === 'string' && kindOf(v)) counts[ci] = (counts[ci] || 0) + 1; });
    counts.forEach((c, ci) => { if (c && (!best || c > best.count)) best = { sheet: si, name: ci, count: c }; });
  });
  if (!best || best.count < 3) throw new Error('Не нашёл в файле названий деталей (Аккумулятор…, Дисплей…, Задняя крышка…, Плата зарядки…).');
  const rows = sheets[best.sheet].rows;
  const partRows = rows.filter((r) => typeof r[best.name] === 'string' && kindOf(r[best.name]));
  const header = headerRow(rows, best.name);
  const known = knownCosts(data, supKey);
  const width = Math.max(...partRows.map((r) => r.length));
  const priceCols = [];
  for (let ci = 0; ci < width; ci++) {
    if (ci === best.name) continue;
    let nums = 0;
    let hits = 0;
    const logs = [];
    for (const r of partRows) {
      const p = parsePrice(r[ci]);
      if (p === null) continue;
      nums++;
      const old = known.get(keyOf(r[best.name]));
      if (old) {
        const l = Math.abs(Math.log(p / old));
        logs.push(l);
        if (l < Math.log(1.5)) hits++;
      }
    }
    if (nums < partRows.length * 0.3) continue;
    logs.sort((a, b) => a - b);
    priceCols.push({ col: ci, nums, hits, known: logs.length, median: logs.length ? logs[Math.floor(logs.length / 2)] : null, head: header ? String(header[ci] ?? '') : '' });
  }
  if (!priceCols.length) throw new Error('Не нашёл столбец с ценами.');
  const byHead = (c) => (/byn|руб|бел|\bbr\b|р\.|цена/i.test(c.head) ? 1 : 0) - (/usd|\$|долл|eur|€/i.test(c.head) ? 2 : 0);
  priceCols.sort((a, b) => (b.hits - a.hits) || ((a.median ?? 9) - (b.median ?? 9)) || (byHead(b) - byHead(a)) || (a.col - b.col));
  let stockCol = null;
  if (data.suppliers[supKey] && data.suppliers[supKey].stock) {
    let top = 0;
    for (let ci = 0; ci < width; ci++) {
      if (ci === best.name) continue;
      let n = 0;
      for (const r of partRows) if (typeof r[ci] === 'string' && /налич|заказ|ожида|^нет$|^есть$/i.test(r[ci].trim())) n++;
      if (n > top && n >= partRows.length * 0.2) { top = n; stockCol = ci; }
    }
    if (stockCol === null && header) {
      const hi = header.findIndex((h, ci) => ci !== best.name && typeof h === 'string' && /налич|остат|кол-?во|склад|qty/i.test(h));
      if (hi >= 0) stockCol = hi;
    }
  }
  return {
    sheet: best.sheet, sheetName: sheets[best.sheet].name, nameCol: best.name, priceCol: priceCols[0].col, stockCol,
    priceCols, partRows: partRows.length, header,
  };
}

function headerRow(rows, nameCol) {
  for (const r of rows.slice(0, 40)) {
    const texts = r.filter((v) => typeof v === 'string');
    if (texts.length >= 2 && texts.some((t) => /цена|наимен|назван|товар|налич|byn|usd/i.test(t))) return r;
    if (typeof r[nameCol] === 'string' && kindOf(r[nameCol])) break;
  }
  return null;
}

function knownCosts(data, supKey) {
  const m = new Map();
  for (const p of data.parts) if (p.sup === supKey && p.cost) m.set(keyOf(p.name), p.cost);
  return m;
}

// Собрать новые данные и отчёт. cols — результат detect() (можно поправить вручную).
export function buildImport(data, supKey, sheets, cols, today) {
  const rows = sheets[cols.sheet].rows;
  const siteNames = data.models.map((m) => m.model);
  const idx = siteIndex(siteNames);
  const famOfModel = new Map(data.models.map((m) => [m.model, BRAND_FAM[m.brand]]));
  // Одинаковые названия бывают у поставщика дважды: сопоставляем их по порядку
  const known = new Map();
  for (const p of data.parts) {
    if (p.sup !== supKey) continue;
    const k = keyOf(p.name);
    if (!known.has(k)) known.set(k, []);
    known.get(k).push(p);
  }
  const used = new Map();
  const seen = new Set();
  const parts = [];
  const report = { file: { rows: rows.length, parts: 0, otherBrands: 0, noPrice: 0 }, known: 0, priceUp: [], priceDown: [], fresh: [], unmapped: [], gone: [] };
  for (const r of rows) {
    const raw = r[cols.nameCol];
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    const svc = kindOf(name);
    if (!svc) continue;
    report.file.parts++;
    const key = keyOf(name);
    const cost = parsePrice(r[cols.priceCol]);
    if (cost === null) report.file.noPrice++;
    const stock = cols.stockCol === null || cols.stockCol === undefined ? null : normStock(r[cols.stockCol]);
    const olds = known.get(key);
    const n = used.get(key) || 0;
    const old = olds ? olds[Math.min(n, olds.length - 1)] : null;
    used.set(key, n + 1);
    if (old) {
      seen.add(key);
      report.known++;
      if (old.cost && cost && Math.abs(cost - old.cost) >= 0.01 && old.tier !== 'skip' && old.models.length) {
        (cost > old.cost ? report.priceUp : report.priceDown).push({ name, old: old.cost, cost });
      }
      parts.push({ ...old, name, cost, stock });
      continue;
    }
    if (!families(name).size) { report.file.otherBrands++; continue; }
    const m = mapRow(name, svc, idx, famOfModel);
    const part = { sup: supKey, name, cost, stock, svc, tier: m.tier, models: m.models, line: m.line, fresh: true };
    parts.push(part);
    seen.add(key);
    if (m.tier !== 'skip' && m.models.length) report.fresh.push(part);
    else report.unmapped.push(name);
  }
  if (!report.file.parts) throw new Error('В выбранном столбце нет названий деталей.');
  // Пропавшие из прайса позиции оставляем без цены: разметка пригодится, если они вернутся
  for (const p of data.parts) {
    if (p.sup !== supKey || seen.has(keyOf(p.name))) continue;
    if (p.cost && p.tier !== 'skip' && p.models.length) report.gone.push(p.name);
    parts.push({ ...p, cost: null, stock: null });
  }
  const others = data.parts.filter((p) => p.sup !== supKey);
  const next = {
    ...data,
    priceDate: today,
    suppliers: { ...data.suppliers, [supKey]: { ...data.suppliers[supKey], date: today } },
    parts: [...others, ...parts],
    history: [...(data.history || []), { date: today, sup: supKey, rows: report.file.parts, fresh: report.fresh.length, gone: report.gone.length }].slice(-24),
  };
  report.priceUp.sort((a, b) => (b.cost - b.old) - (a.cost - a.old));
  report.priceDown.sort((a, b) => (a.cost - a.old) - (b.cost - b.old));
  return { next, report };
}

// Чем отличаются цены клиенту в двух наборах данных
export function clientChanges(oldData, newData, settings) {
  const a = new Pricer(oldData, settings);
  const b = new Pricer(newData, settings);
  const out = [];
  for (const m of newData.models) {
    const ea = a.model(m.model);
    const eb = b.model(m.model);
    for (const svc of SERVICES) {
      const va = new Map(ea.services[svc].opts.filter((o) => !o.hidden).map((o) => [o.tier, o.price]));
      const vb = new Map(eb.services[svc].opts.filter((o) => !o.hidden).map((o) => [o.tier, o.price]));
      for (const tier of new Set([...va.keys(), ...vb.keys()])) {
        const pa = va.get(tier) ?? null;
        const pb = vb.get(tier) ?? null;
        if (pa !== pb) out.push({ model: m.model, svc, tier, old: pa, price: pb });
      }
    }
  }
  return out;
}
