// Связь приложения «Федя чинит · мастер» с Google Таблицей заказов и выкупленных устройств.
// Вставь этот код в Расширения → Apps Script и разверни как веб-приложение (инструкция в приложении: «Ещё» → «Google Таблица»).
// Приложение присылает ключ KEY: без него скрипт ничего не отдаёт и ничего не пишет.

const KEY = '__KEY__';

const SHEET_ORDERS = 'Заказы';
const SHEET_EXPENSES = 'Расходы';
const SHEET_SETTINGS = 'Настройки';
const SHEET_APP = 'Приложение (служебный)';
const SHEET_DEVICES = 'Устройства';
const SHEET_PARTS = 'Запчасти';

// Столбцы ищутся по заголовкам, порядок в таблице можно менять
const ORDER_COLS = {
  num: '№', date: 'Дата приёма', client: 'Клиент', phone: 'Телефон', address: 'Адрес', source: 'Источник',
  device: 'Устройство', model: 'Модель', problem: 'Неисправность', done: 'Что сделано', price: 'Цена для клиента',
  part: 'Запчасть', profit: 'Прибыль', prepay: 'Предоплата', due: 'К оплате', urgent: 'Срочно', status: 'Статус',
  issued: 'Дата выдачи', warranty: 'Гарантия до', refusal: 'Если отказ', comment: 'Комментарий', month: 'Месяц',
  wfor: 'Гарантия по №',
};
const EXPENSE_COLS = { date: 'Дата', what: 'Что купил', cat: 'Категория', sum: 'Сумма', where: 'Где купил', comment: 'Комментарий' };
// Выкупленные устройства и их запчасти. Заголовки на этих листах во второй строке (в первой — подсказка).
// Себестоимость, прибыль, доходность и дни считают формулы таблицы: эти столбцы скрипт не пишет
const DEVICE_COLS = {
  num: '№', date: 'Дата покупки', device: 'Устройство', cat: 'Категория', source: 'Где куплено', problem: 'Что сломано',
  buy: 'Цена покупки', other: 'Прочие расходы', status: 'Статус', plan: 'Цена продажи (план)', sold: 'Цена продажи (факт)',
  soldDate: 'Дата продажи', note: 'Заметки',
};
const PART_COLS = { dnum: '№ устройства', name: 'Запчасть', where: 'Где куплена', price: 'Цена', date: 'Дата', status: 'Статус', note: 'Заметки' };
// По этим заголовкам узнаём строку заголовков
const DEVICE_HEAD = ['№', 'Устройство', 'Цена покупки'];
const PART_HEAD = ['№ устройства', 'Запчасть'];
const DATE_KEYS = ['date', 'issued', 'warranty', 'month', 'soldDate'];
const NUMBER_KEYS = ['num', 'price', 'part', 'profit', 'prepay', 'due', 'sum', 'wfor', 'buy', 'other', 'plan', 'sold', 'dnum'];
const TEXT_KEYS = ['client', 'address', 'source', 'device', 'model', 'problem', 'done', 'urgent', 'status', 'refusal', 'comment', 'what', 'cat', 'where', 'name', 'note'];
// Эти столбцы считает сама таблица
const FORMULA_KEYS = ['profit', 'due', 'warranty', 'month'];
// Этих столбцов в старой таблице может не быть: скрипт добавит их в конец, когда понадобятся
const OPTIONAL_COLS = ['wfor'];
// Гарантийные заказы нумеруются отдельно: Г1, Г2…
const WARRANTY_PREFIX = 'Г';
// 3 — номер гарантийного пишется и поверх формулы в «№»; 4 — удаление заказа; 5 — выкупленные устройства и их запчасти
const VERSION = 5;

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
  list: function () {
    return Object.assign({ title: book_().getName(), orders: readOrders_(), expenses: readExpenses_(), lists: lists_(), version: VERSION }, devicesData_());
  },
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

// headRow — строка заголовков (по умолчанию первая)
function columns_(sh, spec, headRow) {
  const head = sh.getRange(headRow || 1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm_);
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

// start — первая строка данных (по умолчанию вторая)
function readRows_(sh, cols, isRow, start) {
  const first = start || 2;
  const last = sh.getLastRow();
  if (last < first) return [];
  const width = sh.getLastColumn();
  const values = sh.getRange(first, 1, last - first + 1, width).getValues();
  const out = [];
  values.forEach(function (r, i) {
    const o = { row: i + first };
    Object.keys(cols).forEach(function (k) { o[k] = toJson_(k, r[cols[k] - 1]); });
    if (isRow(o)) out.push(o);
  });
  return out;
}

// != null: столбца может не быть (тогда значение undefined) — пустая строка остаётся пустой
function isOrder_(o) { return o.num != null || o.date != null || o.model != null || o.client != null || o.problem != null; }
function isExpense_(o) { return o.date != null || o.what != null || o.sum != null; }

// Заказ, от которого остались только формулы (номер, прибыль…), — удалённый: строку очистили, формулы оставили
function hasData_(o) {
  return Object.keys(ORDER_COLS).some(function (k) { return k !== 'num' && FORMULA_KEYS.indexOf(k) < 0 && o[k] != null; });
}
function readOrders_() { const sh = sheet_(SHEET_ORDERS); return readRows_(sh, columns_(sh, ORDER_COLS), isOrder_).filter(hasData_); }
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
  // Запчасть к устройству, которое добавлено в этой же очереди: номер устройства берём из журнала
  if (op.dref && done[op.dref] && op.fields && (op.fields.dnum === null || op.fields.dnum === undefined || op.fields.dnum === '')) {
    op.fields.dnum = done[op.dref][1];
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
    else if (op.op === 'deleteOrder') res = deleteOrder_(op);
    else if (op.op === 'addExpense') res = addRow_(SHEET_EXPENSES, EXPENSE_COLS, op.fields, isExpense_, false, pend[op.id], reserve);
    else if (op.op === 'updateExpense') res = updateExpense_(op);
    else if (op.op === 'addDevice') res = addDevice_(op, pend[op.id], reserve);
    else if (op.op === 'updateDevice') res = updateDevice_(op);
    else if (op.op === 'deleteDevice') res = deleteDevice_(op);
    else if (op.op === 'addPart') res = addPart_(op, pend[op.id], reserve);
    else if (op.op === 'updatePart') res = updatePart_(op);
    else if (op.op === 'deletePart') res = deletePart_(op);
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
    // формулу не трогаем; но в текстовом столбце «формула» — это ошибочно сохранённый текст, его можно перезаписать.
    // Номер гарантийного (Г1…) пишем и поверх формулы в «№»: формула дала бы обычный номер
    if (!cols[k] || FORMULA_KEYS.indexOf(k) >= 0) return;
    const warrantyNumber = k === 'num' && warrantyNum_(fields[k]) !== null;
    if (formulas[cols[k] - 1] && TEXT_KEYS.indexOf(k) < 0 && k !== 'phone' && !warrantyNumber) return;
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

// Строка заказа: по номеру строки, если там тот же номер, иначе поиском по номеру
function orderRow_(sh, cols, op) {
  if (op.num === null || op.num === undefined || op.num === '') throw new Error('У заказа нет номера: обнови список и попробуй ещё раз');
  const key = numKey_(op.num);
  const warranty = warrantyNum_(op.num) !== null;
  const at = op.row && cols.num ? sh.getRange(op.row, cols.num) : null;
  let row = null;
  if (at && numKey_(at.getValue()) === key) row = op.row;
  // гарантийный, добавленный скриптом версии 2: в «№» осталась формула с обычным номером, строку знаем по журналу
  else if (at && op.byRef && warranty && at.getFormula()) row = op.row;
  if (row === null) {
    const found = readRows_(sh, cols, isOrder_).filter(function (o) { return numKey_(o.num) === key && hasData_(o); });
    if (!found.length) throw new Error('Не нашёл заказ №' + op.num);
    row = found[0].row;
  }
  return row;
}

function updateOrder_(op) {
  const sh = sheet_(SHEET_ORDERS);
  const cols = columns_(sh, ORDER_COLS);
  const row = orderRow_(sh, cols, op);
  const key = numKey_(op.num);
  const warranty = warrantyNum_(op.num) !== null;
  ensureCols_(sh, cols, ORDER_COLS, op.fields);
  if (warranty && numKey_(sh.getRange(row, cols.num).getValue()) !== key) sh.getRange(row, cols.num).setValue(op.num);
  writeFields_(sh, row, cols, op.fields);
  return { row: row, num: op.num };
}

// Удалить заказ. Номера вписаны (в «№» с этой строки и ниже нет формул) — строка удаляется целиком, номера других
// заказов не меняются. Номер считает формула («наибольший номер выше + 1») — строку удалять или очищать нельзя:
// номера всех заказов ниже съехали бы. Тогда номер удалённого заказа остаётся в строке числом (вместо формулы),
// остальное очищается (формулы прибыли и т. п. остаются); такая строка в списке не показывается, номер не занимается
function deleteOrder_(op) {
  const sh = sheet_(SHEET_ORDERS);
  const cols = columns_(sh, ORDER_COLS);
  const row = orderRow_(sh, cols, op);
  const last = Math.max(sh.getLastRow(), row);
  const numFormulas = cols.num && sh.getRange(row, cols.num, last - row + 1, 1).getFormulas().some(function (r) { return r[0]; });
  if (!numFormulas) {
    sh.deleteRow(row);
    return { row: row, num: op.num, deleted: true };
  }
  const num = sh.getRange(row, cols.num).getValue();
  const formulas = sh.getRange(row, 1, 1, sh.getLastColumn()).getFormulas()[0];
  formulas.forEach(function (f, i) { if (!f && i + 1 !== cols.num) sh.getRange(row, i + 1).clearContent(); });
  sh.getRange(row, cols.num).setValue(num);
  return { row: row, num: op.num, cleared: true };
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

// --- Выкупленные устройства («Устройства») и их запчасти («Запчасти»)

// Лист, где заголовки не в первой строке: строка заголовков — первая из пяти верхних, где есть все заголовки must.
// Листа нет — null
function table_(name, spec, must) {
  const sh = book_().getSheetByName(name);
  if (!sh) return null;
  const want = must.map(norm_);
  const last = Math.min(sh.getLastRow(), 5);
  for (let r = 1; r <= last; r++) {
    const head = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0].map(norm_);
    const ok = want.every(function (w) { return head.some(function (h) { return h === w || h.indexOf(w) === 0; }); });
    if (ok) return { sh: sh, head: r, cols: columns_(sh, spec, r) };
  }
  throw new Error('На листе «' + name + '» не нашёл строку заголовков (' + must.join(', ') + ')');
}

function needTable_(name, spec, must) {
  const t = table_(name, spec, must);
  if (!t) throw new Error('Нет листа «' + name + '»');
  return t;
}

function isDevice_(o) { return o.num != null || o.device != null || o.buy != null; }
function isPart_(o) { return o.dnum != null || o.name != null || o.price != null; }
// Строка без данных (формулы в ней могут быть): сюда можно писать новое
function blankRow_(o, spec) { return Object.keys(spec).every(function (k) { return o[k] == null; }); }

function rowAt_(sh, cols, row) {
  const r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  const o = { row: row };
  Object.keys(cols).forEach(function (k) { o[k] = toJson_(k, r[cols[k] - 1]); });
  return o;
}

// Для списка в приложении. Листов нет (старая таблица) — null; ошибка в этих листах не мешает заказам
function devicesData_() {
  try {
    const d = table_(SHEET_DEVICES, DEVICE_COLS, DEVICE_HEAD);
    const p = table_(SHEET_PARTS, PART_COLS, PART_HEAD);
    return {
      devices: d ? readRows_(d.sh, d.cols, isDevice_, d.head + 1) : null,
      parts: p ? readRows_(p.sh, p.cols, isPart_, p.head + 1) : (d ? [] : null),
    };
  } catch (err) {
    return { devices: null, parts: null, devicesError: String(err && err.message ? err.message : err) };
  }
}

// Новая строка после строк с готовыми формулами: формулы (себестоимость, прибыль…) берём из строки выше
function copyFormulas_(sh, row, head) {
  if (row <= head + 1) return;
  const width = sh.getLastColumn();
  const above = sh.getRange(row - 1, 1, 1, width).getFormulas()[0];
  const here = sh.getRange(row, 1, 1, width).getFormulas()[0];
  above.forEach(function (f, i) {
    if (!f || here[i]) return;
    const cell = sh.getRange(row, i + 1);
    if (cell.getValue() !== '') return;
    cell.setFormulaR1C1(sh.getRange(row - 1, i + 1).getFormulaR1C1());
  });
}

// Первая строка без данных (там уже стоят формулы) или новая в конце
function freeRow_(t, spec) {
  let target = null;
  readRows_(t.sh, t.cols, function () { return true; }, t.head + 1).forEach(function (o) {
    if (target === null && blankRow_(o, spec)) target = o.row;
  });
  return target === null ? Math.max(t.sh.getLastRow(), t.head) + 1 : target;
}

// Номер — следующий после наибольшего
function addDevice_(op, reserved, reserve) {
  const t = needTable_(SHEET_DEVICES, DEVICE_COLS, DEVICE_HEAD);
  const f = Object.assign({}, op.fields);
  let target;
  if (reserved) {
    target = reserved[0];
    f.num = reserved[1];
  } else {
    let max = 0;
    readRows_(t.sh, t.cols, isDevice_, t.head + 1).forEach(function (o) {
      const n = Number(o.num);
      if (o.num !== null && !isNaN(n) && n > max) max = n;
    });
    target = freeRow_(t, DEVICE_COLS);
    f.num = max + 1;
    reserve(target, f.num);
  }
  writeFields_(t.sh, target, t.cols, f);
  copyFormulas_(t.sh, target, t.head);
  return { row: target, num: f.num };
}

// Строка устройства: по номеру строки, если там тот же номер, иначе поиском по номеру
function deviceRow_(t, op) {
  if (op.num === null || op.num === undefined || op.num === '') throw new Error('У устройства нет номера: обнови список и попробуй ещё раз');
  const key = numKey_(op.num);
  if (op.row && op.row > t.head && numKey_(t.sh.getRange(op.row, t.cols.num).getValue()) === key) return op.row;
  const found = readRows_(t.sh, t.cols, isDevice_, t.head + 1).filter(function (o) { return numKey_(o.num) === key; });
  if (!found.length) throw new Error('Не нашёл устройство №' + op.num);
  return found[0].row;
}

function updateDevice_(op) {
  const t = needTable_(SHEET_DEVICES, DEVICE_COLS, DEVICE_HEAD);
  const row = deviceRow_(t, op);
  const f = Object.assign({}, op.fields);
  delete f.num;
  writeFields_(t.sh, row, t.cols, f);
  return { row: row, num: op.num };
}

// Удалить устройство вместе с его запчастями. Строки удаляются целиком: формулы других строк сдвигаются сами
function deleteDevice_(op) {
  const t = needTable_(SHEET_DEVICES, DEVICE_COLS, DEVICE_HEAD);
  const row = deviceRow_(t, op);
  const key = numKey_(t.sh.getRange(row, t.cols.num).getValue());
  t.sh.deleteRow(row);
  let parts = 0;
  const p = table_(SHEET_PARTS, PART_COLS, PART_HEAD);
  if (p && key !== '') {
    readRows_(p.sh, p.cols, isPart_, p.head + 1).filter(function (o) { return numKey_(o.dnum) === key; })
      .reverse().forEach(function (o) { p.sh.deleteRow(o.row); parts++; });
  }
  return { row: row, num: op.num, deleted: true, parts: parts };
}

function addPart_(op, reserved, reserve) {
  const t = needTable_(SHEET_PARTS, PART_COLS, PART_HEAD);
  const f = Object.assign({}, op.fields);
  if (f.dnum === null || f.dnum === undefined || f.dnum === '') throw new Error('Не знаю номер устройства для запчасти: обнови список и попробуй ещё раз');
  let target;
  if (reserved) target = reserved[0];
  else {
    target = freeRow_(t, PART_COLS);
    reserve(target, null);
  }
  writeFields_(t.sh, target, t.cols, f);
  copyFormulas_(t.sh, target, t.head);
  return { row: target, dnum: f.dnum };
}

// Запчасть ищем по тому, что о ней знало приложение (was: номер устройства, название, цена): строки могли сдвинуться
function partRow_(t, op) {
  if (!op.was) {
    if (op.byRef && op.row) return op.row;
    throw new Error('Не понял, какую запчасть править: обнови список и попробуй ещё раз');
  }
  const same = function (o) {
    return numKey_(o.dnum) === numKey_(op.was.dnum) && String(o.name || '') === String(op.was.name || '') && Number(o.price || 0) === Number(op.was.price || 0);
  };
  if (op.row && op.row > t.head && same(rowAt_(t.sh, t.cols, op.row))) return op.row;
  const found = readRows_(t.sh, t.cols, isPart_, t.head + 1).filter(same);
  if (!found.length) throw new Error('Не нашёл запчасть «' + (op.was.name || '') + '»');
  return found[0].row;
}

function updatePart_(op) {
  const t = needTable_(SHEET_PARTS, PART_COLS, PART_HEAD);
  const row = partRow_(t, op);
  writeFields_(t.sh, row, t.cols, op.fields);
  return { row: row };
}

function deletePart_(op) {
  const t = needTable_(SHEET_PARTS, PART_COLS, PART_HEAD);
  const row = partRow_(t, op);
  t.sh.deleteRow(row);
  return { row: row, deleted: true };
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
