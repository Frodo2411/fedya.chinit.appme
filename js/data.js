// Пакет данных прайса в компактном виде (массивы) и обратно в объекты.
// models: [brand, model, year, ifixit, smartfix{}, smartfixUrl]
// parts:  [supplier, name, cost, stock, svc, tier, [model indexes], line (0 — как name)]

import { APP_MODELS, SITE_ALIASES } from './models-app.js';
import { kindOf, tier as tierByRules, fixTier } from './rules.js';

// Модели только для приложения: на сайте их нет, а детали у поставщиков есть (js/models-app.js).
// Детали к ним размечаются при загрузке прайса поставщика, в файл для сайта они не попадают.
export const APP_ONLY = new Set(APP_MODELS.map((m) => m[1]));
// Другие названия моделей у поставщиков: название → модель (приложения и сайта)
export const APP_ALIASES = new Map([...APP_MODELS.flatMap((m) => (m[3] || []).map((a) => [a, m[1]])), ...SITE_ALIASES]);

export function decode(b) {
  const models = b.models.map(([brand, model, year, ifixit, sf, sfUrl]) => ({
    brand, model, year: year || null, ifixit: ifixit === undefined ? null : ifixit, sf: sf || null, sfUrl: sfUrl || null,
  }));
  const names = models.map((m) => m.model);
  const parts = b.parts.map(([sup, name, cost, stock, svc, tier, ms, line]) => ({
    sup, name, cost, stock: stock || null, svc, tier, models: ms.map((i) => names[i]), line: line === 0 ? name : line,
  }));
  // Пакет до выпуска 2026-10-28.2: «Задняя крышка для iPhone…» лежала в «Корпусе». Теперь это задняя крышка —
  // переносим и размечаем вариант по правилам крышки, как при загрузке прайса (снятую галочкой не трогаем)
  for (const p of parts) {
    if (p.svc !== 'hs' || kindOf(p.name) !== 'c') continue;
    p.svc = 'c';
    if (p.tier === 'skip') continue;
    const t = tierByRules('c', p.name);
    p.tier = t === 'skip' ? t : fixTier('c', p.name, p.models, t, false);
  }
  // бренд и год моделей приложения — из models-app.js, даже если пакет сохранён старой версией
  const appBy = new Map(APP_MODELS.map(([brand, model, year]) => [model, { brand, year }]));
  for (const m of models) {
    const a = appBy.get(m.model);
    if (a) { m.brand = a.brand; m.year = a.year; }
  }
  const have = new Set(names);
  for (const [brand, model, year] of APP_MODELS) {
    if (!have.has(model)) models.push({ brand, model, year, ifixit: null, sf: null, sfUrl: null });
  }
  return {
    v: b.v, priceDate: b.priceDate, sfDate: b.sfDate, suppliers: b.suppliers, models, parts,
    history: b.history || [],
  };
}

export function encode(d) {
  const at = new Map(d.models.map((m, i) => [m.model, i]));
  return {
    v: d.v || 1,
    priceDate: d.priceDate,
    sfDate: d.sfDate,
    suppliers: d.suppliers,
    models: d.models.map((m) => [m.brand, m.model, m.year, m.ifixit, m.sf, m.sfUrl]),
    parts: d.parts.map((p) => [p.sup, p.name, p.cost, p.stock || null, p.svc, p.tier,
      p.models.filter((m) => at.has(m)).map((m) => at.get(m)), p.line === p.name ? 0 : p.line]),
    history: d.history || [],
  };
}
