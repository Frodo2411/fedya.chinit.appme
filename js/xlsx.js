// Чтение .xlsx (и .csv, и старого .xls через xls.js) без сторонних библиотек: zip-архив + XML листов.
// Возвращает [{name, rows: [[значение ячейки, ...], ...]}]; значение — строка, число или null.

import { readXls } from './xls.js';

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

// Испорченный или недокачанный архив: сжатые данные контрольной суммы не имеют, поэтому сверяем CRC-32 и размер
// из оглавления архива — иначе одна ошибка в байте даёт пол-листа без всякого сообщения
const BROKEN = 'Файл .xlsx повреждён или скачан не полностью. Скачай прайс заново или открой в Excel или Numbers и сохрани ещё раз.';
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buffer, wanted) {
  const b = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Файл повреждён или это не .xlsx');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const crc = u32(b, p + 16);
    const size = u32(b, p + 20);
    const usize = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (wanted && !wanted(name)) continue;
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    if (start + size > b.length) throw new Error(BROKEN);
    const raw = b.subarray(start, start + size);
    let data;
    try { data = method === 0 ? raw : await inflate(raw); } catch { throw new Error(BROKEN); }
    if ((usize !== 0xffffffff && data.length !== usize) || crc32(data) !== crc) throw new Error(BROKEN);
    files.set(name, data);
  }
  return files;
}

function unescapeXml(s) {
  return s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
    });
}

function attr(s, name) {
  const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(s);
  return m ? unescapeXml(m[1]) : null;
}

// Текст из <si> или <is>: все <t>, кроме фонетических подсказок <rPh>
function richText(xml) {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ? unescapeXml(m[1]) : '';
  return out;
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

// Некоторые программы пишут теги с префиксом: <x:row>, <x:c>. Убираем префиксы, разбор дальше общий.
function stripPrefixes(xml) {
  return xml.replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, '<$1');
}

function parseSheet(xml, shared) {
  xml = stripPrefixes(xml);
  const rows = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = attr(rm[1], 'r');
    const ri = r ? Number(r) - 1 : nextRow;
    nextRow = ri + 1;
    const row = [];
    let nextCol = 0;
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const ci = ref ? colIndex(ref) : nextCol;
      nextCol = ci + 1;
      const t = attr(cm[1], 't');
      const body = cm[2] || '';
      let v = null;
      if (t === 'inlineStr') {
        const is = /<is>([\s\S]*?)<\/is>/.exec(body);
        v = is ? richText(is[1]) : '';
      } else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (vm) {
          const raw = unescapeXml(vm[1]);
          if (t === 's') v = shared[Number(raw)] ?? '';
          else if (t === 'str' || t === 'e') v = raw;
          else if (t === 'b') v = raw === '1';
          else v = raw === '' ? null : Number(raw);
        }
      }
      if (v !== null && v !== '') row[ci] = v;
    }
    rows[ri] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

function resolveTarget(target) {
  if (target.startsWith('/')) return target.slice(1);
  return 'xl/' + target.replace(/^\.\//, '');
}

export async function readXlsx(buffer) {
  const files = await unzip(buffer, (n) => n.startsWith('xl/') && n.endsWith('.xml') || n.endsWith('.rels'));
  const dec = new TextDecoder();
  const text = (n) => (files.has(n) ? dec.decode(files.get(n)) : '');
  const shared = [];
  for (const m of stripPrefixes(text('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? richText(m[1]) : '');
  const rels = new Map();
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) rels.set(attr(m[1], 'Id'), attr(m[1], 'Target'));
  const sheets = [];
  for (const m of stripPrefixes(text('xl/workbook.xml')).matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const target = rels.get(attr(m[1], 'r:id'));
    const path = target ? resolveTarget(target) : null;
    if (!path || !files.has(path)) continue;
    sheets.push({ name: attr(m[1], 'name'), rows: parseSheet(dec.decode(files.get(path)), shared) });
  }
  if (!sheets.length) throw new Error('В файле не нашлось листов');
  return sheets;
}

export function readCsv(textContent) {
  const first = textContent.split('\n', 1)[0];
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < textContent.length; i++) {
    const ch = textContent[i];
    if (q) {
      if (ch === '"' && textContent[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && textContent[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return [{ name: 'CSV', rows: rows.map((r) => r.map((c) => (c.trim() === '' ? undefined : (/^-?\d+([.,]\d+)?$/.test(c.trim()) ? Number(c.trim().replace(',', '.')) : c)))) }];
}

export async function readTable(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(buf);
  if (head[0] === 0xd0 && head[1] === 0xcf) return readXls(buf);
  return readCsv(new TextDecoder().decode(buf));
}
