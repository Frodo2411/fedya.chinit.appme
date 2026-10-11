// Проверки без интернета и без настоящих данных: node tests/run.mjs
// С паролем (FC_PASSWORD=… node tests/run.mjs) дополнительно проверяется зашифрованный прайс data/prices.enc.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (f) => import(path.join(ROOT, f));
const { Pricer, clientPrice, workFee, pyRound2, settingsWithDefaults, siteFile } = await imp('js/engine.js');
const RULES = await imp('js/rules.js');
const { mapRow, siteIndex, items, tier, lineKey, kindOf, networkOk, BRAND_FAM } = RULES;
const { ModelSearch } = await imp('js/search.js');
const { seal, open, deriveKeyBytes, randomBytes, fromB64 } = await imp('js/crypto.js');
const { decode, encode } = await imp('js/data.js');
const { readXlsx } = await imp('js/xlsx.js');
const { detect, buildImport, clientChanges, normStock } = await imp('js/importer.js');
const { computed, summary, addMonths } = await imp('js/orders.js');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(name + ': ' + e.message);
  }
}

// --- Вымышленные данные в формате пакета
const MODELS = [
  { brand: 'iPhone', model: 'iPhone 11', year: 2019, ifixit: 6, sf: { display_copy: 120, display_orig: 250, battery: 100 }, sfUrl: null },
  { brand: 'iPhone', model: 'iPhone 14', year: 2022, ifixit: 7, sf: null, sfUrl: null },
  { brand: 'Samsung', model: 'Samsung Galaxy A52', year: 2021, ifixit: 4, sf: null, sfUrl: null },
  { brand: 'Samsung', model: 'Samsung Galaxy A52s', year: 2021, ifixit: 4, sf: null, sfUrl: null },
  { brand: 'Redmi', model: 'Redmi Note 13', year: 2024, ifixit: null, sf: null, sfUrl: null },
];
const P = (sup, name, cost, stock, svc, t, models, line) => ({ sup, name, cost, stock, svc, tier: t, models, line: line || name });
const DATA = {
  v: 1, priceDate: '2026-10-10', sfDate: '2026-10-10', history: [],
  suppliers: { P: { name: 'Второй', stock: true, rank: 0 }, E: { name: 'Первый', stock: false, rank: 1 } },
  models: MODELS,
  parts: [
    P('E', 'Дисплей iPhone 11 - In-Cell', 40, null, 'd', 'copy_lcd', ['iPhone 11']),
    P('P', 'Дисплей iPhone 11 - Incell JK', 38, 'Нет в наличии', 'd', 'copy_lcd', ['iPhone 11']),
    P('P', 'Дисплей iPhone 11 - Original (снятый)', 90, 'В наличии', 'd', 'orig_used', ['iPhone 11']),
    P('E', 'Дисплей iPhone 11 - Original (снятый, царапина)', 50, null, 'd', 'orig_used', ['iPhone 11']),
    P('E', 'Аккумулятор iPhone 11 - копия', 25, null, 'b', 'copy', ['iPhone 11']),
    P('E', 'Аккумулятор iPhone 11 - усиленная', 24, null, 'b', 'copy_boost', ['iPhone 11']),
    P('E', 'Задняя крышка iPhone 14 - черная', 38, null, 'c', 'copy', ['iPhone 14'], 'Задняя крышка iPhone 14 -'),
    P('E', 'Задняя крышка iPhone 14 - белая', 41, null, 'c', 'copy', ['iPhone 14'], 'Задняя крышка iPhone 14 -'),
    P('E', 'Задняя крышка iPhone 11 - черная', 20, null, 'c', 'copy', ['iPhone 11']),
    P('E', 'Аккумулятор Samsung A52/A52s - Zevo', 22, null, 'b', 'copy', ['Samsung Galaxy A52', 'Samsung Galaxy A52s']),
  ],
};

await test('python round(x, 2)', () => {
  assert.deepEqual([0.125, 0.375, 2.675, 1.005, 94.665, 100.125, -0.125].map(pyRound2), [0.12, 0.38, 2.67, 1, 94.67, 100.12, -0.12]);
});

await test('работа: база × сложность × новизна, вверх до 5, не меньше минимума', () => {
  const S = settingsWithDefaults({ year: 2026 });
  assert.equal(workFee(S, 'd', MODELS[0]), 70); // 60 × 1,15 × 1,0 = 69 → 70
  assert.equal(workFee(S, 'b', MODELS[2]), 65); // 50 × 1,3 × 1,0 = 65
  assert.equal(workFee(S, 'p', MODELS[4]), 55); // 45 × 1,0 × 1,15 = 51,75 → 55 (модели 2 года)
  assert.equal(workFee(S, 'c', MODELS[1]), 50); // 35 → минимум 50
});

await test('цена клиенту и сверка со SmartFix', () => {
  const S = settingsWithDefaults({ year: 2026 });
  assert.deepEqual(clientPrice(S, 70, 40), { price: 125, formula: 125, smartfix: null }); // (70+40)/0,9 = 122,2 → 125
  assert.equal(clientPrice(S, 70, 40, 120).price, 115); // ниже SmartFix: floor5(120 − 5)
  assert.equal(clientPrice(S, 70, 40, 400).price, 200); // поднято до половины SmartFix
  assert.equal(clientPrice(S, 70, 100, 120).price, 170); // не ниже детали + минимальной работы с налогом
});

await test('выбор детали: наличие, брак, самый дорогой цвет, скрытие слабого варианта, крышка без лазера', () => {
  const pr = new Pricer(DATA, { year: 2026 });
  const m = pr.model('iPhone 11');
  const d = m.services.d.opts;
  assert.equal(d[0].tier, 'copy_lcd');
  assert.equal(d[0].sup, 'E', 'деталь не в наличии уступает той, что есть');
  assert.equal(d[0].alt.sup, 'P');
  assert.equal(d[1].tier, 'orig_used');
  assert.equal(d[1].cost, 90, 'деталь с царапиной не берём');
  const b = m.services.b.opts;
  assert.equal(b[0].hidden, true, 'обычная копия не дешевле усиленной — прячем');
  assert.equal(m.services.c.opts.length, 0, 'iPhone 11: крышка только с лазером');
  const c14 = pr.model('iPhone 14').services.c.opts[0];
  assert.equal(c14.cost, 41);
  assert.equal(c14.colours, 2);
});

await test('файл для сайта: только цены клиенту', () => {
  const text = siteFile(new Pricer(DATA, { year: 2026 }), 'Октябрь 2026');
  assert.ok(text.includes('window.MODEL_PRICES = ['));
  assert.ok(!text.includes('Первый') && !text.includes('Второй') && !text.includes('In-Cell'));
  const arr = JSON.parse(text.slice(text.indexOf('window.MODEL_PRICES = ') + 22).trim().replace(/;$/, ''));
  assert.deepEqual(arr[0], ['iPhone', 'iPhone 11', { b: [['copy_boost', 95]], d: [['copy_lcd', 115], ['orig_used', 180]] }]);
});

await test('разбор названий для новых строк прайса', () => {
  const names = MODELS.map((m) => m.model);
  const idx = siteIndex(names);
  const fam = new Map(MODELS.map((m) => [m.model, BRAND_FAM[m.brand]]));
  assert.deepEqual(items('Аккумулятор Samsung A52/A52s (EB-BG781ABY) - Zevo'), [['Samsung A52'], ['Samsung A52s']]);
  assert.deepEqual(mapRow('Аккумулятор Samsung A52/A52s (EB-BG781ABY) - Zevo', 'b', idx, fam).models, ['Samsung Galaxy A52', 'Samsung Galaxy A52s']);
  assert.equal(tier('d', 'Дисплей iPhone 11 - OLED (GX)'), 'copy_oled');
  assert.equal(tier('d', 'Дисплей iPhone 11 - Original (переклей)'), 'orig_reglass');
  assert.equal(tier('b', 'Аккумулятор iPhone 11 - Б/У'), 'copy');
  assert.equal(tier('b', 'Аккумулятор iPhone 11 - Genuine (с верификацией)'), 'verified');
  assert.equal(tier('d', 'Дисплей Samsung A52 - стекло'), 'skip');
  assert.equal(lineKey('Задняя крышка iPhone 14 - черная'), 'Задняя крышка iPhone 14');
  assert.equal(kindOf('Плата зарядки Redmi Note 13 - премиум'), 'p');
  assert.equal(kindOf('Чехол iPhone 11'), null);
  assert.equal(networkOk('Дисплей Samsung A52 4G - OLED', 'Samsung Galaxy A52 5G'), false);
});

await test('проклейка: какая к какому ремонту, набор за штуку, цена клиенту не меняется', () => {
  const { glueType } = RULES;
  assert.equal(glueType('Проклейка дисплея iPhone 15 - Orig'), 'gd');
  assert.equal(glueType('Проклейка экрана Samsung s23'), 'gd');
  assert.equal(glueType('Проклейка задней крышки iPhone 15 - 2UUL (5шт)'), 'gc');
  assert.equal(glueType('Проклейка батареи iPhone 15'), 'gb');
  assert.equal(kindOf('Проклейка батареи iPhone 15'), 'g');
  const names = MODELS.map((m) => m.model);
  const fam = new Map(MODELS.map((m) => [m.model, BRAND_FAM[m.brand]]));
  assert.deepEqual(mapRow('Проклейка дисплея iPhone 11/ 14 - Orig', 'g', siteIndex(names), fam), { models: ['iPhone 11', 'iPhone 14'], tier: 'gd', line: 'Проклейка дисплея iPhone 11/ 14 - Orig' });
  const G = (sup, name, cost, stock, t, models) => ({ sup, name, cost, stock, svc: 'g', tier: t, models, line: name });
  const data = { ...DATA, parts: [...DATA.parts,
    G('P', 'Проклейка батареи iPhone 14', 1.26, 'В наличии', 'gb', ['iPhone 14']),
    G('P', 'Проклейка задней крышки iPhone 14 - 2UUL (5шт)', 10.7, 'В наличии', 'gc', ['iPhone 14']),
    G('E', 'Проклейка задней крышки iPhone 14 - премиум', 4, null, 'gc', ['iPhone 14']),
    G('P', 'Проклейка дисплея iPhone 11 - Orig', 1.42, 'Нет в наличии', 'gd', ['iPhone 11']),
    G('E', 'Проклейка дисплея iPhone 11 - премиум', 4, null, 'gd', ['iPhone 11']),
  ] };
  const pr = new Pricer(data, { year: 2026 });
  const g14 = pr.glueFor('iPhone 14', 'b');
  assert.deepEqual(g14.items.map((x) => [x.type, x.cost]), [['gb', 1.26], ['gc', 2.14]], 'iPhone 14 вскрывается сзади, набор — за штуку');
  assert.equal(g14.total, 3.4);
  assert.deepEqual(pr.glueFor('iPhone 11', 'd').items.map((x) => [x.type, x.cost, x.sup]), [['gd', 4, 'E']], 'в наличии важнее цены');
  assert.deepEqual(pr.glueFor('iPhone 11', 'b').items.map((x) => x.type), ['gd'], 'iPhone 11 вскрывается через дисплей');
  assert.equal(pr.glueFor('Samsung Galaxy A52', 'b').items.length, 0);
  assert.equal(new Pricer(data, { year: 2026, glue_default: 1.5 }).glueFor('Samsung Galaxy A52', 'b').total, 1.5);
  assert.equal(new Pricer(data, { year: 2026, glue: false }).glueFor('iPhone 14', 'b').items.length, 0);
  assert.deepEqual(new Pricer(data, { year: 2026 }).model('iPhone 11').services, new Pricer(DATA, { year: 2026 }).model('iPhone 11').services, 'цена клиенту та же');
});

await test('поиск модели по-русски и с ошибками', () => {
  const s = new ModelSearch(MODELS);
  const top = (q) => (s.find(q)[0] || {}).model;
  assert.equal(top('айфон 11'), 'iPhone 11');
  assert.equal(top('ифон 14'), 'iPhone 14');
  assert.equal(top('самсунг а52'), 'Samsung Galaxy A52');
  assert.equal(top('а52с'), 'Samsung Galaxy A52s');
  assert.equal(top('редми ноут 13'), 'Redmi Note 13');
  assert.equal(top('samsng a52'), 'Samsung Galaxy A52');
});

await test('шифрование: туда и обратно, чужой ключ не подходит', async () => {
  const salt = randomBytes(16);
  const key = await deriveKeyBytes(' Abcd-Efgh ', salt, 1000);
  const env = await seal(encode(DATA), key, salt, 1000);
  assert.deepEqual(decode(await open(env, await deriveKeyBytes('abcd-efgh', salt, 1000))).parts.length, DATA.parts.length);
  await assert.rejects(open(env, await deriveKeyBytes('другой', salt, 1000)));
});

await test('xlsx: чтение и обновление прайса', async () => {
  const sheets = await readXlsx(fs.readFileSync(path.join(ROOT, 'tests/fixtures/price.xlsx')).buffer.slice(0));
  assert.equal(sheets[0].rows[3][1], 'Дисплей iPhone 11 - In-Cell');
  assert.equal(sheets[0].rows[12][1], 'Дисплей iPhone 11 - "OR" <сервис> & ко');
  const cols = detect(sheets, 'P', DATA);
  assert.equal(cols.nameCol, 1);
  assert.equal(cols.priceCol, 2, 'опт, а не розница');
  assert.equal(cols.stockCol, 4);
  const { next, report } = buildImport(DATA, 'P', sheets, cols, '2026-11-05');
  assert.equal(report.file.otherBrands, 1, 'Tecno не наш бренд');
  assert.ok(report.fresh.some((p) => p.name.startsWith('Аккумулятор iPhone 11 - усиленная') && p.tier === 'copy_boost'));
  assert.ok(report.gone.includes('Дисплей iPhone 11 - Incell JK'));
  assert.equal(next.priceDate, '2026-11-05');
  assert.ok(Array.isArray(clientChanges(DATA, next, { year: 2026 })));
  assert.equal(normStock('5'), 'В наличии');
  assert.equal(normStock('Под заказ'), 'Под заказ');
});

await test('заказы: формулы таблицы', () => {
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.deepEqual(computed({ price: 100, part: 40, prepay: 20, status: 'Выдан', issued: '2026-10-12', date: '2026-10-01' }, 3),
    { profit: 60, due: 80, warranty: '2027-01-12', month: '2026-10' });
  assert.equal(computed({ price: null, part: 40, status: 'Отказ', refusal: 'Вернул' }, 3).profit, 0);
  assert.equal(computed({ price: null, part: 40, status: 'Отказ', refusal: 'Осталась у меня' }, 3).profit, -40);
  const s = summary([{ date: '2026-10-01', status: 'Выдан', price: 100, part: 40, issued: '2026-10-02' }], [{ date: '2026-10-03', sum: 15 }], '2026-10', 3);
  assert.deepEqual(s, { taken: 1, issued: 1, revenue: 100, profit: 60, expenses: 15, net: 45 });
});

// --- Скрипт таблицы на макете
await test('Apps Script: ключ, список, запись, повтор, формулы, резервная копия', async () => {
  const { makeBook, loadScript } = await import('./gas-mock.mjs');
  const F = (r) => ({
    13: '=IF(AND(K' + r + '="",L' + r + '=""),"",N(K' + r + ')-IF(AND(Q' + r + '="Отказ",T' + r + '="Вернул"),0,N(L' + r + ')))',
    15: '=IF(K' + r + '="","",K' + r + '-N(N' + r + '))',
  });
  const head = ['№', 'Дата приёма', 'Клиент', 'Телефон', 'Адрес', 'Источник', 'Устройство', 'Модель', 'Неисправность', 'Что сделано', 'Цена для клиента, р.', 'Запчасть, р.', 'Прибыль, р.', 'Предоплата, р.', 'К оплате, р.', 'Срочно', 'Статус', 'Дата выдачи', 'Гарантия до', 'Если отказ: запчасть', 'Комментарий', 'Месяц (служебный)'];
  const cell = (v, f = '') => ({ v, f, fmt: '' });
  const orders = [head.map((x) => cell(x))];
  for (let r = 2; r <= 6; r++) {
    const row = head.map((_, c) => cell('', F(r)[c + 1] || ''));
    if (r === 2) Object.assign(row[0], { v: 1 }), Object.assign(row[1], { v: { date: '2026-10-01' } }), Object.assign(row[7], { v: 'Тестовый телефон' }), Object.assign(row[16], { v: 'Принят' });
    orders.push(row);
  }
  const settings = [[cell('Настройки')], [cell(''), cell(''), cell(''), cell('Источник'), cell('Устройство'), cell(''), cell('Статус'), cell('Что значит'), cell(''), cell('Категория расхода')],
    [cell('Гарантия, мес.'), cell(3), cell(''), cell('Kufar'), cell('Телефон'), cell(''), cell('Обращение'), cell('написал'), cell(''), cell('Инструмент')],
    [cell(''), cell(''), cell(''), cell('Onliner'), cell('ПК'), cell(''), cell('Выдан'), cell('отдал'), cell(''), cell('Реклама')]];
  const book = makeBook({ 'Заказы': orders, 'Расходы': [['Дата', 'Что купил', 'Категория', 'Сумма, р.', 'Где купил', 'Комментарий'].map((x) => cell(x))], 'Настройки': settings });
  const gas = loadScript(path.join(ROOT, 'apps-script/Code.gs'), book, 'test-key');
  assert.equal(gas.post({ op: 'ping', key: 'нет' }).ok, false);
  const ping = gas.post({ op: 'ping', key: 'test-key' }).data;
  assert.deepEqual(ping.lists.sources, ['Kufar', 'Onliner']);
  assert.equal(ping.lists.warrantyMonths, 3);
  const add = { id: 'op1', op: 'addOrder', fields: { date: '2026-10-10', model: '12/13', price: 150, part: 60, status: 'Обращение', phone: '+375 29 111-22-33' } };
  const r1 = gas.post({ op: 'batch', key: 'test-key', ops: [add] }).data[0];
  assert.deepEqual([r1.ok, r1.row, r1.num], [true, 3, 2]);
  const r2 = gas.post({ op: 'batch', key: 'test-key', ops: [add] }).data[0];
  assert.equal(r2.repeat, true, 'повтор не создаёт строку');
  const sh = book.getSheetByName('Заказы');
  assert.equal(sh.getRange(3, 8).getValue(), '12/13', 'текст не превратился в дату');
  assert.equal(sh.getRange(3, 4).getValue(), 375291112233);
  assert.ok(sh.getRange(3, 13).getFormula().startsWith('=IF(AND(K3'), 'формула на месте');
  const list = gas.post({ op: 'list', key: 'test-key' }).data;
  assert.equal(list.orders.length, 2);
  assert.equal(list.orders[1].phone, '375291112233');
  const upd = gas.post({ op: 'batch', key: 'test-key', ops: [{ id: 'op2', op: 'updateOrder', num: 2, row: 99, fields: { status: 'Выдан', issued: '2026-10-11' } }] }).data[0];
  assert.equal(upd.row, 3, 'нашёл заказ по номеру');
  for (let i = 0; i < 5; i++) gas.post({ op: 'batch', key: 'test-key', ops: [{ id: 'b' + i, op: 'addOrder', fields: { model: 'm' + i } }] });
  assert.ok(sh.getRange(8, 13).getFormula().includes('K8'), 'формулы скопированы в новую строку');
  gas.post({ op: 'kvSet', key: 'test-key', name: 'x', value: 'z'.repeat(100000), ts: 5 });
  assert.equal(gas.post({ op: 'kvGet', key: 'test-key', name: 'x' }).data.value.length, 100000);
  // текст, похожий на формулу, остаётся текстом; телефон с ведущим нулём не теряет ноль
  gas.post({ op: 'batch', key: 'test-key', ops: [{ id: 'f1', op: 'addOrder', fields: { model: '+ разбит экран', problem: '=SUM(1)', comment: '-', phone: '0291234567' } }] });
  const fr = list.orders.length + 6;
  const rowF = gas.post({ op: 'list', key: 'test-key' }).data.orders.find((o) => o.model === '+ разбит экран');
  assert.ok(rowF, 'строка с «+» записана текстом');
  assert.equal(rowF.problem, '=SUM(1)');
  assert.equal(rowF.phone, '0291234567');
  // правка только что добавленной строки по ref, пока номер ещё неизвестен приложению
  const addR = gas.post({ op: 'batch', key: 'test-key', ops: [
    { id: 'n1', op: 'addOrder', fields: { model: 'новый' } },
    { id: 'n2', op: 'updateOrder', ref: 'n1', num: null, fields: { status: 'Принят' } },
  ] }).data;
  assert.equal(addR[1].ok, true);
  assert.equal(addR[1].row, addR[0].row, 'правка ушла в ту же строку');
  const noNum = gas.post({ op: 'batch', key: 'test-key', ops: [{ id: 'n3', op: 'updateOrder', num: null, fields: { status: 'Готов' } }] }).data[0];
  assert.equal(noNum.ok, false, 'без номера и ref — ошибка, а не запись в чужую строку');
  // кусок резервной копии, начинающийся с «+», не становится формулой
  gas.post({ op: 'kvSet', key: 'test-key', name: 'p', value: '+abc' + 'q'.repeat(50000), ts: 6 });
  assert.equal(gas.post({ op: 'kvGet', key: 'test-key', name: 'p' }).data.value.slice(0, 4), '+abc');
  assert.ok(fr > 0);
  // заглушка ключа не работает
  const raw = loadScript(path.join(ROOT, 'apps-script/Code.gs'), book, '__KEY__');
  assert.equal(raw.post({ op: 'ping', key: '__KEY__' }).ok, false);
});

await test('очередь приложения: правка заказа во время отправки, из открытой формы, две правки расхода', async () => {
  const { makeBook, loadScript } = await import('./gas-mock.mjs');
  const cell = (v) => ({ v, f: '', fmt: '' });
  const head = ['№', 'Дата приёма', 'Модель', 'Цена для клиента, р.', 'Статус'];
  const book = makeBook({ 'Заказы': [head.map(cell)], 'Расходы': [['Дата', 'Что купил', 'Категория', 'Сумма, р.', 'Где купил'].map(cell)], 'Настройки': [[cell('Настройки')]] });
  const gas = loadScript(path.join(ROOT, 'apps-script/Code.gs'), book, 'k');
  const ls = new Map();
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  let offline = false;
  globalThis.fetch = async (url, o) => {
    await new Promise((r) => setTimeout(r, 15));
    if (offline) throw new TypeError('offline');
    return new Response(gas.ctx.doPost({ postData: { contents: o.body } }).content);
  };
  const { SheetSync } = await import(path.join(ROOT, 'js/sheet.js') + '?q=' + Date.now());
  const s = new SheetSync();
  s.configure({ url: 'https://script.google.com/x', key: 'k' });
  s.add('addOrder', { model: 'Тест' });
  const held = s.orders().find((o) => o.pendingId);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.inflight.size, 1, 'добавление в пути');
  s.update('updateOrder', held, { status: 'Готов' });
  while (s.outbox.length || s.running) await (s.running || s.flush());
  const sh = book.getSheetByName('Заказы');
  assert.deepEqual([sh.getRange(2, 3).getValue(), sh.getRange(2, 5).getValue()], ['Тест', 'Готов']);
  s.update('updateOrder', held, { price: 100 });
  while (s.outbox.length || s.running) await (s.running || s.flush());
  assert.equal(sh.getRange(2, 4).getValue(), 100, 'правка из старой формы ушла в ту же строку');
  assert.equal(s.failed.length, 0);
  s.add('addExpense', { date: '2026-10-10', what: 'Флюс', sum: 10 });
  while (s.outbox.length || s.running) await (s.running || s.flush());
  offline = true;
  s.update('updateExpense', s.expenses()[0], { sum: 12 });
  s.update('updateExpense', s.expenses()[0], { what: 'Флюс RMA' });
  offline = false;
  s.again = true;
  while (s.outbox.length || s.running) await (s.running || s.flush());
  const ex = book.getSheetByName('Расходы');
  assert.deepEqual([ex.getRange(2, 2).getValue(), ex.getRange(2, 4).getValue()], ['Флюс RMA', 12]);
  assert.equal(s.failed.length, 0);
});

// --- Настоящий прайс: только с паролем
if (process.env.FC_PASSWORD) {
  await test('data/prices.enc открывается паролем', async () => {
    const env = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/prices.enc'), 'utf8'));
    const data = decode(await open(env, await deriveKeyBytes(process.env.FC_PASSWORD, fromB64(env.salt), env.iter)));
    assert.ok(data.models.length >= 300 && data.parts.length > 1000);
    const text = siteFile(new Pricer(data), 'проверка');
    assert.ok(!Object.values(data.suppliers).some((s) => text.includes(s.name)), 'в файле для сайта нет поставщиков');
  });
}

console.log('пройдено:', passed, failures.length ? '\nОШИБКИ:\n' + failures.join('\n') : '— всё в порядке');
process.exit(failures.length ? 1 : 0);
