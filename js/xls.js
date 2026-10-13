// Чтение старого .xls (Excel 97–2003, BIFF8) без сторонних библиотек.
// Файл — контейнер Microsoft (CFB), в нём поток Workbook с записями листа. Берём только значения ячеек:
// строки, числа, результаты формул. Возвращает то же, что readXlsx: [{name, rows: [[значение, ...], ...]}].
// Обрезанный или испорченный файл не читаем наполовину: половина прайса стёрла бы цены остальных деталей.

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

const LAST = 0xfffffffa; // от него и выше — служебные значения: конец цепочки, свободный сектор и т.п.

class XlsError extends Error {}
const SAVE_AS = ' Открой его в Excel или Numbers и сохрани как .xlsx.';
const broken = () => new XlsError('Файл .xls повреждён или скачан не полностью.' + SAVE_AS);

// --- Контейнер CFB: найти поток по имени (сначала Workbook, потом Book; регистр не важен)
function cfbStream(buf) {
  if (buf.length < 8 || u32(buf, 0) !== 0xe011cfd0 || u32(buf, 4) !== 0xe11ab1a1) throw new XlsError('Это не файл Excel .xls.');
  if (buf.length < 512) throw broken();
  const shift = u16(buf, 0x1e);
  if ((shift !== 9 && shift !== 12) || u16(buf, 0x20) !== 6) throw broken();
  const ss = 1 << shift;
  const mss = 64;
  const cutoff = u32(buf, 0x38);
  const sector = (n) => (n + 1) * ss;
  const count = Math.ceil((buf.length - ss) / ss); // секторов в файле
  const checkSector = (s) => { if (s >= count) throw broken(); };
  // таблица размещения: первые 109 адресов в заголовке, остальные — в цепочке секторов DIFAT
  const difat = [];
  for (let i = 0; i < 109; i++) difat.push(u32(buf, 0x4c + i * 4));
  const seenDifat = new Set();
  for (let s = u32(buf, 0x44), n = u32(buf, 0x48); n > 0 && s < LAST; n--) {
    checkSector(s);
    if (seenDifat.has(s)) throw broken();
    seenDifat.add(s);
    const o = sector(s);
    if (o + ss > buf.length) throw broken();
    for (let i = 0; i < ss / 4 - 1; i++) difat.push(u32(buf, o + i * 4));
    s = u32(buf, o + ss - 4);
  }
  const fatCount = u32(buf, 0x2c);
  if (fatCount > count || fatCount > difat.length) throw broken();
  const fat = [];
  for (const s of difat.slice(0, fatCount)) {
    checkSector(s);
    const o = sector(s);
    if (o + ss > buf.length) throw broken();
    for (let i = 0; i < ss / 4; i++) fat.push(u32(buf, o + i * 4));
  }
  // цепочка секторов: без петель и без адресов за пределами таблицы
  const chain = (start, table) => {
    const out = [];
    const seen = new Set();
    for (let s = start; s < LAST; s = table[s]) {
      if (s >= table.length || seen.has(s)) throw broken();
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  // поток из обычных секторов; size байт должны найтись целиком
  const readChain = (start, size) => {
    if (size > buf.length) throw broken();
    const out = new Uint8Array(size);
    let pos = 0;
    for (const s of chain(start, fat)) {
      if (pos >= size) break;
      const n = Math.min(ss, size - pos);
      if (sector(s) + n > buf.length) throw broken();
      out.set(buf.subarray(sector(s), sector(s) + n), pos);
      pos += n;
    }
    if (pos < size) throw broken();
    return out;
  };
  const dirStart = u32(buf, 0x30);
  const dir = readChain(dirStart, chain(dirStart, fat).length * ss);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = Math.min(64, u16(dir, o + 64));
    let name = '';
    for (let i = 0; i + 2 < len; i += 2) name += String.fromCharCode(u16(dir, o + i));
    entries.push({ name: name.toLowerCase(), type: dir[o + 66], start: u32(dir, o + 116), size: u32(dir, o + 120) });
  }
  const want = entries.find((e) => e.type === 2 && e.name === 'workbook') || entries.find((e) => e.type === 2 && e.name === 'book');
  if (!want) throw new XlsError('В файле .xls не нашлось листов.' + SAVE_AS);
  if (want.size >= cutoff) return readChain(want.start, want.size);
  // маленький поток лежит в «мини-потоке» корневой записи
  const root = entries.find((e) => e.type === 5);
  if (!root || want.size > buf.length) throw broken();
  const mini = readChain(root.start, root.size);
  const minifat = [];
  const mfCount = u32(buf, 0x40);
  if (mfCount > count) throw broken();
  const mf = readChain(u32(buf, 0x3c), mfCount * ss);
  for (let i = 0; i + 4 <= mf.length; i += 4) minifat.push(u32(mf, i));
  const out = new Uint8Array(want.size);
  let pos = 0;
  for (const s of chain(want.start, minifat)) {
    if (pos >= want.size) break;
    const n = Math.min(mss, want.size - pos);
    if (s * mss + n > mini.length) throw broken();
    out.set(mini.subarray(s * mss, s * mss + n), pos);
    pos += n;
  }
  if (pos < want.size) throw broken();
  return out;
}

// --- Записи BIFF8
function records(wb) {
  const out = [];
  for (let o = 0; o + 4 <= wb.length;) {
    const type = u16(wb, o);
    const len = u16(wb, o + 2);
    if (o + 4 + len > wb.length) break; // запись обрезана: лист без конца (EOF) заметим ниже
    out.push({ type, at: o, data: wb.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  return out;
}

// Строка Excel может продолжаться в записях CONTINUE (0x3C): у каждого продолжения свой байт «1 или 2 байта на символ»
class Reader {
  constructor(parts) { this.parts = parts; this.i = 0; this.o = 0; }
  get buf() { return this.parts[this.i]; }
  next() { this.i++; this.o = 0; if (this.i >= this.parts.length) throw broken(); }
  ensure() { while (this.o >= this.buf.length) this.next(); }
  atEnd() { let i = this.i; let o = this.o; while (i < this.parts.length && o >= this.parts[i].length) { i++; o = 0; } return i >= this.parts.length; }
  u8() { this.ensure(); return this.buf[this.o++]; }
  u16() { return this.u8() | (this.u8() << 8); }
  u32() { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n) { while (n > 0) { this.ensure(); const k = Math.min(n, this.buf.length - this.o); this.o += k; n -= k; } }
  chars(cch, high) {
    let s = '';
    let wide = high;
    while (s.length < cch) {
      if (this.o >= this.buf.length) { this.next(); wide = (this.u8() & 1) === 1; }
      if (wide) s += String.fromCharCode(this.u16()); else s += String.fromCharCode(this.u8());
    }
    return s;
  }
  // XLUnicodeRichExtendedString
  string() {
    const cch = this.u16();
    const flags = this.u8();
    const runs = flags & 8 ? this.u16() : 0;
    const ext = flags & 4 ? this.u32() : 0;
    const s = this.chars(cch, (flags & 1) === 1);
    this.skip(runs * 4 + ext);
    return s;
  }
}

function rk(v) {
  let n;
  if (v & 2) n = v >> 2;
  else {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(4, v & 0xfffffffc, true);
    dv.setUint32(0, 0, true);
    n = dv.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

function f64(b, o) {
  return new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true);
}

export function readXls(buffer) {
  try {
    return parse(new Uint8Array(buffer));
  } catch (e) {
    if (e instanceof XlsError) throw e;
    throw broken(); // неожиданная структура: понятное сообщение вместо «Cannot read properties of undefined»
  }
}

function parse(buf) {
  const wb = cfbStream(buf);
  if (wb.length < 8 || u16(wb, 0) !== 0x0809) throw broken();
  if (u16(wb, 4) !== 0x0600) throw new XlsError('Это формат Excel 5.0/95.' + SAVE_AS);
  const recs = records(wb);
  const sst = [];
  const sheets = [];
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k];
    if (r.type === 0x000a) break; // конец общей части книги, дальше листы
    if (r.type === 0x002f) throw new XlsError('Файл .xls защищён паролем. Открой его в Excel или Numbers и сохрани как .xlsx без пароля.');
    if (r.type === 0x0085) {
      const d = r.data;
      const cch = d[6];
      const high = d[7] & 1;
      let name = '';
      for (let i = 0; i < cch; i++) name += String.fromCharCode(high ? u16(d, 8 + i * 2) : d[8 + i]);
      if (d[5] === 0) sheets.push({ name, at: u32(d, 0) });
    } else if (r.type === 0x00fc) {
      const parts = [r.data.subarray(8)];
      for (let j = k + 1; j < recs.length && recs[j].type === 0x003c; j++) parts.push(recs[j].data);
      const rd = new Reader(parts);
      const total = u32(r.data, 4);
      // счётчик строк иногда больше, чем их есть: обрыв ровно на границе строки — просто конец таблицы
      for (let i = 0; i < total && !rd.atEnd(); i++) sst.push(rd.string());
    }
  }
  const byOffset = new Map(recs.map((r, i) => [r.at, i]));
  const out = [];
  for (const sh of sheets) {
    const rows = [];
    const put = (row, col, v) => {
      if (v === null || v === undefined || v === '') return;
      while (rows.length <= row) rows.push([]);
      rows[row][col] = v;
    };
    let k = byOffset.get(sh.at);
    if (k === undefined || recs[k].type !== 0x0809) throw broken();
    let pending = null; // формула со строковым результатом: строка в следующей записи STRING
    let ended = false;
    for (k++; k < recs.length; k++) {
      const { type, data: d } = recs[k];
      if (type === 0x000a) { ended = true; break; }
      if (type === 0x00fd) put(u16(d, 0), u16(d, 2), sst[u32(d, 6)]);
      else if (type === 0x0203) put(u16(d, 0), u16(d, 2), f64(d, 6));
      else if (type === 0x027e) put(u16(d, 0), u16(d, 2), rk(u32(d, 6)));
      else if (type === 0x00bd) {
        const row = u16(d, 0);
        const first = u16(d, 2);
        for (let i = 0; 4 + i * 6 + 6 <= d.length - 2; i++) put(row, first + i, rk(u32(d, 4 + i * 6 + 2)));
      } else if (type === 0x0204) {
        const parts = [d.subarray(6)];
        for (let j = k + 1; j < recs.length && recs[j].type === 0x003c; j++) parts.push(recs[j].data);
        const rd = new Reader(parts);
        const cch = rd.u16();
        put(u16(d, 0), u16(d, 2), rd.chars(cch, (rd.u8() & 1) === 1));
      } else if (type === 0x0006) {
        const row = u16(d, 0);
        const col = u16(d, 2);
        if (u16(d, 12) === 0xffff) {
          if (d[6] === 0) pending = { row, col };
          else if (d[6] === 1) put(row, col, d[8] === 1);
        } else put(row, col, f64(d, 6));
      } else if (type === 0x0207 && pending) {
        const parts = [d];
        for (let j = k + 1; j < recs.length && recs[j].type === 0x003c; j++) parts.push(recs[j].data);
        const rd = new Reader(parts);
        const cch = rd.u16();
        put(pending.row, pending.col, rd.chars(cch, (rd.u8() & 1) === 1));
        pending = null;
      } else if (type === 0x0205 && d[7] === 0) put(u16(d, 0), u16(d, 2), d[6] === 1);
    }
    if (!ended) throw broken();
    out.push({ name: sh.name, rows });
  }
  if (!out.length) throw new XlsError('В файле .xls не нашлось листов.' + SAVE_AS);
  return out;
}
