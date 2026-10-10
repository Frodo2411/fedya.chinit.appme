// Поиск модели по-русски и с ошибками: «айфон 14 про», «редми ноут 13», «самсунг а52», «iphon 13».

const WORDS = [
  [/(айфон|айфн|ифон|ипхон|айфоун)[а-я]*/g, 'iphone'],
  [/(самсунг|самсунк|самсун|самсн)[а-я]*/g, 'samsung'],
  [/(галакси|гэлакси|гелакси|галакс)[а-я]*/g, 'galaxy'],
  [/(редми|рэдми|редмі)[а-я]*/g, 'redmi'],
  [/(сяоми|ксиаоми|ксяоми|ксиоми|шаоми|ксаоми|сиоми|хиаоми|ксиами|сиаоми)[а-я]*/g, 'xiaomi'],
  [/(хуавей|хуавэй|хуавеи|хуавэи|хуавай)[а-я]*/g, 'huawei'],
  [/(хонор|хонар)[а-я]*/g, 'honor'],
  [/(реалми|реалме|риалми|рилми|реалми)[а-я]*/g, 'realme'],
  [/(покофон|поко)[а-я]*/g, 'poco'],
  [/ноут[а-я]*/g, 'note'],
  [/(^|[^а-я])нот(?![а-я])/g, '$1note'],
  [/макс/g, 'max'], [/мини/g, 'mini'], [/плюс/g, 'plus'], [/ультра/g, 'ultra'], [/лайт/g, 'lite'],
  [/(эйр|эир)/g, 'air'], [/про/g, 'pro'], [/нео/g, 'neo'], [/(эдж|едж)/g, 'edge'], [/фолд/g, 'fold'], [/флип/g, 'flip'],
  [/пура/g, 'pura'], [/(мейт|мэйт|мате)/g, 'mate'], [/нова/g, 'nova'], [/смарт/g, 'smart'], [/мастер/g, 'master'],
  [/(^|[^а-я])фе(?![а-я])/g, '$1fe'], [/(^|[^а-я])се(?![а-я])/g, '$1se'], [/нфс/g, 'nfc'],
];
const LETTERS = { 'а': 'a', 'б': 'b', 'в': 'b', 'д': 'd', 'е': 'e', 'и': 'i', 'к': 'k', 'м': 'm', 'о': 'o', 'п': 'p', 'т': 't', 'у': 'y', 'ф': 'f', 'х': 'x', 'з': '3' };
// «с» и «р» неоднозначны: «с23» — это S23, а «12с» — 12C; «хр» — XR, а «р30» — P30. Пробуем оба варианта.
const AMBIGUOUS = { 'с': 'C', 'р': 'R' };
const EXPAND = { C: ['c', 's'], R: ['p', 'r'] };
const ALIASES = { Redmi: 'xiaomi', Poco: 'xiaomi', Honor: 'huawei' };

export function norm(s, query = false) {
  let t = ' ' + String(s).toLowerCase().replace(/ё/g, 'е') + ' ';
  t = t.replace(/\+/g, ' plus ');
  for (const [re, w] of WORDS) t = t.replace(re, (...m) => (typeof m[1] === 'string' && w.startsWith('$1') ? m[1] : ' ') + w.replace('$1', '') + ' ');
  t = t.replace(/[а-я]/g, (ch) => LETTERS[ch] || (query && AMBIGUOUS[ch]) || ({ 'с': 'c', 'р': 'p' })[ch] || ' ');
  t = t.replace(/[^a-zCR0-9]+/g, ' ');
  // «14pro» → «14 pro», «note13» → «note 13»; «a52s», «13c», «16e» не трогаем
  t = t.replace(/(\d)([a-zCR]{3,})/g, '$1 $2').replace(/([a-zCR]{3,})(\d)/g, '$1 $2');
  return t.trim();
}

// Варианты слова запроса: с→c/s, р→p/r; латинская «c23» тоже может быть S23
function variants(token) {
  let out = [''];
  for (const ch of token) {
    const opts = EXPAND[ch] || [ch];
    out = out.flatMap((v) => opts.map((o) => v + o)).slice(0, 16);
  }
  if (/^c\d/.test(token)) out.push('s' + token.slice(1));
  return [...new Set(out)];
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function tokenScore(t, words) {
  let best = 0;
  const digits = /\d/.test(t);
  for (const w of words) {
    let s = 0;
    if (w === t) s = 3;
    else if (w.startsWith(t)) s = 2;
    else if (digits ? (t.length >= 2 && w.includes(t)) : (t.length >= 3 && w.includes(t))) s = 0.5;
    else if (!digits && t.length >= 4) {
      const max = t.length >= 7 ? 2 : 1;
      if (lev(t, w, max) <= max || (w.length > t.length && lev(t, w.slice(0, t.length), max) <= max)) s = 1;
    }
    if (s > best) best = s;
    if (best === 3) break;
  }
  return best;
}

export class ModelSearch {
  constructor(models) {
    this.items = models.map((m, i) => {
      const words = norm(m.brand + ' ' + m.model + ' ' + (ALIASES[m.brand] || '')).split(' ');
      return { m, i, words: [...new Set(words)], size: norm(m.model).split(' ').length };
    });
  }

  find(query, limit = 40) {
    const tokens = norm(query, true).split(' ').filter(Boolean).map(variants);
    if (!tokens.length) return [];
    const out = [];
    for (const it of this.items) {
      let score = 0;
      let ok = true;
      for (const t of tokens) {
        const s = Math.max(...t.map((a) => tokenScore(a, it.words)));
        if (!s) { ok = false; break; }
        score += s;
      }
      if (ok) out.push({ it, score });
    }
    out.sort((a, b) => (b.score - a.score) || (a.it.size - b.it.size) || (a.it.i - b.it.i));
    return out.slice(0, limit).map((x) => x.it.m);
  }
}
