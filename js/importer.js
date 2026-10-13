// Обновление прайса поставщика из его файла.
// Знакомые позиции (то же точное название) берут прошлую разметку, новые размечаются правилами из rules.js.
// Знакомая позиция без модели размечается заново: вдруг её модель появилась в приложении (js/models-app.js).
// К знакомой позиции с моделями дописываются подходящие модели приложения, модели сайта остаются как были.
// Столбцы с названием, ценой и наличием ищутся сами; цену узнаём по совпадению с прошлыми ценами.

import { kindOf, families, mapRow, siteIndex, lineKey, BRAND_FAM } from './rules.js';
import { Pricer, SERVICES } from './engine.js';
import { APP_ONLY, APP_ALIASES } from './data.js';

export const IN_STOCK = 'В наличии';
export const OUT_OF_STOCK = 'Нет в наличии';

// Курс: поставщик с ценами в долларах — сколько рублей за доллар, иначе 1
export function supplierRate(s) {
  return s && s.currency === 'USD' && s.rate > 0 ? s.rate : 1;
}

const round2 = (x) => Math.round(x * 100) / 100;

// Новый курс поставщика в долларах: его закупочные цены пересчитываются сразу.
// old — курс, по которому они посчитаны (1 — лежат как есть, в долларах). Сначала обратно в доллары с точностью
// до цента, потом по новому курсу: так выходит то же, что при загрузке прайса по новому курсу, без лишних копеек.
export function withRate(data, supKey, rate, old = supplierRate(data.suppliers[supKey])) {
  const s = data.suppliers[supKey];
  const next = { ...s, currency: 'USD', rate };
  return {
    ...data,
    suppliers: { ...data.suppliers, [supKey]: next },
    parts: old === rate ? data.parts : data.parts.map((p) => (p.sup === supKey && p.cost ? { ...p, cost: round2(round2(p.cost / old) * rate) } : p)),
  };
}

// Курс, похожий на опечатку (305 вместо 3,05) или на резкий скачок: спросить, прежде чем пересчитать все цены
export function oddRate(rate, prev) {
  const t = (x) => String(x).replace('.', ',');
  if (!(rate >= 1.5 && rate <= 10)) return 'Курс ' + t(rate) + ' р. за $ — точно? Обычно он около 3.';
  if (prev > 0 && Math.abs(Math.log(rate / prev)) > Math.log(1.2)) return 'Курс меняется с ' + t(prev) + ' на ' + t(rate) + ' р. за $ — сразу на ' + Math.round(Math.abs(rate / prev - 1) * 100) + '%. Точно?';
  return null;
}

// Поставщик после загрузки: дата, курс; цены теперь из файла — отметка «пересчитаны из долларов» (costRate) не нужна
function supAfter(s, today, rate) {
  const next = { ...s, date: today, ...(s.currency === 'USD' ? { rate } : {}) };
  delete next.costRate;
  return next;
}

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
  const rate = supplierRate(data.suppliers[supKey]);
  const width = Math.max(...partRows.map((r) => r.length));
  const priceCols = [];
  for (let ci = 0; ci < width; ci++) {
    if (ci === best.name) continue;
    let nums = 0;
    let hits = 0;
    const logs = [];
    for (const r of partRows) {
      const p0 = parsePrice(r[ci]);
      if (p0 === null) continue;
      const p = p0 * rate;
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
  // при равенстве — по заголовку: «Цена, BYN» лучше «Цена, $» (у поставщика в долларах — наоборот), артикул и код — не цена
  const notPrice = (c) => (/артикул|арт\.|^\s*код|код\s+товар|штрих/i.test(c.head) ? 3 : 0);
  const byHead = rate === 1
    ? (c) => (/byn|руб|бел|\bbr\b|р\.|цена/i.test(c.head) ? 1 : 0) - (/usd|\$|долл|eur|€/i.test(c.head) ? 2 : 0) - notPrice(c)
    : (c) => (/usd|\$|долл|у\.\s?е\.|цена|price/i.test(c.head) ? 1 : 0) - (/byn|руб|бел|\bbr\b|р\.|eur|€/i.test(c.head) ? 2 : 0) - notPrice(c);
  priceCols.sort((a, b) => (b.hits - a.hits) || ((a.median ?? 9) - (b.median ?? 9)) || (byHead(b) - byHead(a)) || (a.col - b.col));
  let stockCol = null;
  let stockCols = null;
  // наличие отметками «+»/«-» по складу и магазинам: в наличии, если «+» хоть где-то, кроме других городов
  const plus = [];
  if (data.suppliers[supKey] && data.suppliers[supKey].stock) {
    for (let ci = 0; ci < width; ci++) {
      if (ci === best.name) continue;
      let n = 0;
      for (const r of partRows) if (typeof r[ci] === 'string' && /^[+-]$/.test(r[ci].trim())) n++;
      if (n >= partRows.length * 0.5 && !(header && OTHER_CITY.test(String(header[ci] ?? '')))) plus.push(ci);
    }
    if (plus.length > 1) stockCols = plus;
  }
  if (stockCols) stockCol = stockCols[0];
  else if (data.suppliers[supKey] && data.suppliers[supKey].stock) {
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
    // один магазин с «+»/«-» без слова «наличие» в заголовке
    if (stockCol === null && plus.length === 1) stockCol = plus[0];
  }
  return {
    sheet: best.sheet, sheetName: sheets[best.sheet].name, nameCol: best.name, priceCol: priceCols[0].col, stockCol, stockCols,
    priceCols, partRows: partRows.length, header, rate,
  };
}

// Заголовок таблицы: до первой детали строка, где больше всего коротких ячеек «Цена», «Наименование», «Склад»…
// (длинная «Гарантия качества по лучшим ценам!» — не заголовок)
function headerRow(rows, nameCol) {
  let best = null;
  let top = 0;
  for (const r of rows.slice(0, 40)) {
    if (typeof r[nameCol] === 'string' && kindOf(r[nameCol])) break;
    const n = r.filter((v) => typeof v === 'string' && v.length <= 40 && /цена|наимен|назван|товар|налич|byn|usd|склад|артикул/i.test(v)).length;
    if (n > top) { top = n; best = r; }
  }
  return top ? best : null;
}

const OTHER_CITY = /гомел|брест|гродн|витеб|могил/i;

function knownCosts(data, supKey) {
  const m = new Map();
  for (const p of data.parts) if (p.sup === supKey && p.cost) m.set(keyOf(p.name), p.cost);
  return m;
}

// Собрать новые данные и отчёт. cols — результат detect() (можно поправить вручную).
export function buildImport(data, supKey, sheets, cols, today) {
  const rows = sheets[cols.sheet].rows;
  const siteNames = data.models.map((m) => m.model);
  const idx = siteIndex(siteNames, APP_ALIASES);
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
  const report = { file: { rows: rows.length, parts: 0, otherBrands: 0, noPrice: 0 }, known: 0, extended: 0, priceUp: [], priceDown: [], fresh: [], unmapped: [], gone: [] };
  for (const r of rows) {
    const raw = r[cols.nameCol];
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    const svc = kindOf(name);
    if (!svc) continue;
    report.file.parts++;
    const key = keyOf(name);
    const price = parsePrice(r[cols.priceCol]);
    const cost = price === null ? null : round2(price * (cols.rate || 1));
    if (cost === null) report.file.noPrice++;
    const stock = cols.stockCols && cols.stockCols.length
      ? (cols.stockCols.some((ci) => typeof r[ci] === 'string' && r[ci].trim() === '+') ? IN_STOCK : OUT_OF_STOCK)
      : cols.stockCol === null || cols.stockCol === undefined ? null : normStock(r[cols.stockCol]);
    const olds = known.get(key);
    const n = used.get(key) || 0;
    let old = olds ? olds[Math.min(n, olds.length - 1)] : null;
    used.set(key, n + 1);
    if (old && !old.models.length && families(name).size && mapRow(name, svc, idx, famOfModel).models.length) old = null;
    // вид детали теперь другой (шлейф SIM был «разъёмом зарядки»): размечаем заново, снятую галочкой не трогаем
    if (old && old.svc !== svc && old.tier !== 'skip') old = null;
    if (old) {
      seen.add(key);
      report.known++;
      if (old.cost && cost && Math.abs(cost - old.cost) >= 0.01 && old.tier !== 'skip' && old.models.length) {
        (cost > old.cost ? report.priceUp : report.priceDown).push({ name, old: old.cost, cost });
      }
      const extra = old.models.length && families(name).size
        ? mapRow(name, svc, idx, famOfModel).models.filter((m) => APP_ONLY.has(m) && !old.models.includes(m)) : [];
      if (extra.length) report.extended++;
      // линия (название без цвета) — по нынешним правилам: новые цвета вроде «ПОЛУНОЧНЫЙ» сливаются с остальными
      parts.push({ ...old, name, cost, stock, models: extra.length ? [...old.models, ...extra] : old.models, line: lineKey(name) });
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
    suppliers: { ...data.suppliers, [supKey]: supAfter(data.suppliers[supKey], today, cols.rate) },
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
