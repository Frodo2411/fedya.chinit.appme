// Чтение старого .xls (Excel 97–2003, BIFF8) без сторонних библиотек.
// Файл — контейнер Microsoft (CFB), в нём поток Workbook с записями листа. Берём только значения ячеек:
// строки, числа, результаты формул. Возвращает то же, что readXlsx: [{name, rows: [[значение, ...], ...]}].

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

const END = 0xfffffffe;

// --- Контейнер CFB: найти поток по имени
function cfbStream(buf, names) {
  if (u32(buf, 0) !== 0xe011cfd0 || u32(buf, 4) !== 0xe11ab1a1) throw new Error('Это не файл Excel .xls');
  const ss = 1 << u16(buf, 0x1e);
  const mss = 1 << u16(buf, 0x20);
  const cutoff = u32(buf, 0x38);
  const sector = (n) => (n + 1) * ss;
  // таблица размещения: первые 109 адресов в заголовке, остальные — в цепочке секторов DIFAT
  const difat = [];
  for (let i = 0; i < 109; i++) difat.push(u32(buf, 0x4c + i * 4));
  for (let s = u32(buf, 0x44), n = u32(buf, 0x48); n > 0 && s < END; n--) {
    const o = sector(s);
    for (let i = 0; i < ss / 4 - 1; i++) difat.push(u32(buf, o + i * 4));
    s = u32(buf, o + ss - 4);
  }
  const fat = [];
  for (const s of difat.slice(0, u32(buf, 0x2c))) {
    const o = sector(s);
    for (let i = 0; i < ss / 4; i++) fat.push(u32(buf, o + i * 4));
  }
  const chain = (start, table) => {
    const out = [];
    for (let s = start; s < END && out.length <= table.length; s = table[s]) out.push(s);
    return out;
  };
  const readChain = (start, size) => {
    const out = new Uint8Array(size);
    let pos = 0;
    for (const s of chain(start, fat)) {
      const n = Math.min(ss, size - pos);
      if (n <= 0) break;
      out.set(buf.subarray(sector(s), sector(s) + n), pos);
      pos += n;
    }
    return out;
  };
  const dirSectors = chain(u32(buf, 0x30), fat);
  const dir = readChain(u32(buf, 0x30), dirSectors.length * ss);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = u16(dir, o + 64);
    let name = '';
    for (let i = 0; i + 2 < len; i += 2) name += String.fromCharCode(u16(dir, o + i));
    entries.push({ name, type: dir[o + 66], start: u32(dir, o + 116), size: u32(dir, o + 120) });
  }
  const want = entries.find((e) => e.type === 2 && names.includes(e.name));
  if (!want) throw new Error('В файле .xls не нашлось листов');
  if (want.size >= cutoff) return readChain(want.start, want.size);
  // маленький поток лежит в «мини-потоке» корневой записи
  const root = entries.find((e) => e.type === 5);
  const mini = readChain(root.start, root.size);
  const minifat = [];
  const mf = readChain(u32(buf, 0x3c), u32(buf, 0x40) * ss);
  for (let i = 0; i + 4 <= mf.length; i += 4) minifat.push(u32(mf, i));
  const out = new Uint8Array(want.size);
  let pos = 0;
  for (const s of chain(want.start, minifat)) {
    const n = Math.min(mss, want.size - pos);
    if (n <= 0) break;
    out.set(mini.subarray(s * mss, s * mss + n), pos);
    pos += n;
  }
  return out;
}

// --- Записи BIFF8
function records(wb) {
  const out = [];
  for (let o = 0; o + 4 <= wb.length;) {
    const type = u16(wb, o);
    const len = u16(wb, o + 2);
    out.push({ type, at: o, data: wb.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  return out;
}

// Строка Excel может продолжаться в записях CONTINUE (0x3C): у каждого продолжения свой байт «1 или 2 байта на символ»
class Reader {
  constructor(parts) { this.parts = parts; this.i = 0; this.o = 0; }
  get buf() { return this.parts[this.i]; }
  next() { this.i++; this.o = 0; }
  ensure() { while (this.i < this.parts.length && this.o >= this.buf.length) this.next(); }
  u8() { this.ensure(); return this.buf[this.o++]; }
  u16() { return this.u8() | (this.u8() << 8); }
  u32() { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n) { while (n > 0) { this.ensure(); const k = Math.min(n, this.buf.length - this.o); this.o += k; n -= k; } }
  chars(cch, high) {
    let s = '';
    let wide = high;
    while (s.length < cch) {
      if (this.i < this.parts.length && this.o >= this.buf.length) { this.next(); wide = (this.u8() & 1) === 1; }
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
  const wb = cfbStream(new Uint8Array(buffer), ['Workbook', 'Book']);
  const recs = records(wb);
  const sst = [];
  const sheets = [];
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k];
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
      for (let i = 0; i < total && rd.i < parts.length; i++) sst.push(rd.string());
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
    if (k === undefined) continue;
    let pending = null; // формула со строковым результатом: строка в следующей записи STRING
    for (k++; k < recs.length; k++) {
      const { type, data: d } = recs[k];
      if (type === 0x000a) break;
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
    out.push({ name: sh.name, rows });
  }
  if (!out.length) throw new Error('В файле .xls не нашлось листов');
  return out;
}
