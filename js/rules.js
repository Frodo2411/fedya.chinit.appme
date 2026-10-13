// Разбор названий деталей поставщика: к какой модели и какому варианту относится позиция.
// Перенос rules.py и правил из merge_mapping.py (prais-tools). Нужен для новых строк в свежем прайсе:
// позиции, которые уже были в прошлом прайсе, берут готовую разметку.

import { pyRe, pySplit, pyStrip, beforeFirst } from './pyre.js';

const KIND_PREFIX = pyRe(String.raw`^(Аккумулятор|Дисплей|Задняя крышка|Плата зарядки|Нижняя плата|Шлейф зарядки|Шлейф|Разъем|Разъём)\s+(для\s+)?`, 'i');

const NM = [
  [pyRe(String.raw`\bgalaxy\b|\bsamsung\b|\bapple\b|\bgoogle\b|\bhuawei\b(?=\s+(honor|nova|mate|p\d|pura|p smart))`, 'g'), ' '],
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
  t = t.replace(/\biphone 17 air\b/, 'iphone air'); // у поставщиков «iPhone 17 Air», на сайте «iPhone Air»
  for (const [re, rep] of NM) t = t.replace(re, rep);
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/^xiaomi xiaomi/, 'xiaomi');
  return t;
}

// aliases: другое название модели у поставщика → модель (Map), только для моделей из списка
export function siteIndex(modelNames, aliases) {
  const idx = new Map();
  const add = (k, m) => {
    if (!idx.has(k)) idx.set(k, []);
    if (!idx.get(k).includes(m)) idx.get(k).push(m);
  };
  for (const m of modelNames) add(normModel(m), m);
  if (aliases) {
    const have = new Set(modelNames);
    for (const [a, m] of aliases) if (have.has(m)) add(normModel(a), m);
  }
  return idx;
}

// « - » отделяет модель от описания; бывает и без пробела перед тире: «iPhone 15 Pro Max- DEJI»
const SEG_SPLIT = pyRe(String.raw`\s+-\s+|\s+–\s+|(?<=\S)-\s+`);
const SEG_YEAR = pyRe(String.raw`\(\s*(20\d\d)\s*\)`, 'g');
const SEG_PAREN = pyRe(String.raw`\([^)]*\)`, 'g');
const SEG_TAIL = pyRe(String.raw`\b(на системный разъем|системный разъем|на зарядку|премиум|в раме|с рамкой)\b.*$`, 'i');
// Вариант детали прямо в названии модели: «Samsung A34 5G In-Cell»
const SEG_QUALITY = pyRe(String.raw`\s+(?:In-?Cell|Incell|OLED|AMOLED|TFT|LCD)\b.*$`, 'i');
// eSIM в названии корпуса: «iPhone 17 Pro e sim + sim»
const SEG_ESIM = /\s+(?:e\s?sim|\d\s?sim)(?:\s*\+\s*sim)?(?=\s|$)/gi;

export function modelSegment(name) {
  let s = name.trim().replace(KIND_PREFIX, '');
  s = beforeFirst(s, SEG_SPLIT);
  s = s.replace(SEG_YEAR, ' $1');
  s = s.replace(SEG_PAREN, ' ');
  s = s.replace(SEG_TAIL, '');
  s = s.replace(SEG_QUALITY, '').replace(SEG_ESIM, '');
  // русские слова перед моделью: «Плата зарядки шлейф Huawei P20»
  s = s.trim().replace(/^(?:[а-яё]+\s+)+(?=[A-Za-z])/i, '');
  return pyStrip(s.replace(/\s+/g, ' '), ' ,');
}

const BRAND_WORDS = ['Xiaomi', 'Redmi', 'Poco', 'Mi', 'Huawei', 'Honor', 'Samsung', 'Galaxy', 'Realme', 'iPhone', 'Google', 'Pixel'];
const FAMILY_LEADS = ['Xiaomi', 'Redmi', 'Poco', 'Huawei', 'Honor', 'Samsung', 'Realme', 'iPhone', 'Google', 'Pixel'];
// Бренды, которых нет на сайте (их модели только в приложении): слово в названии → семья. Регистр любой: TECNO, Oppo.
const MORE_FAM = {
  tecno: 'tecno', itel: 'itel', infinix: 'infinix', vivo: 'vivo', iqoo: 'vivo', oppo: 'oppo', oneplus: 'oneplus', nothing: 'nothing', cmf: 'nothing',
  oukitel: 'oukitel', blackview: 'blackview', doogee: 'doogee', ulefone: 'ulefone', tcl: 'tcl', zte: 'zte', nubia: 'zte', lenovo: 'lenovo',
  motorola: 'motorola', nokia: 'nokia', sony: 'sony', wiko: 'wiko',
};
const isBrand = (w) => BRAND_WORDS.includes(w) || w.toLowerCase() in MORE_FAM;
const isFamilyLead = (w) => FAMILY_LEADS.includes(w) || w.toLowerCase() in MORE_FAM;

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
  // русские слова после модели — цвет и пояснения: «iPhone 6 белый», «Mi 8 Lite с разъемом зарядки»
  const parts = seg.split(/\s*\/\s*/).map((p) => p.replace(/\s+[а-яё].*$/i, '').trim()).filter(Boolean);
  const out = [];
  const prefixes = [];
  for (const p of parts) {
    if (/^(4G|5G)$/i.test(p) && out.length) {
      out.push(out[out.length - 1].map((a) => a.replace(/\s*(4G|5G)$/i, '') + ' ' + p));
      continue;
    }
    const lead = leadWords(pySplit(p));
    let alts;
    if (lead.length && isBrand(lead[0])) {
      alts = [p];
    } else {
      const order = [];
      // голый номер («Tecno Pova 2/Infinix Note 7/8») — только от бренда ближайшей части
      const famOf = (pre) => { const w = pySplit(pre)[0].toLowerCase(); return FAM[w] || w; };
      const near = prefixes.length ? famOf(prefixes[prefixes.length - 1]) : null;
      for (const pre of [...prefixes].reverse().filter((x) => lead.length || famOf(x) === near)) {
        for (const cand of [pre, pySplit(pre)[0]]) if (!order.includes(cand)) order.push(cand);
      }
      alts = order.length ? order.map((pre) => pre + ' ' + p) : [p];
      if (p.startsWith('Note') && !prefixes.includes('Redmi')) alts.push('Redmi ' + p);
    }
    out.push(alts);
    // своя серия у части («Hot 30» после «Infinix Note 10»): префикс — бренд + серия, а не «Infinix Note Hot»
    const brandOf = (pre) => { const w = pySplit(pre); const b = []; for (const x of w) { if (!isBrand(x)) break; b.push(x); } return b; };
    const fullLead = lead.length && !isBrand(lead[0]) && prefixes.length && brandOf(prefixes[prefixes.length - 1]).length
      ? [...brandOf(prefixes[prefixes.length - 1]), ...lead] : leadWords(pySplit(alts[0]));
    if (fullLead.length) {
      const pre = fullLead.join(' ');
      const at = prefixes.indexOf(pre);
      if (at !== -1) prefixes.splice(at, 1);
      prefixes.push(pre);
      if (isFamilyLead(fullLead[0]) && !prefixes.includes(fullLead[0])) prefixes.unshift(fullLead[0]);
    }
  }
  return out;
}

// --- Сети 4G/5G: из merge_mapping.py
const SAMSUNG_5G_ONLY = new Set(['a52s', 'a33', 'a53', 'a73', 'a34', 'a54', 'a35', 'a55', 'a25', 'a36', 'a56', 'a26', 'a37', 'a57', 'a42']);
const POCO_5G_ONLY = new Set(['f3', 'f4', 'f5', 'f6', 'f7', 'x5 pro', 'x6', 'x6 pro', 'x7', 'x7 pro', 'x8 pro']);
const HONOR_5G_ONLY = new Set(['x9a', 'x9b', 'x9c', 'x9d', '50']);
const REALME_5G_ONLY = new Set(['12+']);
const PREFIX = ['Samsung Galaxy ', 'Redmi ', 'Poco ', 'Xiaomi ', 'Honor ', 'Huawei ', 'Realme ', 'iPhone ', 'Google Pixel '];

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
  // внешний (маленький) экран раскладушки — не основной дисплей
  dSkip: R(String.raw`стекл|тачскрин|подсветк|защитн|\bOCA\b|рамка дисплея|внешн|маленьк`),
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
  oUsed: R('снят|разбор'),
  oOrig: R(String.raw`\bOR\b|original|\borig\b|оригинал|сервис`),
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
  if (MORE_KINDS.has(kind)) {
    if (T.oUsed.test(n)) return 'orig_used';
    // стекло под переклейку и тачскрин оригинальными не бывают: «OR» у них — про качество плёнки
    if (kind !== 'gl' && kind !== 'tc' && T.oOrig.test(n)) return 'orig_new';
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
const FAM = { iphone: 'apple', samsung: 'samsung', galaxy: 'samsung', xiaomi: 'xiaomi', redmi: 'xiaomi', poco: 'xiaomi', mi: 'xiaomi', huawei: 'huawei', honor: 'huawei', realme: 'realme', google: 'google', pixel: 'google', ...MORE_FAM };
const BRAND_RE = new RegExp(String.raw`iPhone|Samsung|Galaxy|Xiaomi|Redmi|Poco|Huawei|Honor|Realme|Google|Pixel|\bMi\b|\b(?:` + Object.keys(MORE_FAM).join('|') + String.raw`)\b`, 'gi');
export const BRAND_FAM = {
  iPhone: 'apple', Samsung: 'samsung', Xiaomi: 'xiaomi', Redmi: 'xiaomi', Poco: 'xiaomi', Huawei: 'huawei', Honor: 'huawei', Realme: 'realme', Google: 'google',
  Tecno: 'tecno', Itel: 'itel', Infinix: 'infinix', Vivo: 'vivo', OPPO: 'oppo', OnePlus: 'oneplus', Nothing: 'nothing', Oukitel: 'oukitel', Blackview: 'blackview',
  Doogee: 'doogee', Ulefone: 'ulefone', TCL: 'tcl', ZTE: 'zte', Lenovo: 'lenovo', Motorola: 'motorola', Nokia: 'nokia', Sony: 'sony', Wiko: 'wiko',
};

const BRAND_ONE = new RegExp(BRAND_RE.source, 'i');

export function families(name) {
  const out = new Set();
  for (const m of name.matchAll(BRAND_RE)) out.add(FAM[m[0].toLowerCase()]);
  return out;
}

// Проклейки (клеевые рамки): дисплея, задней крышки, батареи. Svc 'g', вариант — gd/gc/gb.
const GLUE_PREFIX = /^Проклейка\s+(дисплея|экрана|большого экрана|задней крышки|батареи|аккумулятора|акб)\s+/i;

export function glueType(name) {
  const m = GLUE_PREFIX.exec(name.trim());
  if (!m) return null;
  const w = m[1].toLowerCase();
  if (w === 'задней крышки') return 'gc';
  if (w === 'батареи' || w === 'аккумулятора' || w === 'акб') return 'gb';
  return 'gd';
}

export function kindOf(name) {
  const n = name.trim();
  if (glueType(n)) return 'g';
  if (/^Аккумулятор/i.test(n)) return 'b';
  if (/^Дисплей/i.test(n)) return 'd';
  if (/^Задняя крышка/i.test(n)) return 'c';
  if (/^Плата для/i.test(n)) return null;
  if (/^(Плата зарядки|Шлейф зарядки|Шлейф\s*\/\s*плата зарядки|Нижняя плата)/i.test(n)) return 'p';
  // шлейф на разъём SIM — не зарядка, а SIM-ридер (другой шлейф)
  if (/^Шлейф/i.test(n) && /системн|разъ[её]м/i.test(n)) return /\b(SIM|MMC)\b/i.test(n) && !/системн|заряд/i.test(n) ? 'fo' : 'p';
  return moreKind(n);
}

// Остальные детали: ремонты только для приложения (на сайте их нет).
// Расходники и инструмент (наборы, формы, шлейфы JCID для восстановления, защитные стёкла, рамки дисплея) — не ремонт.
export const MORE_KINDS = new Set(['cr', 'cf', 'ls', 'es', 'fp', 'bt', 'fx', 'fo', 'hs', 'cg', 'sim', 'tc', 'gl']);
const NOT_REPAIR = /JCID|для ремонта аккумулятора|tag-?on|без пайки|для теста|микроскоп/i;

// Слова названия вне модели: до бренда и после « - » («Шлейф iPhone 11 - кнопки громкости», «Шлейф на вспышку iPhone 11»)
function partWords(n) {
  const at = n.search(BRAND_ONE);
  if (at < 0) return n;
  const dash = n.indexOf(' - ', at);
  return n.slice(0, at) + ' ' + (dash < 0 ? '' : n.slice(dash));
}

function moreKind(n) {
  if (NOT_REPAIR.test(n)) return null;
  if (/^[СC]текло камер/i.test(n)) return 'cg';
  if (/^[СC]текло\s/i.test(n) && /переклей/i.test(n)) return /маленьк|внешн/i.test(n) ? null : 'gl';
  if (/^Тачскрин/i.test(n)) return 'tc';
  if (/^(Сим|SIM)[\s-]*лоток/i.test(n)) return 'sim';
  if (/^(Корпус|Средняя часть)/i.test(n)) return 'hs';
  if (/^(Динамик слуховой|Слуховой динамик)/i.test(n)) return 'es';
  if (/^(Динамик|Полифонический динамик)/i.test(n)) return 'ls';
  if (/^(Передняя камера|Фронтальная камера|Передняя сборка)/i.test(n)) return 'cf';
  if (/^Задняя камера/i.test(n)) return 'cr';
  if (/^Камера\s/i.test(n)) return /передн|фронтал/i.test(partWords(n)) ? 'cf' : 'cr';
  if (/^Шлейф/i.test(n)) {
    const w = partWords(n);
    if (/сканер|отпечат/i.test(w)) return 'fp';
    if (/кноп|включени|громкост|блокировк/i.test(w)) return 'bt';
    if (/межплат|на дисплей|экрана/i.test(w)) return 'fx';
    if (/сенсор|микрофон|вспышк|беспровод|nfc|антенн|датчик|\bsim\b|mmc/i.test(w)) return 'fo';
  }
  return null;
}

// У остальных деталей модель — с бренда до первого русского слова: «Шлейф на вспышку iPhone 11 - Orig»,
// «Стекло переклей Honor 50 Lite/Nova 8i с OCA пленкой - OR», «Корпус iPhone 15 e sim Черный + сим-лоток - ПРЕМИУМ»
function moreModels(name) {
  const at = name.search(BRAND_ONE);
  if (at < 0) return name;
  const tail = name.slice(at);
  const dash = tail.indexOf(' - ');
  const head = (dash < 0 ? tail : tail.slice(0, dash))
    .replace(/\(\s*(20\d\d)\s*\)/g, ' $1')
    .replace(/\([^)]*\)/g, ' ')
    .replace(SEG_ESIM, '')
    .replace(/\s*\+\s*(?:OCA|рамк[а-яё]*)(?=\s|$)/gi, ' ')
    .replace(/\s+[а-яё].*$/i, '');
  return 'Дисплей ' + head + (dash < 0 ? '' : tail.slice(dash));
}

// Разметка новой строки: модели, вариант, линия. Как map_row() из rules.py плюс поправки из merge_mapping.py.
export function mapRow(name, kind, idx, famOfModel) {
  const fams = families(name);
  // у проклейки та же запись модели, что у дисплея: «Проклейка дисплея iPhone 15 - Orig» → «Дисплей iPhone 15 - Orig»
  const forModels = kind === 'g' ? name.trim().replace(GLUE_PREFIX, 'Дисплей ') : MORE_KINDS.has(kind) ? moreModels(name) : name;
  let models = [];
  for (const m of matchModels(forModels, idx)) if (fams.has(famOfModel.get(m)) && !models.includes(m)) models.push(m);
  let t = kind === 'g' ? glueType(name) : tier(kind, name);
  if (t === 'skip') models = [];
  if (!models.length) t = 'skip';
  if (kind === 'b' && /\bOR100\b/.test(name) && (t === 'orig_new' || t === 'orig_used')) t = 'copy';
  if (kind === 'd' && /\bOR100\b/.test(name) && t.startsWith('orig')) t = /oled/i.test(name) ? 'copy_oled' : 'copy_lcd';
  if (kind === 'b' && t === 'orig_new' && !/подлинн|привязк|original|оригинал|сервис|service/i.test(name)) t = 'copy';
  if (/урезан/i.test(name)) t = 'skip';
  models = models.filter((m) => networkOk(name, m));
  return { models, tier: models.length ? t : 'skip', line: lineKey(name) };
}
