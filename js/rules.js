// Разбор названий деталей поставщика: к какой модели и какому варианту относится позиция.
// Перенос rules.py и правил из merge_mapping.py (prais-tools). Нужен для новых строк в свежем прайсе:
// позиции, которые уже были в прошлом прайсе, берут готовую разметку.

import { pyRe, pySplit, pyStrip, beforeFirst } from './pyre.js';

const KIND_PREFIX = pyRe(String.raw`^(Аккумулятор|Дисплей|Задняя крышка|Плата зарядки|Нижняя плата|Шлейф зарядки|Шлейф|Разъем|Разъём)\s+(для\s+)?`, 'i');

const NM = [
  [pyRe(String.raw`\bgalaxy\b|\bsamsung\b|\bapple\b|\bhuawei\b(?=\s+(honor|nova|mate|p\d|pura|p smart))`, 'g'), ' '],
  [pyRe(String.raw`\bxiaomi\b(?=\s+(redmi|poco|mi)\b)`, 'g'), ' '],
  [pyRe(String.raw`\bxiaomi\s+mi\b|\bmi\b`, 'g'), ' xiaomi '],
  [pyRe(String.raw`\bpro\s*plus\b`, 'g'), 'pro+'],
  [pyRe(String.raw`\s*\bplus\b`, 'g'), '+'],
  [pyRe(String.raw`\s+\+`, 'g'), '+'],
  [pyRe(String.raw`\b4g\b`, 'g'), ' '],
  [pyRe(String.raw`\(\s*(20\d\d)\s*\)`, 'g'), ' $1 '],
  [pyRe(String.raw`(?<=[a-z])(?=\d)`, 'g'), ' '],
];

export function normModel(s) {
  let t = s.toLowerCase().replace(/ё/g, 'е');
  for (const [re, rep] of NM) t = t.replace(re, rep);
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^xiaomi xiaomi/, 'xiaomi');
  return t;
}

export function siteIndex(modelNames) {
  const idx = new Map();
  for (const m of modelNames) {
    const k = normModel(m);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(m);
  }
  return idx;
}

const SEG_SPLIT = pyRe(String.raw`\s+-\s+|\s+–\s+`);
const SEG_YEAR = pyRe(String.raw`\(\s*(20\d\d)\s*\)`, 'g');
const SEG_PAREN = pyRe(String.raw`\([^)]*\)`, 'g');
const SEG_TAIL = pyRe(String.raw`\b(на системный разъем|системный разъем|на зарядку|премиум|в раме|с рамкой)\b.*$`, 'i');

export function modelSegment(name) {
  let s = name.trim().replace(KIND_PREFIX, '');
  s = beforeFirst(s, SEG_SPLIT);
  s = s.replace(SEG_YEAR, ' $1');
  s = s.replace(SEG_PAREN, ' ');
  s = s.replace(SEG_TAIL, '');
  return pyStrip(s.replace(/\s+/g, ' '), ' ,');
}

const BRAND_WORDS = ['Xiaomi', 'Redmi', 'Poco', 'Mi', 'Huawei', 'Honor', 'Samsung', 'Galaxy', 'Realme', 'iPhone'];
const FAMILY_LEADS = ['Xiaomi', 'Redmi', 'Poco', 'Huawei', 'Honor', 'Samsung', 'Realme', 'iPhone'];

function leadWords(words) {
  const lead = [];
  for (const w of words) {
    if (/\d/.test(w)) break;
    lead.push(w);
  }
  return lead;
}

// 'Xiaomi 13T/Redmi Note 13 Pro 4G/14S' -> [['Xiaomi 13T'], ['Redmi Note 13 Pro 4G'], ['Redmi Note 14S', 'Xiaomi 14S', ...]]
export function items(name) {
  const seg = modelSegment(name);
  const parts = seg.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  const prefixes = [];
  for (const p of parts) {
    if (/^(4G|5G)$/i.test(p) && out.length) {
      out.push(out[out.length - 1].map((a) => a.replace(/\s*(4G|5G)$/i, '') + ' ' + p));
      continue;
    }
    const lead = leadWords(pySplit(p));
    let alts;
    if (lead.length && BRAND_WORDS.includes(lead[0])) {
      alts = [p];
    } else {
      const order = [];
      for (const pre of [...prefixes].reverse()) {
        for (const cand of [pre, pySplit(pre)[0]]) if (!order.includes(cand)) order.push(cand);
      }
      alts = order.length ? order.map((pre) => pre + ' ' + p) : [p];
      if (p.startsWith('Note') && !prefixes.includes('Redmi')) alts.push('Redmi ' + p);
    }
    out.push(alts);
    const fullLead = leadWords(pySplit(alts[0]));
    if (fullLead.length) {
      const pre = fullLead.join(' ');
      const at = prefixes.indexOf(pre);
      if (at !== -1) prefixes.splice(at, 1);
      prefixes.push(pre);
      if (FAMILY_LEADS.includes(fullLead[0]) && !prefixes.includes(fullLead[0])) prefixes.unshift(fullLead[0]);
    }
  }
  return out;
}

// --- Сети 4G/5G: из merge_mapping.py
const SAMSUNG_5G_ONLY = new Set(['a52s', 'a33', 'a53', 'a73', 'a34', 'a54', 'a35', 'a55', 'a25', 'a36', 'a56', 'a26', 'a37', 'a57', 'a42']);
const POCO_5G_ONLY = new Set(['f3', 'f4', 'f5', 'f6', 'f7', 'x5 pro', 'x6', 'x6 pro', 'x7', 'x7 pro', 'x8 pro']);
const HONOR_5G_ONLY = new Set(['x9a', 'x9b', 'x9c', 'x9d', '50']);
const REALME_5G_ONLY = new Set(['12+']);
const PREFIX = ['Samsung Galaxy ', 'Redmi ', 'Poco ', 'Xiaomi ', 'Honor ', 'Huawei ', 'Realme ', 'iPhone '];

function core(model) {
  for (const p of PREFIX) if (model.startsWith(p)) return model.slice(p.length);
  return model;
}

export function only5gAllowed(model) {
  const c = core(model).toLowerCase();
  if (model.startsWith('Samsung')) return SAMSUNG_5G_ONLY.has(c);
  if (model.startsWith('Poco')) return POCO_5G_ONLY.has(c);
  if (model.startsWith('Honor')) return HONOR_5G_ONLY.has(c);
  if (model.startsWith('Xiaomi')) return true;
  if (model.startsWith('Redmi') || model.startsWith('Realme')) {
    return c.includes('pro+') || (model.startsWith('Realme') && (c.includes('pro') || REALME_5G_ONLY.has(c)));
  }
  return true;
}

function suffixes(name, model) {
  const c = core(model).replace(/\s*5G$/, '');
  let pat = '';
  for (const ch of c) {
    if (ch === ' ') pat += '\\s*';
    else if (ch === '+') pat += '(?:\\+|\\s*Plus)';
    else if ('.*?^$()[]{}|\\/'.includes(ch)) pat += '\\' + ch;
    else pat += ch;
  }
  const re = new RegExp('(?<![A-Za-z0-9])' + pat + '(?![A-Za-z0-9+])(\\s*(?:4G|5G)(?:\\s*/\\s*(?:4G|5G))?)?', 'gi');
  const out = [];
  for (const m of name.matchAll(re)) out.push((m[1] || '').toUpperCase().replace(/ /g, ''));
  return out;
}

export function networkOk(name, model) {
  if (model.startsWith('iPhone')) return true;
  const sf = suffixes(name, model);
  if (!sf.length) return true;
  if (model.endsWith('5G')) return !sf.every((x) => x === '4G');
  if (sf.every((x) => x === '5G')) return only5gAllowed(model);
  return true;
}

export function matchModels(name, idx) {
  const found = [];
  for (const alts of items(name)) {
    for (const it of alts) {
      const k = normModel(it);
      let cands = [...(idx.get(k) || [])];
      if (!cands.length && k.endsWith(' 5g')) cands = (idx.get(k.slice(0, -3)) || []).filter(only5gAllowed);
      if (cands.length) {
        for (const m of cands) if (!found.includes(m)) found.push(m);
        break;
      }
    }
  }
  return found;
}

// --- Вариант детали по названию
const R = (s) => pyRe(s, 'i');
const T = {
  bSkip: R('ячейк|банк|шлейф|плата|контроллер|tag-on'),
  bVer: R('верификац|без ошибки|genuine|подлинн|новая запчасть'),
  bVerNot: R(String.raw`original|\bOR\b(?!100)|разбор|снят`),
  bUsed: R('разбор|снят'),
  bOrig: R(String.raw`\bOR\b(?!100)|original|оригинал|\borig\b`),
  bBoost: R('усилен'),
  dSkip: R(String.raw`стекл|тачскрин|подсветк|защитн|\bOCA\b|рамка дисплея`),
  dSkipNot: R('заменено.*стекл'),
  dReglass: R(String.raw`переклей|\bRef\b|refurb|заменено`),
  dUsed: R('снят|разбор|б/у'),
  dCopy: R('orig tech|под оригинал|high quality|копия'),
  oled: R(String.raw`oled|amoled|fog`),
  dOrig: R(String.raw`\bOR\b|\(SP\)|service pack|сервис|\boriginal\b|\borig\b|оригинал`),
  dOrigNot: R(String.raw`\b(gx|jk|mems|dd|jcid|wode|rj|fog|zy|hex|tft|lcd|aaa)\b|in-?cell|soft oled|hard oled`),
  dOled: R(String.raw`oled|amoled|\bfog\b|super amoled`),
  cSkip: R('стекло камер|накладк|корпус|рамк|средн|наклейк|скотч'),
  cUsed: R('снят|разбор|original|nfc'),
  cOrig: R(String.raw`\bOR\b|сервис`),
  pSkip: R('беспровод|вспышк|громкост|включени|кнопк|сканер|отпечат|антенн|динамик|вибро|межплат|на дисплей|lcd'),
  pUsed: R('снят|разбор'),
  pOrig: R(String.raw`\bOR\b|original|сервис|\borig\b`),
};

export function tier(kind, n) {
  if (kind === 'b') {
    if (T.bSkip.test(n)) return 'skip';
    if (T.bVer.test(n) && !T.bVerNot.test(n)) return 'verified';
    if (T.bUsed.test(n)) return 'orig_used';
    if (T.bOrig.test(n)) return 'orig_new';
    if (T.bBoost.test(n)) return 'copy_boost';
    return 'copy';
  }
  if (kind === 'd') {
    if (T.dSkip.test(n) && !T.dSkipNot.test(n)) return 'skip';
    if (T.dReglass.test(n)) return 'orig_reglass';
    if (T.dUsed.test(n)) return 'orig_used';
    if (T.dCopy.test(n)) return T.oled.test(n) ? 'copy_oled' : 'copy_lcd';
    if (T.dOrig.test(n) && !T.dOrigNot.test(n)) return 'orig_new';
    if (T.dOled.test(n)) return 'copy_oled';
    return 'copy_lcd';
  }
  if (kind === 'c') {
    if (T.cSkip.test(n)) return 'skip';
    if (T.cUsed.test(n)) return 'orig_used';
    if (T.cOrig.test(n)) return 'orig_new';
    return 'copy';
  }
  if (kind === 'p') {
    if (T.pSkip.test(n)) return 'skip';
    if (T.pUsed.test(n)) return 'orig_used';
    if (T.pOrig.test(n)) return 'orig_new';
    return 'copy';
  }
  return 'skip';
}

const COLOURS = String.raw`(черн\w*|бел\w*|син\w*|голуб\w*|зелен\w*|красн\w*|розов\w*|фиолет\w*|сиренев\w*|серебр\w*|сер\w*|золот\w*|желт\w*|оранж\w*|коричн\w*|бирюз\w*|бежев\w*|мятн\w*|графит\w*|титан\w*|Black|White|Blue|Green|Red|Pink|Purple|Silver|Gold|Yellow|Midnight|Starlight|Graphite|Gray|Grey)`;
const LINE_FRAME = pyRe(String.raw`\((?:` + COLOURS + String.raw`)\s*рама\)`, 'gi');
const LINE_COLOUR = pyRe(String.raw`\b` + COLOURS + String.raw`\b,?`, 'gi');

// Название без цвета: цвета одной позиции считаем одной деталью
export function lineKey(name) {
  let t = name.replace(LINE_FRAME, '');
  t = t.replace(LINE_COLOUR, '');
  return pyStrip(t.replace(/\s+/g, ' ').replace(/ ,/g, ','), ' -,');
}

// --- Для новых строк прайса: что за деталь и для какого бренда
const FAM = { iphone: 'apple', samsung: 'samsung', galaxy: 'samsung', xiaomi: 'xiaomi', redmi: 'xiaomi', poco: 'xiaomi', mi: 'xiaomi', huawei: 'huawei', honor: 'huawei', realme: 'realme' };
const BRAND_RE = /iPhone|Samsung|Galaxy|Xiaomi|Redmi|Poco|Huawei|Honor|Realme|\bMi\b/gi;
export const BRAND_FAM = { iPhone: 'apple', Samsung: 'samsung', Xiaomi: 'xiaomi', Redmi: 'xiaomi', Poco: 'xiaomi', Huawei: 'huawei', Honor: 'huawei', Realme: 'realme' };

export function families(name) {
  const out = new Set();
  for (const m of name.matchAll(BRAND_RE)) out.add(FAM[m[0].toLowerCase()]);
  return out;
}

export function kindOf(name) {
  const n = name.trim();
  if (/^Аккумулятор/i.test(n)) return 'b';
  if (/^Дисплей/i.test(n)) return 'd';
  if (/^Задняя крышка/i.test(n)) return 'c';
  if (/^Плата для/i.test(n)) return null;
  if (/^(Плата зарядки|Шлейф зарядки|Шлейф\s*\/\s*плата зарядки|Нижняя плата)/i.test(n)) return 'p';
  if (/^Шлейф/i.test(n) && /системн|разъ[её]м/i.test(n)) return 'p';
  return null;
}

// Разметка новой строки: модели, вариант, линия. Как map_row() из rules.py плюс поправки из merge_mapping.py.
export function mapRow(name, kind, idx, famOfModel) {
  const fams = families(name);
  let models = [];
  for (const m of matchModels(name, idx)) if (fams.has(famOfModel.get(m)) && !models.includes(m)) models.push(m);
  let t = tier(kind, name);
  if (t === 'skip') models = [];
  if (!models.length) t = 'skip';
  if (kind === 'b' && /\bOR100\b/.test(name) && (t === 'orig_new' || t === 'orig_used')) t = 'copy';
  if (kind === 'd' && /\bOR100\b/.test(name) && t.startsWith('orig')) t = /oled/i.test(name) ? 'copy_oled' : 'copy_lcd';
  if (kind === 'b' && t === 'orig_new' && !/подлинн|привязк|original|оригинал|сервис|service/i.test(name)) t = 'copy';
  if (/урезан/i.test(name)) t = 'skip';
  models = models.filter((m) => networkOk(name, m));
  return { models, tier: models.length ? t : 'skip', line: lineKey(name) };
}
