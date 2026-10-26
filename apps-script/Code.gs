// Связь приложения «Федя чинит · мастер» с Google Таблицей заказов.
// Вставь этот код в Расширения → Apps Script и разверни как веб-приложение (инструкция в приложении: «Ещё» → «Google Таблица»).
// Приложение присылает ключ KEY: без него скрипт ничего не отдаёт и ничего не пишет.

const KEY = '__KEY__';

const SHEET_ORDERS = 'Заказы';
const SHEET_EXPENSES = 'Расходы';
const SHEET_SETTINGS = 'Настройки';
const SHEET_APP = 'Приложение (служебный)';

// Столбцы ищутся по заголовкам, порядок в таблице можно менять
const ORDER_COLS = {
  num: '№', date: 'Дата приёма', client: 'Клиент', phone: 'Телефон', address: 'Адрес', source: 'Источник',
  device: 'Устройство', model: 'Модель', problem: 'Неисправность', done: 'Что сделано', price: 'Цена для клиента',
  part: 'Запчасть', profit: 'Прибыль', prepay: 'Предоплата', due: 'К оплате', urgent: 'Срочно', status: 'Статус',
  issued: 'Дата выдачи', warranty: 'Гарантия до', refusal: 'Если отказ', comment: 'Комментарий', month: 'Месяц',
  wfor: 'Гарантия по №',
};
const EXPENSE_COLS = { date: 'Дата', what: 'Что купил', cat: 'Категория', sum: 'Сумма', where: 'Где купил', comment: 'Комментарий' };
const DATE_KEYS = ['date', 'issued', 'warranty', 'month'];
const NUMBER_KEYS = ['num', 'price', 'part', 'profit', 'prepay', 'due', 'sum', 'wfor'];
const TEXT_KEYS = ['client', 'address', 'source', 'device', 'model', 'problem', 'done', 'urgent', 'status', 'refusal', 'comment', 'what', 'cat', 'where'];
// Эти столбцы считает сама таблица
const FORMULA_KEYS = ['profit', 'due', 'warranty', 'month'];
// Этих столбцов в старой таблице может не быть: скрипт добавит их в конец, когда понадобятся
const OPTIONAL_COLS = ['wfor'];
// Гарантийные заказы нумеруются отдельно: Г1, Г2…
const WARRANTY_PREFIX = 'Г';
const VERSION = 2;

function doGet(e) {
  // Просто открыть адрес в браузере — проверка, что скрипт развёрнут правильно. Данных без ключа не отдаём.
  if (!(e && e.parameter && e.parameter.q)) {
    return ContentService.createTextOutput(JSON.stringify({ ok: true, status: 'Скрипт работает. Подключение — в приложении мастера.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return respond_(JSON.parse(e.parameter.q));
}

function doPost(e) {
  let req = {};
  try { req = JSON.parse(e.postData.contents); } catch (err) { /* пустой запрос */ }
  return respond_(req);
}

function respond_(req) {
  let out;
  try {
    if (KEY === '__' + 'KEY__') throw new Error('В коде нет ключа. Скопируй код скрипта из приложения: «Ещё» → «Google Таблица».');
    if (!req || req.key !== KEY) throw new Error('Неверный ключ. Скопируй код скрипта из приложения заново.');
    const fn = API_[req.op];
    if (!fn) throw new Error('Неизвестная операция: ' + req.op);
    out = { ok: true, data: fn(req) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

const API_ = {
  ping: function () { return { title: book_().getName(), lists: lists_(), version: VERSION }; },
  list: function () { return { title: book_().getName(), orders: readOrders_(), expenses: readExpenses_(), lists: lists_(), version: VERSION }; },
  batch: function (req) { return withLock_(function () { return (req.ops || []).map(runOp_); }); },
  kvGet: function (req) { return kvGet_(req.name); },
  kvSet: function (req) { return withLock_(function () { return kvSet_(req.name, req.value, req.ts); }); },
};

function book_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return book_().getSpreadsheetTimeZone(); }

function sheet_(name) {
  const sh = book_().getSheetByName(name);
  if (!sh) throw new Error('Нет листа «' + name + '»');
  return sh;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}

function norm_(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }

function columns_(sh, spec) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm_);
  const out = {};
  Object.keys(spec).forEach(function (k) {
    const want = norm_(spec[k]);
    const i = head.findIndex(function (h) { return h === want || h.indexOf(want) === 0; });
    if (i >= 0) out[k] = i + 1;
  });
  return out;
}

function toJson_(k, v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  if (typeof v === 'number' && (k === 'phone')) return String(v);
  return v;
}

// Строку, которую таблица сама превратила бы в формулу («=…», «+…», «-…»), дату или число, пишем с апострофом:
// так она остаётся текстом, а сам апостроф в значение не попадает
function asText_(v) {
  return /^\s*[=+\-@]/.test(v) || /^[\d\s.,\/:+-]+$/.test(v) ? "'" + v : v;
}

function fromJson_(k, v) {
  if (v === null || v === undefined || v === '') return '';
  if (DATE_KEYS.indexOf(k) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return Utilities.parseDate(String(v), tz_(), 'yyyy-MM-dd');
  if (NUMBER_KEYS.indexOf(k) >= 0 && typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim())) return Number(v.replace(',', '.'));
  // телефон храним цифрами, как в таблице: 375291234567; номер с ведущим нулём — текстом, иначе ноль пропадёт
  if (k === 'phone') {
    const d = String(v).replace(/\D/g, '');
    if (d.length >= 7 && d.length <= 15 && d[0] !== '0') return Number(d);
    return asText_(String(v));
  }
  if (TEXT_KEYS.indexOf(k) >= 0 && typeof v === 'string') return asText_(v);
  return v;
}

function readRows_(sh, cols, isRow) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = sh.getLastColumn();
  const values = sh.getRange(2, 1, last - 1, width).getValues();
  const out = [];
  values.forEach(function (r, i) {
    const o = { row: i + 2 };
    Object.keys(cols).forEach(function (k) { o[k] = toJson_(k, r[cols[k] - 1]); });
    if (isRow(o)) out.push(o);
  });
  return out;
}

function isOrder_(o) { return o.num !== null || o.date !== null || o.model !== null || o.client !== null || o.problem !== null; }
function isExpense_(o) { return o.date !== null || o.what !== null || o.sum !== null; }

function readOrders_() { const sh = sheet_(SHEET_ORDERS); return readRows_(sh, columns_(sh, ORDER_COLS), isOrder_); }
function readExpenses_() { const sh = sheet_(SHEET_EXPENSES); return readRows_(sh, columns_(sh, EXPENSE_COLS), isExpense_); }

// Списки с листа «Настройки»: заголовок в одной ячейке, значения ниже до пустой
function lists_() {
  const sh = book_().getSheetByName(SHEET_SETTINGS);
  const out = { sources: [], devices: [], statuses: [], hints: {}, expenseCats: [], warrantyMonths: 4 };
  if (!sh) return out;
  const v = sh.getDataRange().getValues();
  function column(title) {
    for (let r = 0; r < Math.min(v.length, 10); r++) {
      for (let c = 0; c < v[r].length; c++) {
        if (norm_(v[r][c]) === norm_(title)) {
          const items = [];
          for (let k = r + 1; k < v.length && v[k][c] !== ''; k++) items.push({ value: String(v[k][c]), next: v[k][c + 1] });
          return items;
        }
      }
    }
    return [];
  }
  out.sources = column('Источник').map(function (x) { return x.value; });
  out.devices = column('Устройство').map(function (x) { return x.value; });
  column('Статус').forEach(function (x) { out.statuses.push(x.value); out.hints[x.value] = x.next ? String(x.next) : ''; });
  out.expenseCats = column('Категория расхода').map(function (x) { return x.value; });
  for (let r = 0; r < Math.min(v.length, 15); r++) {
    if (norm_(v[r][0]).indexOf('гарантия') === 0 && typeof v[r][1] === 'number') out.warrantyMonths = v[r][1];
  }
  return out;
}

// --- Запись. Каждая операция с id: повтор того же id не создаёт вторую строку.
function runOp_(op) {
  const props = PropertiesService.getScriptProperties();
  const done = JSON.parse(props.getProperty('done') || '{}');
  if (op.id && done[op.id]) return { id: op.id, ok: true, row: done[op.id][0], num: done[op.id][1], repeat: true };
  // Правка строки, которую приложение только что добавило и ещё не знает её номер: берём его из журнала
  if (op.ref && done[op.ref]) {
    op.row = done[op.ref][0];
    if (done[op.ref][1] !== null) op.num = done[op.ref][1];
    op.byRef = true;
  }
  // Если добавление прервалось на середине, повтор пишет в ту же строку, а не в новую
  const pend = JSON.parse(props.getProperty('pend') || '{}');
  const reserve = function (row, num) {
    pend[op.id] = [row, num];
    props.setProperty('pend', JSON.stringify(pend));
  };
  let res;
  try {
    if (op.op === 'addOrder') res = addRow_(SHEET_ORDERS, ORDER_COLS, op.fields, isOrder_, true, pend[op.id], reserve, op.warranty === true);
    else if (op.op === 'updateOrder') res = updateOrder_(op);
    else if (op.op === 'addExpense') res = addRow_(SHEET_EXPENSES, EXPENSE_COLS, op.fields, isExpense_, false, pend[op.id], reserve);
    else if (op.op === 'updateExpense') res = updateExpense_(op);
    else throw new Error('Неизвестная операция: ' + op.op);
    res.ok = true;
  } catch (err) {
    return { id: op.id, ok: false, error: String(err && err.message ? err.message : err) };
  }
  res.id = op.id;
  if (op.id) {
    done[op.id] = [res.row, res.num === undefined ? null : res.num];
    const ids = Object.keys(done);
    if (ids.length > 150) ids.slice(0, ids.length - 150).forEach(function (k) { delete done[k]; });
    props.setProperty('done', JSON.stringify(done));
    if (pend[op.id]) {
      delete pend[op.id];
      props.setProperty('pend', JSON.stringify(pend));
    }
  }
  return res;
}

// Номер гарантийного заказа «Г12» → 12, обычный номер → null
function warrantyNum_(v) {
  const m = /^\s*Г\s*(\d+)\s*$/i.exec(String(v === null || v === undefined ? '' : v));
  return m ? Number(m[1]) : null;
}

// Номера сравниваем так: 12 и «12» — один заказ, «Г12» и «г 12» — один, 12 и «Г12» — разные
function numKey_(v) {
  const w = warrantyNum_(v);
  if (w !== null) return WARRANTY_PREFIX + w;
  const s = String(v === null || v === undefined ? '' : v).trim();
  return s !== '' && !isNaN(Number(s)) ? String(Number(s)) : s;
}

function ensureCols_(sh, cols, spec, fields) {
  Object.keys(fields || {}).forEach(function (k) {
    if (cols[k] || !spec[k] || OPTIONAL_COLS.indexOf(k) < 0) return;
    const c = sh.getLastColumn() + 1;
    sh.getRange(1, c).setValue(spec[k]);
    cols[k] = c;
  });
}

function writeFields_(sh, row, cols, fields) {
  const width = sh.getLastColumn();
  const formulas = sh.getRange(row, 1, 1, width).getFormulas()[0];
  Object.keys(fields || {}).forEach(function (k) {
    // формулу не трогаем; но в текстовом столбце «формула» — это ошибочно сохранённый текст, его можно перезаписать
    if (!cols[k] || FORMULA_KEYS.indexOf(k) >= 0) return;
    if (formulas[cols[k] - 1] && TEXT_KEYS.indexOf(k) < 0 && k !== 'phone') return;
    const cell = sh.getRange(row, cols[k]);
    const value = fromJson_(k, fields[k]);
    cell.setValue(value);
    if (value instanceof Date && /^(general|0|)$/i.test(String(cell.getNumberFormat()))) cell.setNumberFormat('dd.MM.yyyy');
  });
}

// Формулы новой строки: если в ней пусто, копируем из строки выше
function fillFormulas_(sh, row, cols) {
  if (row < 3) return;
  FORMULA_KEYS.forEach(function (k) {
    if (!cols[k]) return;
    const cell = sh.getRange(row, cols[k]);
    if (cell.getFormula()) return;
    const above = sh.getRange(row - 1, cols[k]).getFormulaR1C1();
    if (above) cell.setFormulaR1C1(above);
  });
}

function addRow_(name, spec, fields, isRow, numbered, reserved, reserve, warranty) {
  const sh = sheet_(name);
  const cols = columns_(sh, spec);
  const f = Object.assign({}, fields);
  ensureCols_(sh, cols, spec, f);
  let target = null;
  if (reserved) {
    target = reserved[0];
    if (numbered) f.num = reserved[1];
  } else {
    const rows = readRows_(sh, cols, function () { return true; });
    let maxNum = 0;
    let maxWarranty = 0;
    rows.forEach(function (o) {
      if (numbered && typeof o.num === 'number' && o.num > maxNum) maxNum = o.num;
      const w = numbered ? warrantyNum_(o.num) : null;
      if (w !== null && w > maxWarranty) maxWarranty = w;
      if (target === null && !isRow(o)) target = o.row;
    });
    if (target === null) target = Math.max(sh.getLastRow(), 1) + 1;
    if (numbered && (f.num === undefined || f.num === null || f.num === '')) f.num = warranty ? WARRANTY_PREFIX + (maxWarranty + 1) : maxNum + 1;
    if (reserve) reserve(target, numbered ? f.num : null);
  }
  writeFields_(sh, target, cols, f);
  fillFormulas_(sh, target, cols);
  return { row: target, num: numbered ? f.num : null };
}

function updateOrder_(op) {
  const sh = sheet_(SHEET_ORDERS);
  const cols = columns_(sh, ORDER_COLS);
  if (op.num === null || op.num === undefined || op.num === '') throw new Error('У заказа нет номера: обнови список и попробуй ещё раз');
  const key = numKey_(op.num);
  let row = null;
  if (op.row && cols.num && numKey_(sh.getRange(op.row, cols.num).getValue()) === key) row = op.row;
  if (row === null) {
    const found = readRows_(sh, cols, isOrder_).filter(function (o) { return numKey_(o.num) === key; });
    if (!found.length) throw new Error('Не нашёл заказ №' + op.num);
    row = found[0].row;
  }
  ensureCols_(sh, cols, ORDER_COLS, op.fields);
  writeFields_(sh, row, cols, op.fields);
  return { row: row, num: op.num };
}

function updateExpense_(op) {
  const sh = sheet_(SHEET_EXPENSES);
  const cols = columns_(sh, EXPENSE_COLS);
  if (op.byRef) {
    writeFields_(sh, op.row, cols, op.fields);
    return { row: op.row };
  }
  if (!op.was) throw new Error('Не понял, какой расход править: обнови список и попробуй ещё раз');
  const same = function (o) { return o.date === op.was.date && String(o.what) === String(op.was.what) && Number(o.sum) === Number(op.was.sum); };
  let row = null;
  if (op.row) {
    const here = readRows_(sh, cols, function () { return true; }).filter(function (o) { return o.row === op.row; })[0];
    if (here && same(here)) row = op.row;
  }
  if (row === null) {
    const found = readRows_(sh, cols, isExpense_).filter(same);
    if (!found.length) throw new Error('Не нашёл расход «' + op.was.what + '»');
    row = found[0].row;
  }
  writeFields_(sh, row, cols, op.fields);
  return { row: row };
}

// --- Служебный лист для резервной копии данных приложения (зашифрованы, читать их без пароля нельзя)
function kvSheet_() {
  let sh = book_().getSheetByName(SHEET_APP);
  if (!sh) {
    sh = book_().insertSheet(SHEET_APP);
    sh.getRange(1, 1, 1, 3).setValues([['Ключ', 'Обновлено', 'Данные (зашифрованы)']]);
    sh.hideSheet();
  }
  return sh;
}

function kvGet_(name) {
  const sh = kvSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const v = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (let i = 0; i < v.length; i++) {
    if (v[i][0] === name) return { ts: Number(v[i][1]) || 0, value: v[i].slice(2).join('') };
  }
  return null;
}

function kvSet_(name, value, ts) {
  const sh = kvSheet_();
  const chunks = [];
  for (let i = 0; i < value.length; i += 45000) chunks.push(value.slice(i, i + 45000));
  const last = sh.getLastRow();
  let row = last + 1;
  if (last >= 2) {
    const keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) if (keys[i][0] === name) { row = i + 2; break; }
  }
  const width = Math.max(sh.getLastColumn(), chunks.length + 2);
  // апостроф: кусок base64 может начинаться с «+», и таблица приняла бы его за формулу
  const line = [name, ts || Date.now()].concat(chunks.map(function (c) { return "'" + c; }));
  while (line.length < width) line.push('');
  sh.getRange(row, 1, 1, width).setValues([line]);
  return { ts: line[1] };
}
