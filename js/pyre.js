// Регулярные выражения в стиле Python для JavaScript.
// В Python \b и \w понимают кириллицу, в JavaScript нет: «\bБУ\b» там не найдёт «БУ».
// pyRe() заменяет \b и \w на проверки с Unicode-классами, чтобы правила работали так же, как в скриптах прайса.

const W = '[\\p{L}\\p{N}_]';
const BOUNDARY = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

export function pyRe(source, flags = '') {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1];
      if (next === 'b' && !inClass) { out += BOUNDARY; i++; continue; }
      if (next === 'w') { out += inClass ? '\\p{L}\\p{N}_' : W; i++; continue; }
      if (next === '-' && !inClass) { out += '-'; i++; continue; }
      out += ch + next;
      i++;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    out += ch;
  }
  return new RegExp(out, flags.includes('u') ? flags : flags + 'u');
}

// str.split() из Python: по пробелам, без пустых кусков
export function pySplit(s) {
  const t = s.trim();
  return t ? t.split(/\s+/) : [];
}

// str.strip(chars) из Python
export function pyStrip(s, chars) {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

// re.split(pattern, s, maxsplit=1)[0] из Python
export function beforeFirst(s, re) {
  const m = re.exec(s);
  return m ? s.slice(0, m.index) : s;
}
