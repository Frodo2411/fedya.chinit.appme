// Макет Google Apps Script и Google Таблицы для проверки apps-script/Code.gs и js/sheet.js без интернета
import fs from 'node:fs';
import vm from 'node:vm';

export function makeBook(json) {
  const sheets = new Map();
  const toVal = (v) => (v && typeof v === 'object' && v.date ? new Date(v.date + 'T00:00:00Z') : v);
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    cell(i, j) { return this.sh.cell(this.r + i, this.c + j); }
    map(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.cell(i, j), i, j)); out.push(row); } return out; }
    getValues() { return this.map((x) => x.v); }
    getValue() { return this.cell(0, 0).v; }
    getFormulas() { return this.map((x) => x.f); }
    getFormula() { return this.cell(0, 0).f; }
    getFormulaR1C1() { const x = this.cell(0, 0); return x.f ? JSON.stringify({ f: x.f, row: this.r }) : ''; }
    setFormulaR1C1(s) { const { f, row } = JSON.parse(s); const x = this.cell(0, 0); x.f = f.replace(/(?<![$A-Z])([A-Z]{1,2})(\d+)/g, (m, col, r) => (Number(r) === row ? col + this.r : m)); x.v = ''; return this; }
    getNumberFormat() { return this.cell(0, 0).fmt || 'General'; }
    setNumberFormat(f) { this.cell(0, 0).fmt = f; return this; }
    setValue(v) { const x = this.cell(0, 0); x.f = ''; x.v = sheetsParse(v); this.sh.writes++; return this; }
    setValues(vs) { vs.forEach((row, i) => row.forEach((v, j) => { const x = this.cell(i, j); x.f = ''; x.v = sheetsParse(v); })); this.sh.writes++; return this; }
  }
  // Как Google Таблицы разбирают строку при setValue: числа и даты превращаются сами, апостроф — признак текста
  function sheetsParse(v) {
    if (typeof v !== 'string') return v;
    if (v.startsWith("'")) return v.slice(1);
    if (/^-?\d+([.,]\d+)?$/.test(v.trim())) return Number(v.trim().replace(',', '.'));
    if (/^\d{1,2}[./]\d{1,2}([./]\d{2,4})?$/.test(v.trim())) return { parsedAsDate: v };
    return v;
  }
  class Sheet {
    constructor(name, cells) { this.name = name; this.rows = cells; this.hidden = false; this.writes = 0; }
    cell(r, c) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push({ v: '', f: '', fmt: '' }); return row[c - 1]; }
    getName() { return this.name; }
    getLastRow() { let last = 0; this.rows.forEach((row, i) => { if (row.some((x) => x.v !== '' || x.f)) last = i + 1; }); return last; }
    getLastColumn() { let last = 0; for (const row of this.rows) row.forEach((x, j) => { if ((x.v !== '' || x.f) && j + 1 > last) last = j + 1; }); return last; }
    getRange(r, c, nr = 1, nc = 1) { if (r < 1 || c < 1) throw new Error('bad range'); return new Range(this, r, c, nr, nc); }
    getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
    hideSheet() { this.hidden = true; }
  }
  for (const [name, cells] of Object.entries(json)) sheets.set(name, new Sheet(name, cells.map((row) => row.map((x) => ({ v: toVal(x.v), f: x.f, fmt: x.fmt })))));
  const book = {
    getName: () => 'Учёт заказов', getSpreadsheetTimeZone: () => 'Europe/Minsk',
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n, []); sheets.set(n, s); return s; },
    sheets,
  };
  return book;
}

export function loadScript(codePath, book, key) {
  const props = new Map();
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {} },
    Utilities: {
      formatDate: (d, tz, fmt) => d.toISOString().slice(0, 10),
      parseDate: (s) => new Date(s + 'T00:00:00Z'),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => { if (v.length > 9000) throw new Error('property too large'); props.set(k, v); } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
    JSON, Date, Number, String, Object, Math, Error,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codePath, 'utf8').replace("'__KEY__'", JSON.stringify(key)), ctx);
  return { ctx, props, post: (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).content) };
}
