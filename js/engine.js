// Расчёт цены клиенту по модели, ремонту и варианту детали.
// Повторяет build_prices.py из prais-tools: те же правила, то же округление, тот же выбор детали.

import { pyRe } from './pyre.js';
import { APP_ONLY } from './data.js';

// Ремонты сайта и ремонты только для приложения: по любой детали из прайса (камеры, динамики, шлейфы, корпус…)
export const SITE_SERVICES = ['b', 'd', 'p', 'c'];
export const MORE_SERVICES = ['cr', 'cf', 'ls', 'es', 'vb', 'fp', 'bt', 'fx', 'fo', 'hs', 'cg', 'sim', 'tc', 'gl'];
export const SERVICES = [...SITE_SERVICES, ...MORE_SERVICES];

// Варианты от слабого к лучшему. Слабый вариант, который не дешевле лучшего, прячем.
export const ORDER = {
  b: ['copy', 'copy_boost', 'verified', 'orig_used', 'orig_new'],
  d: ['copy_lcd', 'copy_oled', 'orig_reglass', 'orig_used', 'orig_new'],
  p: ['copy', 'orig_used', 'orig_new'],
  c: ['copy', 'orig_used', 'orig_new'],
};
for (const svc of MORE_SERVICES) ORDER[svc] = ['copy', 'orig_used', 'orig_new'];
// Задняя камера: у телефона несколько модулей (основной, широкий, макро), по умолчанию берём самый дорогой — основной
const MOST_EXPENSIVE = new Set(['cr']);

// С какой ценой SmartFix сравниваем вариант
const SF_KEY = {
  'b:copy': 'battery', 'b:copy_boost': 'battery', 'b:orig_used': 'battery_orig', 'b:orig_new': 'battery_orig',
  'd:copy_lcd': 'display_copy', 'd:copy_oled': 'display_copy_oled_mid',
  'd:orig_reglass': 'display_orig', 'd:orig_used': 'display_orig', 'd:orig_new': 'display_orig',
  'p:copy': 'port', 'c:copy': 'cover',
};

export const DEFAULTS = {
  // Новые ремонты — по прайсам сервисов Минска (октябрь 2026), в той же шкале, что аккумулятор и дисплей
  base: { b: 50, d: 60, p: 45, c: 35, cr: 45, cf: 40, ls: 35, es: 35, vb: 35, fp: 40, bt: 45, fx: 45, fo: 45, hs: 70, cg: 30, sim: 10, tc: 50, gl: 75 },
  min_work: 50,
  // Свой минимум за работу у лёгких ремонтов: с общим минимумом они выходят дороже рынка
  min_svc: { sim: 15, cg: 25, ls: 35, es: 35, vb: 35 },
  tax: 0.10,
  round: 5,
  sf_offset: 5,
  sf_floor_share: 0.5,
  diff: [[0, 1.5], [3, 1.3], [5, 1.15], [7, 1.0]],
  diff_default: 1.0,
  novelty: [[0, 1.3], [2, 1.15], [4, 1.0]],
  year: 0, // 0 — текущий год
  glue: true, // учитывать проклейку в заработке и в заказе (на цену клиенту не влияет)
  glue_default: 0, // проклейка, если своей нет в прайсе (клей, скотч), р. на ремонт
  // Задняя крышка iPhone только там, где не нужен лазер
  no_laser: ['iPhone 14', 'iPhone 14 Plus', 'iPhone 15', 'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 16',
    'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 16e', 'iPhone 17', 'iPhone Air', 'iPhone 17 Pro',
    'iPhone 17 Pro Max', 'iPhone 17e', 'iPhone 18 Pro', 'iPhone 18 Pro Max'],
};

// Брак, б/у с повреждениями, ячейки и подобное не берём
const DEFECT = pyRe(String.raw`битк|б/у|\bБУ\b|царап|пятн|выгор|дефект|трещ|точк|полос|засвет|Diagnosable|\b9[0-4]%`, 'i');
// крышка с широким вырезом под камеру — под лазерную замену, не для обычной
const WIDE_CUT = pyRe('широкий вырез|широкое отверстие', 'i');
// Pixel вскрываются через дисплей, кроме стеклянных 3 и 4 и линейки 10: у них батарея сзади
const PIXEL_BACK = /^Google Pixel (3|3 XL|4|4 XL|10|10 Pro|10 Pro XL)$/;

export function settingsWithDefaults(s) {
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  if (!s) return out;
  for (const k of Object.keys(DEFAULTS)) {
    if (s[k] === undefined || s[k] === null) continue;
    out[k] = k === 'base' || k === 'min_svc' ? { ...out[k], ...s[k] } : JSON.parse(JSON.stringify(s[k]));
  }
  return out;
}

export function currentYear(S) {
  return S.year || new Date().getFullYear();
}

// round(x, 2) из Python: половина округляется к чётному, по точному значению числа
export function pyRound2(x) {
  const neg = x < 0;
  const s = Math.abs(x).toFixed(60);
  const dot = s.indexOf('.');
  const rest = s.slice(dot + 3);
  let r;
  if (/^50*$/.test(rest)) {
    let k = Number(s.slice(0, dot) + s.slice(dot + 1, dot + 3));
    if (k % 2 === 1) k += 1;
    r = k / 100;
  } else {
    r = Number(Math.abs(x).toFixed(2));
  }
  return neg ? -r : r;
}

export function ceilTo(x, step) {
  return Math.ceil(pyRound2(x) / step) * step;
}

export function floorTo(x, step) {
  return Math.floor(pyRound2(x) / step) * step;
}

function stepLookup(table, value) {
  let out = table[0][1];
  for (const [thr, coef] of table) if (value >= thr) out = coef;
  return out;
}

export function diffCoef(S, model) {
  return model.ifixit === null || model.ifixit === undefined ? S.diff_default : stepLookup(S.diff, model.ifixit);
}

export function noveltyCoef(S, model) {
  return model.year ? stepLookup(S.novelty, currentYear(S) - model.year) : S.novelty[S.novelty.length - 1][1];
}

export function minWork(S, svc) {
  const m = S.min_svc && S.min_svc[svc];
  return m === undefined || m === null ? S.min_work : m;
}

export function workFee(S, svc, model) {
  return Math.max(minWork(S, svc), ceilTo(S.base[svc] * diffCoef(S, model) * noveltyCoef(S, model), S.round));
}

// Цена клиенту: по формуле и со сверкой с SmartFix
export function clientPrice(S, work, part, sf) {
  const t = S.tax;
  const r = S.round;
  const formula = ceilTo((work + part) / (1 - t), r);
  if (!sf) return { price: formula, formula, smartfix: null };
  const floorMin = ceilTo((S.min_work + part) / (1 - t), r);
  const price = Math.max(floorMin, Math.min(floorTo(sf - S.sf_offset, r), Math.max(formula, ceilTo(S.sf_floor_share * sf, r))));
  return { price, formula, smartfix: sf };
}

export function usable(p) {
  return p.cost !== null && p.cost !== undefined && p.cost > 0 && !DEFECT.test(p.name);
}

// Проклейка в наборе «(5шт)» — цена за одну штуку
const PACK = /\((\d+)\s*шт\.?\)/i;
export function pieceCost(p) {
  const m = PACK.exec(p.name);
  const q = m ? Number(m[1]) : 1;
  return q > 1 ? Math.round((p.cost / q) * 100) / 100 : p.cost;
}

export const GLUE_NAME = { gd: 'дисплея', gc: 'задней крышки', gb: 'батареи' };

export function sfKey(svc, tier) {
  return SF_KEY[svc + ':' + tier] || null;
}

export class Pricer {
  // data: { suppliers: {key: {name, stock, rank}}, models: [{brand, model, year, ifixit, sf}], parts: [{sup, name, cost, stock, svc, tier, models, line}] }
  constructor(data, settings) {
    this.data = data;
    this.S = settingsWithDefaults(settings);
    this.byName = new Map(data.models.map((m) => [m.model, m]));
    this.index = this.buildIndex();
  }

  inStock(p) {
    const sup = this.data.suppliers[p.sup];
    return !(sup && sup.stock) || p.stock === 'В наличии';
  }

  rank(sup) {
    const s = this.data.suppliers[sup];
    return s && s.rank !== undefined ? s.rank : 9;
  }

  buildIndex() {
    const noLaser = new Set(this.S.no_laser);
    this.noLaser = noLaser;
    const index = new Map();
    this.glue = new Map();
    for (const p of this.data.parts) {
      if (p.svc === 'g') {
        if (!GLUE_NAME[p.tier] || !usable(p)) continue;
        for (const model of p.models) {
          if (!this.glue.has(model)) this.glue.set(model, { gd: [], gc: [], gb: [] });
          this.glue.get(model)[p.tier].push(p);
        }
        continue;
      }
      if (p.tier === 'skip' || !ORDER[p.svc] || !ORDER[p.svc].includes(p.tier)) continue;
      if (p.svc === 'c' && WIDE_CUT.test(p.name)) continue;
      for (const model of p.models) {
        if (p.svc === 'c' && model.startsWith('iPhone') && !noLaser.has(model)) continue;
        const key = model + '|' + p.svc + '|' + p.tier;
        let lines = index.get(key);
        if (!lines) index.set(key, (lines = new Map()));
        const lk = p.sup + '|' + (p.line || p.name);
        let rows = lines.get(lk);
        if (!rows) lines.set(lk, (rows = []));
        rows.push(p);
      }
    }
    return index;
  }

  // Какие проклейки нужны ремонту. Через дисплей вскрываются айфоны с лазером и почти все Pixel, остальные — сзади.
  // Корпус — дисплей, батарея и сторона вскрытия; стекло экрана и тачскрин — дисплей; стекло камеры и SIM-лоток — без проклейки.
  glueTypes(model, svc) {
    if (!this.S.glue) return [];
    const front = model.startsWith('iPhone') ? !this.noLaser.has(model) : model.startsWith('Google Pixel') && !PIXEL_BACK.test(model);
    const open = front ? 'gd' : 'gc';
    const need = { d: ['gd'], c: ['gc'], b: ['gb', open], hs: ['gd', 'gb', open], tc: ['gd'], gl: ['gd'], cg: [], sim: [] }[svc];
    return [...new Set(need || (ORDER[svc] ? [open] : []))];
  }

  // Проклейки для ремонта: самая дешёвая из тех, что в наличии; нет в прайсе — не считаем
  glueFor(model, svc) {
    const byType = this.glue.get(model);
    const items = [];
    for (const type of this.glueTypes(model, svc)) {
      const rows = byType ? byType[type] : [];
      if (!rows.length) continue;
      const best = [...rows].sort((a, b) => (Number(this.inStock(b)) - Number(this.inStock(a))) || (pieceCost(a) - pieceCost(b)) || (this.rank(a.sup) - this.rank(b.sup)))[0];
      items.push({ type, cost: pieceCost(best), sup: best.sup, name: best.name, stock: best.stock, inStock: this.inStock(best), pack: best.cost !== pieceCost(best) });
    }
    if (!items.length && this.S.glue && this.S.glue_default > 0 && this.glueTypes(model, svc).length) {
      items.push({ type: null, cost: this.S.glue_default, sup: null, name: 'клей или скотч (своей проклейки нет в прайсе)', stock: null, inStock: true, fallback: true });
    }
    return { items, total: Math.round(items.reduce((s, x) => s + x.cost, 0) * 100) / 100 };
  }

  // Все подходящие детали варианта: для списка «Другие детали»
  partsFor(model, svc, tier) {
    const lines = this.index.get(model + '|' + svc + '|' + tier);
    if (!lines) return [];
    const out = [];
    for (const rows of lines.values()) for (const p of rows) if (usable(p)) out.push(p);
    return out.sort((a, b) => (this.inStock(b) - this.inStock(a)) || (a.cost - b.cost) || (this.rank(a.sup) - this.rank(b.sup)));
  }

  service(m, svc) {
    const S = this.S;
    const work = workFee(S, svc, m);
    const opts = [];
    for (const tier of ORDER[svc]) {
      const lines = this.index.get(m.model + '|' + svc + '|' + tier);
      if (!lines) continue;
      const cand = [];
      for (const rows of lines.values()) {
        const ok = rows.filter(usable);
        if (!ok.length) continue;
        const stock = ok.filter((r) => this.inStock(r));
        const pool = stock.length ? stock : ok;
        let worst = pool[0];
        for (const r of pool) if (r.cost > worst.cost) worst = r; // самый дорогой цвет
        cand.push({ cost: worst.cost, sup: worst.sup, row: worst, colours: pool.length, inStock: stock.length > 0 });
      }
      if (!cand.length) continue;
      // задняя камера: у каждого поставщика берём самый дорогой модуль (основной), даже если его нет в наличии,
      // а между поставщиками выбираем как обычно
      let pool = cand;
      if (MOST_EXPENSIVE.has(svc)) {
        const bySup = new Map();
        for (const c of cand) if (!bySup.has(c.sup) || c.cost > bySup.get(c.sup).cost) bySup.set(c.sup, c);
        pool = [...bySup.values()];
      }
      // сначала в наличии, потом дешевле; при равенстве основной поставщик
      pool.sort((a, b) => (Number(!a.inStock) - Number(!b.inStock)) || (a.cost - b.cost) || (this.rank(a.sup) - this.rank(b.sup)));
      const best = pool[0];
      const alt = pool.find((c) => c.sup !== best.sup) || null;
      const key = sfKey(svc, tier);
      const sfv = key && m.sf ? m.sf[key] : null;
      const cp = clientPrice(S, work, best.cost, sfv);
      opts.push({
        tier, svc, work, cost: best.cost, sup: best.sup, part: best.row.name, stock: best.row.stock,
        colours: best.colours, inStock: best.inStock, sfKey: key, sf: sfv || null,
        price: cp.price, formula: cp.formula, smartfix: cp.smartfix,
        alt: alt ? { cost: alt.cost, sup: alt.sup, part: alt.row.name, stock: alt.row.stock, inStock: alt.inStock } : null,
        hidden: false,
      });
    }
    // прячем слабый вариант, если он не дешевле варианта получше
    for (let i = 0; i < opts.length; i++) {
      if (opts.slice(i + 1).some((b) => b.price <= opts[i].price)) opts[i].hidden = true;
    }
    return { work, opts };
  }

  model(name) {
    const m = this.byName.get(name);
    if (!m) return null;
    const services = {};
    for (const svc of SERVICES) services[svc] = this.service(m, svc);
    return { ...m, services };
  }

  all() {
    return this.data.models.map((m) => this.model(m.model));
  }
}

// Файл цен для сайта: только цены клиенту, тот же формат, что prices-models.js.
// Модели сайта — все, модели только для приложения — если есть хоть одна цена.
export function siteFile(pricer, monthTitle) {
  const lines = [];
  for (const e of pricer.all()) {
    const prices = {};
    for (const svc of SERVICES) {
      const shown = e.services[svc].opts.filter((o) => !o.hidden).map((o) => [o.tier, o.price]);
      if (shown.length) prices[svc] = shown;
    }
    if (APP_ONLY.has(e.model) && !Object.keys(prices).length) continue;
    lines.push(JSON.stringify([e.brand, e.model, prices]));
  }
  const head = '// Цены под ключ (деталь + работа) по моделям телефонов. ' + monthTitle + '.\n'
    + '// Для каждой модели: b — аккумулятор, d — дисплей, p — разъём зарядки, c — задняя крышка; cr — задняя камера,\n'
    + '// cf — фронтальная камера, ls — громкий динамик, es — слуховой динамик, vb — вибромотор, fp — сканер отпечатка, bt — шлейф кнопок,\n'
    + '// fx — межплатный шлейф, fo — другой шлейф, hs — корпус, cg — стекло камеры, sim — SIM-лоток, tc — тачскрин, gl — стекло экрана.\n'
    + '// В каждом ремонте список вариантов детали [код, цена] от дешёвого к дорогому. Нет ремонта — цена уточняется отдельно.\n'
    + '// Коды вариантов и их названия — в index.html (variants). Файл собирается в приложении мастера.\n';
  return head + 'window.MODEL_PRICES = [' + lines.join(',\n') + '];\n';
}
