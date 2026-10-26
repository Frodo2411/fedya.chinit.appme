// Проверки без интернета и без настоящих данных: node tests/run.mjs
// С паролем (FC_PASSWORD=… node tests/run.mjs) дополнительно проверяется зашифрованный прайс data/prices.enc.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (f) => import(path.join(ROOT, f));
const { Pricer, clientPrice, riskReserve, comboTotal, workFee, pyRound2, settingsWithDefaults, siteFile, ceilTo, withOwnParts, OWN } = await imp('js/engine.js');
const RULES = await imp('js/rules.js');
const { mapRow, siteIndex, items, tier, lineKey, kindOf, networkOk, BRAND_FAM } = RULES;
const { ModelSearch } = await imp('js/search.js');
const { seal, open, deriveKeyBytes, randomBytes, fromB64 } = await imp('js/crypto.js');
const { decode, encode } = await imp('js/data.js');
const { readXlsx } = await imp('js/xlsx.js');
const { detect, buildImport, clientChanges, normStock } = await imp('js/importer.js');
const { computed, summary, addMonths, isWarranty } = await imp('js/orders.js');

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
  // запас на брак: по умолчанию 0; 10% от детали добавляется к цене по формуле, выше SmartFix не поднимает
  assert.deepEqual(S.risk, { d: 0, c: 0, other: 0 });
  const R = settingsWithDefaults({ year: 2026, risk: { d: 10 } });
  assert.deepEqual(R.risk, { d: 10, c: 0, other: 0 });
  assert.equal(riskReserve(R, 'd', 300), 30);
  assert.equal(riskReserve(R, 'b', 300), 0);
  assert.equal(clientPrice(R, 85, 300, null, riskReserve(R, 'd', 300)).price, 465); // (85+300+30)/0,9 = 461,1 → 465
  assert.equal(clientPrice(R, 85, 300, 400, riskReserve(R, 'd', 300)).price, 395); // не выше SmartFix − 5
  // комплекс: скидка 20% на работу всех ремонтов, кроме самого дорогого по работе, вниз до 5 р.
  assert.equal(S.combo_discount, 20);
  assert.deepEqual(comboTotal(S, [{ price: 440, work: 85 }]), { sum: 440, discount: 0, total: 440 });
  assert.deepEqual(comboTotal(S, [{ price: 120, work: 50 }, { price: 440, work: 85 }]), { sum: 560, discount: 10, total: 550 });
  assert.deepEqual(comboTotal(S, [{ price: 440, work: 85 }, { price: 120, work: 50 }, { price: 90, work: 60 }]), { sum: 650, discount: 20, total: 630 });
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
  // переклей по той же цене, что снятый оригинал, не прячем: деталь дешевле — заработок больше
  const used = pr.partsFor('iPhone 11', 'd', 'orig_used')[0];
  const rg = new Pricer({ ...DATA, parts: [...DATA.parts, { ...used, name: 'Дисплей iPhone 11 - Original (переклей)', tier: 'orig_reglass', line: 'переклей' }] }, { year: 2026 });
  const ro = rg.model('iPhone 11').services.d.opts;
  const reg = ro.find((o) => o.tier === 'orig_reglass');
  assert.equal(reg.price, ro.find((o) => o.tier === 'orig_used').price);
  assert.equal(reg.hidden, false);
  assert.equal(m.services.c.opts.length, 0, 'iPhone 11: крышка только с лазером');
  const c14 = pr.model('iPhone 14').services.c.opts[0];
  assert.equal(c14.cost, 41);
  assert.equal(c14.colours, 2);
});

await test('своя деталь: считается как из прайса, без правил про лазер и брак, попадает на сайт', () => {
  const own = [
    { id: 'o1', model: 'iPhone 11', svc: 'c', tier: 'copy', cost: 20, name: 'стекло с лазером, б/у пресс', date: '2026-10-26' },
    { id: 'o2', model: 'Samsung Galaxy A52', svc: 'c', tier: 'orig_used', cost: 30, name: '', date: '2026-10-26' },
    { id: 'o3', model: 'Samsung Galaxy A52', svc: 'd', tier: 'copy_oled', cost: 0, name: 'ноль не считаем', date: '2026-10-26' },
  ];
  const data = withOwnParts(DATA, own);
  assert.equal(DATA.parts.length, 10, 'исходные данные не меняются');
  assert.equal(withOwnParts(DATA, []), DATA);
  const pr = new Pricer(data, { year: 2026 });
  const c11 = pr.model('iPhone 11').services.c.opts;
  assert.equal(c11.length, 1, 'iPhone 11: своя крышка видна, хоть модель с лазером');
  assert.deepEqual([c11[0].sup, c11[0].cost, c11[0].ownId, c11[0].part], [OWN, 20, 'o1', 'стекло с лазером, б/у пресс']);
  assert.equal(c11[0].price, clientPrice(pr.S, workFee(pr.S, 'c', MODELS[0]), 20, null).price);
  assert.equal(pr.model('iPhone 11').services.d.opts[0].ownId, null);
  const a52 = pr.model('Samsung Galaxy A52').services;
  assert.equal(a52.c.opts[0].tier, 'orig_used');
  assert.equal(a52.c.opts[0].part, 'цена вписана вручную');
  assert.equal(a52.d.opts.length, 0, 'деталь за 0 р. не берём');
  assert.equal(pr.data.suppliers[OWN].name, 'Своя деталь');
  const text = siteFile(pr, 'Октябрь 2026');
  assert.ok(text.includes('"c":[["copy",' + c11[0].price + ']]'));
  assert.ok(!text.includes('Своя деталь') && !text.includes('пресс'));
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
  assert.deepEqual(pr.glueFor('iPhone 11', ['d', 'b']).items.map((x) => x.type), ['gd'], 'комплекс: проклейка дисплея одна на дисплей и батарею');
  assert.equal(pr.glueFor('iPhone 14', ['c', 'b']).total, 3.4, 'комплекс: крышка и батарея — одна проклейка крышки');
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

await test('Google Pixel: модели приложения, поиск, разбор названий, загрузка прайса, проклейка, не на сайт', async () => {
  const { APP_ONLY } = await imp('js/data.js');
  const data = decode(encode(DATA));
  assert.ok(data.models.some((m) => m.model === 'Google Pixel 6' && m.brand === 'Google' && m.year === 2021), 'Pixel есть среди моделей');
  assert.equal(decode(encode(data)).models.length, data.models.length, 'второй раз не добавляются');
  const s = new ModelSearch(data.models);
  const top = (q) => (s.find(q)[0] || {}).model;
  assert.equal(top('pixel 6'), 'Google Pixel 6');
  assert.equal(top('пиксель 6'), 'Google Pixel 6');
  assert.equal(top('гугл пиксель 6 про'), 'Google Pixel 6 Pro');
  assert.equal(top('пиксель 6а'), 'Google Pixel 6a');
  assert.equal(top('pixel 9 pro xl'), 'Google Pixel 9 Pro XL');
  const names = data.models.map((m) => m.model);
  const idx = siteIndex(names);
  const fam = new Map(data.models.map((m) => [m.model, BRAND_FAM[m.brand]]));
  const map = (n, k) => mapRow(n, k, idx, fam);
  assert.deepEqual(map('Аккумулятор Google Pixel 6 (GMSB3)', 'b').models, ['Google Pixel 6']);
  assert.deepEqual(map('Аккумулятор для Pixel 6 Pro - G63QN', 'b').models, ['Google Pixel 6 Pro']);
  assert.deepEqual(map('Дисплей Google Pixel 6 (в рамке) - OLED', 'd'), { models: ['Google Pixel 6'], tier: 'copy_oled', line: 'Дисплей Google Pixel 6 (в рамке) - OLED' });
  assert.equal(map('Дисплей Google Pixel 6 (в рамке, со сканером) - Original', 'd').tier, 'orig_new');
  assert.deepEqual(map('Дисплей Google Pixel 7/7 Pro - стекло', 'd').models, []);
  assert.deepEqual(map('Задняя крышка Google Pixel 7/8 - черная', 'c').models, ['Google Pixel 7', 'Google Pixel 8']);
  assert.deepEqual(map('Плата зарядки Pixel 4a/4a 5G', 'p').models, ['Google Pixel 4a', 'Google Pixel 4a 5G']);
  assert.deepEqual(map('Дисплей Google Pixel 4a 5G - OLED', 'd').models, ['Google Pixel 4a 5G']);
  assert.deepEqual(map('Проклейка дисплея Google Pixel 6', 'g').models, ['Google Pixel 6']);
  // загрузка прайса: новые строки Pixel и знакомая строка без модели размечаются
  const sheets = [{ name: 'Прайс', rows: [
    ['Наименование', 'Цена', 'Наличие'],
    ['Дисплей iPhone 11 - Incell JK', 38, 'В наличии'],
    ['Аккумулятор Google Pixel 6 (GMSB3)', 31.5, 'В наличии'],
    ['Дисплей Google Pixel 6 (в рамке) - OLED', 104, 'В наличии'],
    ['Дисплей Google Pixel 6 (в рамке, со сканером) - Original', 240, 'В наличии'],
  ] }];
  const before = { ...data, parts: [...data.parts, P('P', 'Аккумулятор Google Pixel 6 (GMSB3)', 30, 'В наличии', 'b', 'skip', [])] };
  const cols = detect(sheets, 'P', before);
  const { next, report } = buildImport(before, 'P', sheets, cols, '2026-11-05');
  assert.equal(report.file.otherBrands, 0);
  assert.deepEqual(report.fresh.map((p) => [p.name, p.tier, p.models.join()]), [
    ['Аккумулятор Google Pixel 6 (GMSB3)', 'copy', 'Google Pixel 6'],
    ['Дисплей Google Pixel 6 (в рамке) - OLED', 'copy_oled', 'Google Pixel 6'],
    ['Дисплей Google Pixel 6 (в рамке, со сканером) - Original', 'orig_new', 'Google Pixel 6'],
  ]);
  assert.equal(next.parts.filter((p) => p.name === 'Аккумулятор Google Pixel 6 (GMSB3)').length, 1, 'без дублей');
  const pr = new Pricer(decode(encode(next)), { year: 2026 });
  const px = pr.model('Google Pixel 6');
  assert.deepEqual(px.services.b.opts.map((o) => [o.tier, o.cost]), [['copy', 31.5]]);
  assert.deepEqual(px.services.d.opts.map((o) => [o.tier, o.cost]), [['copy_oled', 104], ['orig_new', 240]]);
  assert.ok(clientChanges(before, next, { year: 2026 }).some((c) => c.model === 'Google Pixel 6' && c.old === null));
  // проклейка: Pixel 6 вскрывается через дисплей, Pixel 4 и 10 — сзади
  assert.deepEqual(pr.glueTypes('Google Pixel 6', 'b'), ['gb', 'gd']);
  assert.deepEqual(pr.glueTypes('Google Pixel 4', 'b'), ['gb', 'gc']);
  assert.deepEqual(pr.glueTypes('Google Pixel 10 Pro', 'p'), ['gc']);
  assert.deepEqual(pr.glueTypes('Samsung Galaxy A52', 'b'), ['gb', 'gc']);
  // в файл для сайта модель только для приложения попадает, если у неё есть цены
  const text = siteFile(pr, 'Ноябрь 2026');
  assert.ok(text.includes('"Google Pixel 6"') && !text.includes('"Google Pixel 8"'));
  assert.ok(APP_ONLY.has('Google Pixel 6'));
});

await test('другие бренды: семьи, другие названия, поиск, знакомая позиция получает модель приложения', async () => {
  const { families: fams } = RULES;
  assert.deepEqual([...fams('Дисплей TECNO Spark 10 Pro - OLED')], ['tecno']);
  assert.deepEqual([...fams('Аккумулятор OnePlus Nord CE 3 Lite')], ['oneplus']);
  assert.deepEqual([...fams('Дисплей ZTE Nubia Neo 2')], ['zte']);
  const models = [
    { brand: 'Tecno', model: 'Tecno Spark 10' }, { brand: 'Tecno', model: 'Tecno Spark 10 Pro' }, { brand: 'Tecno', model: 'Tecno Spark 20' },
    { brand: 'Infinix', model: 'Infinix Hot 30i' }, { brand: 'Nothing', model: 'Nothing CMF Phone 1' }, { brand: 'OnePlus', model: 'OnePlus Nord CE 3 Lite' },
  ];
  const idx = siteIndex(models.map((m) => m.model), new Map([['Nothing Phone 1 CMF', 'Nothing CMF Phone 1']]));
  const fam = new Map(models.map((m) => [m.model, BRAND_FAM[m.brand]]));
  assert.deepEqual(mapRow('Аккумулятор Tecno Spark 10 4G/10 Pro/20 (BL-49ST)', 'b', idx, fam).models, ['Tecno Spark 10', 'Tecno Spark 10 Pro', 'Tecno Spark 20']);
  assert.deepEqual(mapRow('Дисплей Nothing Phone 1 CMF', 'd', idx, fam).models, ['Nothing CMF Phone 1'], 'другое название поставщика');
  assert.deepEqual(mapRow('Дисплей OnePlus Nord CE3 Lite 5G - OR', 'd', idx, fam).models, ['OnePlus Nord CE 3 Lite']);
  const s = new ModelSearch(models);
  const top = (q) => (s.find(q)[0] || {}).model;
  assert.equal(top('техно спарк 10 про'), 'Tecno Spark 10 Pro');
  assert.equal(top('инфиникс хот 30и'), 'Infinix Hot 30i');
  assert.equal(top('ванплас норд се 3 лайт'), 'OnePlus Nord CE 3 Lite');
  // знакомая позиция с моделью сайта получает и модель приложения, модель сайта остаётся
  const data = decode(encode(DATA));
  const row = 'Проклейка дисплея iPhone 11/Pixel 6 - премиум';
  const before = { ...data, parts: [...data.parts, { sup: 'E', name: row, cost: 3, stock: null, svc: 'g', tier: 'gd', models: ['iPhone 11'], line: row }] };
  const sheets = [{ name: 'Прайс', rows: [['Наименование', 'Цена'], ...DATA.parts.filter((p) => p.sup === 'E').map((p) => [p.name, p.cost]), [row, 3]] }];
  const { next, report } = buildImport(before, 'E', sheets, detect(sheets, 'E', before), '2026-11-05');
  assert.equal(report.extended, 1);
  assert.deepEqual(next.parts.find((p) => p.name === row).models, ['iPhone 11', 'Google Pixel 6']);
  assert.equal(report.fresh.length, 0, 'знакомая позиция не попадает в новые');
});

await test('ремонты по любой детали: вид, вариант, модель, цена, проклейка, не на сайт', async () => {
  const kinds = {
    'Камера Huawei Honor 10 Lite (13 MP) - задняя': 'cr', 'Камера iPhone 11 - передняя (премиум)': 'cf', 'Задняя камера iPhone 11 - Orig': 'cr',
    'Передняя сборка/ фронтальная камера iPhone 14 - Orig (снятая с iCloud)': 'cf', 'Динамик полифонический iPhone 11 - (buzzer)': 'ls',
    'Динамик слуховой iPhone 11 - (speaker)': 'es', 'Шлейф iPhone 11 - сканер отпечатка (черный)': 'fp', 'Шлейф Infinix Hot 12 Play NFC - кнопки громкости/включения': 'bt',
    'Шлейф Samsung A52 - межплатный': 'fx', 'Шлейф на вспышку iPhone 11 - Премиум': 'fo', 'Корпус iPhone 11 (1 Sim) - белый (премиум)': 'hs',
    'Средняя часть Samsung A52 - черная': 'hs', 'Стекло камеры iPhone 11 - черное': 'cg', 'Сим лоток iPhone 11 - белый': 'sim', 'Тачскрин Samsung A52': 'tc',
    'Стекло для переклейки + OCA iPhone 11 - G-oca pro': 'gl', 'Шлейф зарядки iPhone 11': 'p', 'Нижняя плата Samsung A52': 'p',
    'Шлейф JCID для восстановления Face iD (iPhone 11)': null, 'Защитное стекло iPhone 11': null, 'Рамка дисплея iPhone 11': null,
  };
  for (const [n, k] of Object.entries(kinds)) assert.equal(kindOf(n), k, n);
  assert.equal(tier('cf', 'Передняя сборка/ фронтальная камера iPhone 14 - Orig (снятая с iCloud)'), 'orig_used');
  assert.equal(tier('cr', 'Задняя камера iPhone 11 - Orig'), 'orig_new');
  assert.equal(tier('gl', 'Стекло переклей Samsung A52 с OCA пленкой - OR'), 'copy', 'стекло под переклейку не бывает оригиналом');
  const names = MODELS.map((m) => m.model);
  const idx = siteIndex(names);
  const fam = new Map(MODELS.map((m) => [m.model, BRAND_FAM[m.brand]]));
  assert.deepEqual(mapRow('Шлейф на вспышку iPhone 11 - Премиум', 'fo', idx, fam).models, ['iPhone 11']);
  assert.deepEqual(mapRow('Сим лоток Samsung A52/A52s - черный', 'sim', idx, fam).models, ['Samsung Galaxy A52', 'Samsung Galaxy A52s']);
  assert.deepEqual(mapRow('Корпус iPhone 14 e sim + sim - черный (премиум)', 'hs', idx, fam).models, ['iPhone 14']);
  // цена: две задние камеры — основная (дороже) по умолчанию; ремонт без детали не появляется
  const X = (sup, name, cost, svc, t, models) => ({ sup, name, cost, stock: null, svc, tier: t, models, line: name });
  const data = { ...DATA, parts: [...DATA.parts,
    X('E', 'Камера Samsung A52 (64 MP) - задняя', 30, 'cr', 'copy', ['Samsung Galaxy A52']),
    X('E', 'Камера Samsung A52 (5 MP) - задняя', 8, 'cr', 'copy', ['Samsung Galaxy A52']),
    X('E', 'Сим лоток Samsung A52 - черный', 4, 'sim', 'copy', ['Samsung Galaxy A52']),
  ] };
  const pr = new Pricer(data, { year: 2026 });
  const a52 = pr.model('Samsung Galaxy A52');
  assert.equal(a52.services.cr.opts[0].cost, 30, 'основная камера, а не самая дешёвая');
  assert.equal(a52.services.cr.opts[0].work, 60, '45 × 1,3 = 58,5 → 60');
  assert.equal(a52.services.cr.opts[0].price, ceilTo((60 + 30) / 0.9, 5));
  assert.equal(a52.services.sim.opts[0].work, 15, 'у SIM-лотка свой минимум 15, а не общий 50');
  assert.equal(a52.services.sim.opts[0].price, 25);
  assert.equal(new Pricer(data, { year: 2026, min_svc: { sim: 50 } }).model('Samsung Galaxy A52').services.sim.opts[0].work, 50, 'свой минимум меняется в настройках');
  assert.equal(settingsWithDefaults({ min_svc: { cg: 30 } }).min_svc.sim, 15, 'остальные минимумы остаются');
  assert.equal(new Pricer(data, { year: 2026, min_svc: { sim: null } }).model('Samsung Galaxy A52').services.sim.opts[0].work, 50, 'очищенный минимум — общий');
  // задняя камера: основной модуль каждого поставщика, между поставщиками — дешевле и в наличии
  const cam = (rows) => new Pricer({ ...DATA, parts: [...DATA.parts, ...rows] }, { year: 2026 }).model('Samsung Galaxy A52').services.cr.opts[0];
  const Y = (sup, name, cost, stock) => ({ sup, name, cost, stock, svc: 'cr', tier: 'copy', models: ['Samsung Galaxy A52'], line: name });
  const same = cam([Y('P', 'Камера Samsung A52 (64 MP) - задняя', 40, 'В наличии'), Y('E', 'Камера Samsung A52 (64 MP) - задняя', 30, null)]);
  assert.deepEqual([same.sup, same.cost, same.alt.sup], ['E', 30, 'P'], 'тот же модуль — у того, кто дешевле');
  const stock = cam([Y('P', 'Камера Samsung A52 (64 MP) - задняя', 40, 'Нет в наличии'), Y('P', 'Камера Samsung A52 (5 MP) - задняя', 8, 'В наличии')]);
  assert.equal(stock.cost, 40, 'основной модуль, даже если его нет в наличии, а не макро в наличии');
  assert.equal(a52.services.fp.opts.length, 0);
  assert.deepEqual(pr.glueTypes('Samsung Galaxy A52', 'cr'), ['gc']);
  assert.deepEqual(pr.glueTypes('iPhone 11', 'es'), ['gd']);
  assert.deepEqual(pr.glueTypes('iPhone 14', 'hs'), ['gd', 'gb', 'gc']);
  assert.deepEqual(pr.glueTypes('iPhone 14', 'sim'), []);
  const text = siteFile(pr, 'Ноябрь 2026');
  const a52site = JSON.parse(text.split('\n').find((l) => l.includes('"Samsung Galaxy A52"')).replace(/,$/, ''));
  assert.deepEqual(Object.keys(a52site[2]), ['b', 'cr', 'sim'], 'новые ремонты — и на сайте');
});

await test('особенности записи у поставщиков: цвет, тире без пробела, код модели, другие названия', async () => {
  const { APP_ALIASES } = await imp('js/data.js');
  const models = [
    { brand: 'iPhone', model: 'iPhone 6' }, { brand: 'iPhone', model: 'iPhone 12' }, { brand: 'iPhone', model: 'iPhone 12 Pro' },
    { brand: 'iPhone', model: 'iPhone 15 Pro Max' }, { brand: 'iPhone', model: 'iPhone SE 2020' }, { brand: 'Huawei', model: 'Huawei P20' },
    { brand: 'Poco', model: 'Poco F1' }, { brand: 'Samsung', model: 'Samsung Galaxy A35' }, { brand: 'Samsung', model: 'Samsung Galaxy A34' },
    { brand: 'Samsung', model: 'Samsung Galaxy Z Flip5' }, { brand: 'Xiaomi', model: 'Xiaomi Mi 8 Lite' },
  ];
  const idx = siteIndex(models.map((m) => m.model), APP_ALIASES);
  const fam = new Map(models.map((m) => [m.model, BRAND_FAM[m.brand]]));
  const map = (n) => mapRow(n, kindOf(n), idx, fam).models;
  assert.deepEqual(map('Дисплей iPhone 6 белый - Премиум'), ['iPhone 6'], 'цвет без тире');
  assert.deepEqual(map('Аккумулятор iPhone 15 Pro Max- DEJI (с верификацией, усиленная)'), ['iPhone 15 Pro Max'], 'тире без пробела');
  assert.deepEqual(map('Дисплей iPhone 12/ 12 Pro- JCID (LTPS, HD, 60Гц)'), ['iPhone 12', 'iPhone 12 Pro']);
  assert.deepEqual(map('Плата зарядки шлейф Huawei P20 - премиум'), ['Huawei P20'], 'русское слово перед моделью');
  assert.deepEqual(map('Плата зарядки Xiaomi Mi 8 Lite с разъемом зарядки и микрофоном'), ['Xiaomi Mi 8 Lite']);
  assert.deepEqual(map('Дисплей Samsung A34 5G (A346B) In-Cell (черная рама)'), ['Samsung Galaxy A34'], 'вариант детали в названии модели');
  assert.deepEqual(map('Аккумулятор Xiaomi Pocophone F1 (BM4E) - JCID'), ['Poco F1'], 'другое название модели сайта');
  assert.deepEqual(map('Аккумулятор iPhone SE 2 2020 - JCID (усиленная)'), ['iPhone SE 2020']);
  assert.deepEqual(map('Плата зарядки Samsung A356B - Премиум'), ['Samsung Galaxy A35'], 'код Samsung');
  assert.deepEqual(map('Дисплей Samsung Z Flip5 (F731B) внешний 3.4" - OR (SP) (черная рама)'), [], 'внешний экран раскладушки — не дисплей');
  assert.equal(kindOf('Шлейф Xiaomi Poco F3/Mi 11i - разъем SIM'), 'fo', 'шлейф SIM — не разъём зарядки');
  assert.equal(kindOf('Шлейф зарядки iPhone 17 Pro - системный разъем/ микрофон - черный (e sim)'), 'p');
});

await test('список моделей приложения: без повторов, бренды знакомы, годы правдоподобные', async () => {
  const { APP_MODELS, SITE_ALIASES } = await imp('js/models-app.js');
  const { normModel } = RULES;
  assert.ok(APP_MODELS.length > 700);
  const keys = new Map();
  for (const [brand, model, year, aka] of APP_MODELS) {
    assert.ok(BRAND_FAM[brand], 'бренд знаком разбору: ' + brand);
    assert.ok(Number.isInteger(year) && year >= 2010 && year <= 2026, 'год ' + model + ': ' + year);
    const k = normModel(model);
    assert.ok(!keys.has(k), 'одна модель дважды: ' + model + ' и ' + keys.get(k));
    keys.set(k, model);
    for (const a of aka || []) assert.ok(typeof a === 'string' && a.length > 3, 'другое название ' + model);
  }
  for (const [a, m] of SITE_ALIASES) assert.ok(a && m && !keys.has(normModel(m)), 'другое название сайта ведёт на модель сайта: ' + a);
});

await test('после проверки: шлейф SIM в старых данных, «+ OCA», серия у части, поиск, год модели', async () => {
  const { APP_ALIASES, APP_MODELS: _ } = await imp('js/data.js');
  // знакомая позиция с прежним видом «разъём зарядки» размечается заново как другой шлейф
  const sim = 'Шлейф iPhone 14 - на разъем SIM (премиум)';
  const before = { ...DATA, parts: [...DATA.parts, P('E', sim, 7, null, 'p', 'copy', ['iPhone 14'])] };
  const sheets = [{ name: 'Прайс', rows: [['Наименование', 'Цена'], ...DATA.parts.filter((p) => p.sup === 'E').map((p) => [p.name, p.cost]), [sim, 7]] }];
  const { next } = buildImport(before, 'E', sheets, detect(sheets, 'E', before), '2026-11-05');
  assert.deepEqual(next.parts.filter((p) => p.name === sim).map((p) => [p.svc, p.models.join()]), [['fo', 'iPhone 14']]);
  assert.equal(kindOf('Шлейф Xiaomi Mi 11 Lite/Mi 11 Lite 5G/11 Lite 5G NE на разъем SIM/MMC'), 'fo');
  // «+ OCA» после модели у стекла под переклейку и тачскрина
  const models = [{ brand: 'Samsung', model: 'Samsung Galaxy A56' }, { brand: 'iPhone', model: 'iPhone 13' }, { brand: 'Honor', model: 'Honor 50' }, { brand: 'Huawei', model: 'Huawei nova 9' },
    { brand: 'Infinix', model: 'Infinix Note 10 Pro' }, { brand: 'Infinix', model: 'Infinix Note 11 Pro' }, { brand: 'Infinix', model: 'Infinix Hot 30' },
    { brand: 'Infinix', model: 'Infinix Hot 40' }, { brand: 'Infinix', model: 'Infinix Hot 40 Pro' }, { brand: 'Infinix', model: 'Infinix Hot 50 Pro' },
    { brand: 'Infinix', model: 'Infinix Note 40' }, { brand: 'Infinix', model: 'Infinix Note 40 Pro' }, { brand: 'Infinix', model: 'Infinix Note 50 Pro' },
    { brand: 'Tecno', model: 'Tecno Pova 2' }, { brand: 'Tecno', model: 'Tecno Pova 8' }, { brand: 'Infinix', model: 'Infinix Note 7' }, { brand: 'Infinix', model: 'Infinix Note 8' }];
  const idx = siteIndex(models.map((m) => m.model), APP_ALIASES);
  const fam = new Map(models.map((m) => [m.model, BRAND_FAM[m.brand]]));
  const map = (n) => mapRow(n, kindOf(n), idx, fam).models;
  assert.deepEqual(map('Стекло для переклейки Samsung A56 + OCA - G-oca pro'), ['Samsung Galaxy A56']);
  assert.deepEqual(map('Тачскрин iPhone 13 + OCA - Orig (G-oca pro)'), ['iPhone 13']);
  assert.deepEqual(map('Стекло для переклейки Huawei Honor 50/ Nova 9 + OCA - (G-oca pro)'), ['Honor 50', 'Huawei nova 9']);
  // своя серия у части: «Hot 30 4G/40» после «Note 10 Pro» — это Hot 40, а не Note 40
  assert.deepEqual(map('Аккумулятор Infinix Note 10 Pro/11 Pro/Hot 30 4G/40/40 Pro/50 Pro (BL-49JX)'),
    ['Infinix Note 10 Pro', 'Infinix Note 11 Pro', 'Infinix Hot 30', 'Infinix Hot 40', 'Infinix Hot 40 Pro', 'Infinix Hot 50 Pro']);
  // голый номер берёт бренд ближайшей части: «Infinix Note 7/8», а не Tecno Pova 8
  assert.deepEqual(map('Шлейф Tecno Pova 2/Infinix Note 7/8 - сканер отпечатка'), ['Tecno Pova 2', 'Infinix Note 7', 'Infinix Note 8']);
  // поиск: модель сайта выше модели приложения с тем же номером
  const s = new ModelSearch(decode(encode({ ...DATA, models: [...DATA.models, { brand: 'Samsung', model: 'Samsung Galaxy S23' }, { brand: 'Samsung', model: 'Samsung Galaxy A31' }] })).models);
  assert.equal((s.find('с23')[0] || {}).model, 'Samsung Galaxy S23');
  assert.equal((s.find('а31')[0] || {}).model, 'Samsung Galaxy A31');
  // год модели приложения — из списка, даже если пакет сохранён со старым годом
  const old = encode(decode(encode(DATA)));
  old.models = old.models.map((m) => (m[1] === 'Google Pixel 8a' ? [m[0], m[1], 2019, null, null, null] : m));
  assert.equal(decode(old).models.find((m) => m.model === 'Google Pixel 8a').year, 2024);
});

await test('новый поставщик: .xls, цены в долларах, наличие по магазинам, названия «LCD для iPhone11»', async () => {
  const { readTable } = await imp('js/xlsx.js');
  const { withRate } = await imp('js/importer.js');
  // .xls читается так же, как .xlsx
  const file = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
  const a = await readTable(file('tests/fixtures/price.xls'));
  const b = await readTable(file('tests/fixtures/price.xlsx'));
  assert.deepEqual(a[0].rows.map((r) => [...r].map((v) => v ?? null)), b[0].rows.map((r) => [...r].map((v) => v ?? null)));
  // обрезанный, с паролем, Excel 95 — понятный отказ, а не полпрайса и не «Cannot read properties»
  const xls = fs.readFileSync(path.join(ROOT, 'tests/fixtures/price.xls'));
  const read = (buf) => readTable({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  for (const n of [600, Math.floor(xls.length / 2), xls.length - 100]) await assert.rejects(read(xls.subarray(0, n)), /повреждён или скачан не полностью/);
  const bof = xls.indexOf(Buffer.from([0x09, 0x08, 0x10, 0x00, 0x00, 0x06]));
  const pw = Buffer.from(xls);
  pw[bof + 20] = 0x2f; pw[bof + 21] = 0; // запись после BOF становится FILEPASS
  await assert.rejects(read(pw), /защищён паролем/);
  const x95 = Buffer.from(xls);
  x95[bof + 5] = 0x05; // версия BOF 0x0500
  await assert.rejects(read(x95), /Excel 5\.0\/95/);
  // сбой разбора внутри листа (ссылка за таблицу строк) — отказ, а не лист без названий деталей
  const lsst = xls.indexOf(Buffer.from([0xfd, 0x00, 0x0a, 0x00]), bof);
  const badIdx = Buffer.from(xls);
  badIdx.fill(0xff, lsst + 10, lsst + 14);
  await assert.rejects(read(badIdx), /повреждён/);
  // .xlsx с испорченным байтом в сжатом листе — тоже отказ (сверка CRC-32)
  const xlsx = fs.readFileSync(path.join(ROOT, 'tests/fixtures/price.xlsx'));
  const sheetAt = xlsx.indexOf(Buffer.from('xl/worksheets/sheet1.xml')) + 40;
  const flip = Buffer.from(xlsx);
  flip[sheetAt] ^= 0x10;
  await assert.rejects(read(flip), /повреждён/);
  // названия в стиле нового поставщика
  const models = ['iPhone 5', 'iPhone 5c', 'iPhone 5s', 'iPhone 6', 'iPhone 6 Plus', 'iPhone 6s', 'iPhone 6s Plus', 'iPhone 7', 'iPhone 7 Plus', 'iPhone 8', 'iPhone 8 Plus',
    'iPhone 11', 'iPhone 11 Pro', 'iPhone 12', 'iPhone 12 mini', 'iPhone 12 Pro', 'iPhone XS', 'iPhone SE 2020', 'iPhone 14'].map((m) => ({ brand: 'iPhone', model: m }));
  const idx = siteIndex(models.map((m) => m.model));
  const fam = new Map(models.map((m) => [m.model, BRAND_FAM[m.brand]]));
  const map = (n) => { const k = kindOf(n); const r = mapRow(n, k, idx, fam); return [k, r.tier, r.models.join()]; };
  assert.deepEqual(map('LCD для iPhone11 (in-cell) JK'), ['d', 'copy_lcd', 'iPhone 11']);
  assert.deepEqual(map('LCD для iPhone11 Pro (матрица orig)'), ['d', 'orig_new', 'iPhone 11 Pro']);
  assert.deepEqual(map('LCD для iPhone12 mini (матрица orig) 60Гц'), ['d', 'orig_new', 'iPhone 12 mini']);
  assert.deepEqual(map('LCD для iPhone12/12 Pro (Hard Touch) DD 60Гц'), ['d', 'copy_oled', 'iPhone 12,iPhone 12 Pro']);
  assert.deepEqual(map('Buzzer для iPhone11'), ['ls', 'copy', 'iPhone 11']);
  assert.deepEqual(map('Вибро для iPhoneХS (610-00237)'), ['vb', 'copy', 'iPhone XS'], 'русская Х в модели');
  assert.deepEqual(map('Лоток для сим-карты для iPhone12 ФИОЛЕТОВЫЙ'), ['sim', 'copy', 'iPhone 12']);
  assert.deepEqual(map('Шлейф для iPhone11 CHARGE CONN БЕЛЫЙ (821-02037-A)'), ['p', 'copy', 'iPhone 11']);
  assert.deepEqual(map('Шлейф для iPhoneSE2020 CHARGE CONN ЧЕРНЫЙ'), ['p', 'copy', 'iPhone SE 2020']);
  assert.deepEqual(map('Шлейф для iPhone14 Power On/Off'), ['bt', 'copy', 'iPhone 14']);
  assert.deepEqual(map('Шлейф для iPhone12 Pro на сканер лидар (Lidar) (821-02641-A)'), ['fo', 'copy', 'iPhone 12 Pro']);
  assert.deepEqual(map('Заднее стекло для iPhone14 + стекло камеры + магнит MagSafe внутрикорпусной, ФИОЛЕТОВЫЙ'), ['c', 'copy', 'iPhone 14']);
  assert.deepEqual(map('Задняя крышка для iPhone11 Pro + стекло ЗЕЛЕНЫЙ (СЕ) - ПРЕМИУМ'), ['hs', 'copy', 'iPhone 11 Pro'], 'крышка + стекло — корпус');
  assert.deepEqual(map('Аккумулятор для iPhone11 3500 mAh усиленный iParts (гарантия 1 год) ic orig (100%)'), ['b', 'copy_boost', 'iPhone 11']);
  assert.equal(kindOf('Шлейф для прибора JC Receiver FPC для iPhone11'), null, 'инструмент — не ремонт');
  assert.equal(kindOf('Кольцо камеры для iPhone11, БЕЛЫЙ'), null, 'кольцо без стекла — не ремонт');
  assert.equal(kindOf('Кнопка Home для iPhone5 ЧЕРНЫЙ'), null, 'колпачок кнопки — не шлейф кнопок');
  assert.deepEqual(map('Кольцо камеры со стеклом для iPhone6/6S Plus, ЗОЛОТО'), ['cg', 'copy', 'iPhone 6 Plus,iPhone 6s Plus'], '6/6S Plus — оба Plus');
  assert.deepEqual(map('Кольцо камеры со стеклом для iPhone6/6S (4.7\')'), ['cg', 'copy', 'iPhone 6,iPhone 6s']);
  assert.deepEqual(map('Шлейф для iPhone7 (4,7")/8 (4,7")/7 (5,5")/8 (5,5") кнопка Home (сенсорное нажатие) ЧЕРНЫЙ'), ['bt', 'copy', 'iPhone 7,iPhone 8,iPhone 7 Plus,iPhone 8 Plus'], '5,5" — Plus');
  assert.deepEqual(map('Стекло двойной камеры для iPhone7 Plus'), ['cg', 'copy', 'iPhone 7 Plus']);
  assert.deepEqual(map('LCD для iPhone5 (матрица ориг) БЕЛЫЙ'), ['d', 'orig_new', 'iPhone 5'], '«ориг» по-русски');
  assert.deepEqual(map('Шлейф для iPhone5S CHARGE CONN оrig БЕЛЫЙ (821-1667-A)'), ['p', 'orig_new', 'iPhone 5s'], '«оrig» с русской «о»');
  assert.deepEqual(map('Задняя крышка для iPhone11 Pro + стекло ориг ЗЕЛЕНЫЙ (СЕ) - ПРЕМИУМ'), ['hs', 'copy', 'iPhone 11 Pro'], 'ориг — про стекло, крышка — копия');
  assert.deepEqual(map('Шлейф для iPhone5C for Sensor Backlight + камера (821-1613-A)'), ['cf', 'copy', 'iPhone 5c'], 'датчик с передней камерой');
  // цвета одной детали — одна линия: «ПОЛУНОЧНЫЙ СИНИЙ», «ТЕМНО-СЕРЫЙ», номер цвета «№3», «ЧЁРНЫЙ»
  const same = (a, b) => assert.equal(lineKey(a), lineKey(b), a + ' / ' + b);
  same('Заднее стекло для iPhone14 + стекло камеры + магнит MagSafe внутрикорпусной, ПОЛУНОЧНЫЙ СИНИЙ', 'Заднее стекло для iPhone14 + стекло камеры + магнит MagSafe внутрикорпусной, ФИОЛЕТОВЫЙ');
  same('Задняя крышка для iPhone16 Pro Max + стекло ЧЕРНЫЙ (СЕ) №1 - ПРЕМИУМ', 'Задняя крышка для iPhone16 Pro Max + стекло БЕЛЫЙ (СЕ) №3 - ПРЕМИУМ');
  same('Задняя крышка для iPhone 6 (4,7") в сборе (со шлейфами) ТЕМНО-СЕРЫЙ hi-copy', 'Задняя крышка для iPhone 6 (4,7") в сборе (со шлейфами) ЗОЛОТО hi-copy');
  same('Шлейф для iPhone15 Pro Max CHARGE CONN НАТУРАЛЬНЫЙ', 'Шлейф для iPhone15 Pro Max CHARGE CONN ЧЁРНЫЙ');
  same('Дисплей Samsung A55 5G (A556E) - OR (SP) (лавандовая рама)', 'Дисплей Samsung A55 5G (A556E) - OR (SP) (черная рама)');
  same('Задняя крышка iPhone 16 Pro - натуральный титан, серая, Natural Titanium (премиум)', 'Задняя крышка iPhone 16 Pro - черный титан (премиум)');
  assert.notEqual(lineKey('Задняя крышка для iPhone 6 (4,7") в сборе (со шлейфами) ЗОЛОТО hi-copy'), lineKey('Задняя крышка для iPhone 6 (4,7") в сборе (со шлейфами) ЗОЛОТО'));
  // поставщик в долларах: курс, наличие «+» по складу и магазинам, другой город не считается
  const data = { ...DATA, suppliers: { ...DATA.suppliers, S1: { name: 'Третий', stock: true, rank: 2, currency: 'USD', rate: 3 } } };
  const sheets = [{ name: 'Прайс', rows: [
    [null, 'Новый поставщик - Гарантия качества по лучшим ценам!'],
    [null, 'Группа/Наименование', 'Артикул', 'Цена', 'Склад', 'ТД Ждановичи', 'ТЦ Атлантик', 'г.Гомель ТЦ'],
    [null, 'Аккумуляторы'],
    [null, 'Аккумулятор для iPhone11 1:1 TI', 5001, 10, '-', '+', '-', '-'],
    [null, 'Аккумулятор для iPhone14 1:1 TI', 5002, 12, '-', '-', '-', '+'],
    [null, 'Buzzer для iPhone11', 5003, 1.5, '+', '-', '-', '-'],
  ] }];
  const cols = detect(sheets, 'S1', data);
  assert.deepEqual([cols.nameCol, cols.priceCol, cols.stockCols, cols.rate], [1, 3, [4, 5, 6], 3], 'Гомель не учитываем');
  const { next } = buildImport(data, 'S1', sheets, cols, '2026-11-05');
  const s1 = next.parts.filter((p) => p.sup === 'S1').map((p) => [p.name, p.cost, p.stock]);
  assert.deepEqual(s1, [['Аккумулятор для iPhone11 1:1 TI', 30, 'В наличии'], ['Аккумулятор для iPhone14 1:1 TI', 36, 'Нет в наличии'], ['Buzzer для iPhone11', 4.5, 'В наличии']]);
  // у знакомой позиции линия — по нынешним правилам (новые слова цвета сливают линии)
  const stale = { ...next, parts: next.parts.map((p) => (p.sup === 'S1' ? { ...p, line: 'старая линия' } : p)) };
  assert.deepEqual(buildImport(stale, 'S1', sheets, cols, '2026-11-06').next.parts.filter((p) => p.sup === 'S1').map((p) => p.line), s1.map(([n]) => lineKey(n)));
  // после загрузки отметка «цены пересчитаны из долларов» снимается: цены теперь из файла
  const marked = { ...next, suppliers: { ...next.suppliers, S1: { ...next.suppliers.S1, costRate: 3 } } };
  assert.equal(buildImport(marked, 'S1', sheets, cols, '2026-11-06').next.suppliers.S1.costRate, undefined);
  // новый курс пересчитывает закупку этого поставщика и только его
  const r = withRate(next, 'S1', 3.3);
  assert.deepEqual(r.parts.filter((p) => p.sup === 'S1').map((p) => p.cost), [33, 39.6, 4.95]);
  assert.equal(r.suppliers.S1.rate, 3.3);
  assert.deepEqual(r.parts.filter((p) => p.sup !== 'S1').map((p) => p.cost), next.parts.filter((p) => p.sup !== 'S1').map((p) => p.cost));
  // смена курса и повторная загрузка того же файла по новому курсу: те же цены, без «подорожало на копейку»
  const odd = [[...sheets[0].rows[0]], [...sheets[0].rows[1]], ...[1.37, 2.21, 0.83, 4.07, 1.19].map((usd, i) => [null, 'Buzzer для iPhone1' + (i ? i + 1 : ''), 6000 + i, usd, '+', '-', '-', '-'])];
  const odd1 = buildImport(data, 'S1', [{ name: 'Прайс', rows: odd }], detect([{ name: 'Прайс', rows: odd }], 'S1', data), '2026-11-05').next;
  for (const rate of [3.1, 3.07, 3.21]) {
    const moved = withRate(odd1, 'S1', rate);
    const again = buildImport(moved, 'S1', [{ name: 'Прайс', rows: odd }], detect([{ name: 'Прайс', rows: odd }], 'S1', moved), '2026-11-06');
    assert.deepEqual([again.report.priceUp.length, again.report.priceDown.length, again.report.known], [0, 0, 5], 'курс ' + rate);
  }
  // поставщик был «в рублях», а прайс у него в долларах: пересчёт из курса 1
  const was = { ...next, suppliers: { ...next.suppliers, S1: { name: 'Третий', stock: true, rank: 2 } } };
  assert.deepEqual(withRate(was, 'S1', 3.05, 1).parts.filter((p) => p.sup === 'S1').map((p) => p.cost), [91.5, 109.8, 13.73]);
  // опечатка в курсе
  const { oddRate } = await imp('js/importer.js');
  assert.ok(oddRate(305, 3.05));
  assert.ok(oddRate(3.9, 3.05), 'скачок больше 20%');
  assert.equal(oddRate(3.1, 3.05), null);
  assert.equal(oddRate(3.05, 0), null);
  // первая загрузка: столбец «Цена, $» у поставщика в долларах, а не артикул перед ним; один магазин с «+»/«-»
  const usd = [
    ['Наименование', 'Артикул', 'Цена, $', 'ТД Ждановичи', 'г.Гомель ТЦ'],
    ['Аккумулятор для iPhone11 1:1 TI', 5001, 10, '+', '-'],
    ['Аккумулятор для iPhone14 1:1 TI', 5002, 12, '-', '+'],
    ['Buzzer для iPhone11', 5003, 1.5, '+', '+'],
  ];
  const fresh = { ...DATA, suppliers: { ...DATA.suppliers, S1: { name: 'Третий', stock: true, rank: 2, currency: 'USD', rate: 3.05 } } };
  const uc = detect([{ name: 'Прайс', rows: usd }], 'S1', fresh);
  assert.deepEqual([uc.priceCol, uc.stockCol], [2, 3]);
  const un = buildImport(fresh, 'S1', [{ name: 'Прайс', rows: usd }], uc, '2026-11-05').next;
  assert.deepEqual(un.parts.filter((p) => p.sup === 'S1').map((p) => [p.cost, p.stock]), [[30.5, 'В наличии'], [36.6, 'Нет в наличии'], [4.57, 'В наличии']]);
});

await test('названия ещё одного поставщика: «АКБ», модель в скобках после кода, «(SP) = пожизненная гарантия»', () => {
  const models = [['Samsung', 'Samsung Galaxy A41'], ['Samsung', 'Samsung Galaxy A34 5G'], ['Samsung', 'Samsung Galaxy A54 5G'], ['Samsung', 'Samsung Galaxy A14 5G'],
    ['Samsung', 'Samsung Galaxy A02s'], ['iPhone', 'iPhone 11 Pro'], ['iPhone', 'iPhone XS']];
  const idx = siteIndex(models.map((m) => m[1]));
  const fam = new Map(models.map((m) => [m[1], BRAND_FAM[m[0]]]));
  const map = (n) => { const k = kindOf(n); if (!k) return null; const r = mapRow(n, k, idx, fam); return [k, r.tier, r.models.join()]; };
  assert.deepEqual(map('АКБ Apple iPhone 11 Pro - JCID усиленная 3400 mAh'), ['b', 'copy_boost', 'iPhone 11 Pro']);
  assert.deepEqual(map('АКБ Apple iPhone Xs 2658 mAh - ПРЕМИУМ'), ['b', 'copy', 'iPhone XS'], '«Apple» перед iPhone и ёмкость');
  assert.deepEqual(map('Дисплей Samsung A415F (A41) МОДУЛЬ Черный - (OLED) (Full Size)'), ['d', 'copy_oled', 'Samsung Galaxy A41'], 'модель в скобках после кода');
  assert.deepEqual(map('АКБ Samsung EB-BA546ABY (A346B A34 5G/A546E A54 5G) - ПРЕМИУМ (SP) = пожизненная гарантия'), ['b', 'copy', 'Samsung Galaxy A34 5G,Samsung Galaxy A54 5G']);
  assert.deepEqual(map('Дисплей Samsung A146B (A14 5G) в сборе с тачскрином Черный (SP) = пожизненная гарантия'), ['d', 'copy_lcd', 'Samsung Galaxy A14 5G'], '(SP) = гарантия — не Service Pack');
  assert.deepEqual(map('Дисплей Samsung A146B (A14 5G) в сборе с тачскрином Черный - ОРИГИНАЛ (SP) = пожизненная гарантия'), ['d', 'orig_new', 'Samsung Galaxy A14 5G']);
  assert.deepEqual(map('Дисплей Samsung A025F (A02s) МОДУЛЬ Черный - ОРИГИНАЛ-СЕРВИС-РЕФ'), ['d', 'orig_reglass', 'Samsung Galaxy A02s'], '«РЕФ» — восстановленный');
  assert.deepEqual(map('Звонок (buzzer) Samsung A415F (A41) в сборе'), ['ls', 'copy', 'Samsung Galaxy A41']);
  assert.deepEqual(map('Контейнер SIM/SIM Лоток Samsung A415F (A41) Черный'), ['sim', 'copy', 'Samsung Galaxy A41']);
  // у прежних названий скобки с кодом не мешают: модель берётся из основной части
  assert.deepEqual(map('Дисплей Samsung A34 5G (A346B) - OR (SP)'), ['d', 'orig_new', 'Samsung Galaxy A34 5G']);
});

await test('цены на сайт одной кнопкой: GitHub API', async () => {
  const { publishSite, toBase64, fromBase64 } = await imp('js/site-publish.js');
  const text = 'window.MODEL_PRICES = [["iPhone", "iPhone 11 — замена"]];';
  assert.equal(fromBase64(toBase64(text)), text, 'русские буквы туда и обратно');
  const calls = [];
  const gh = (cur, put = 200) => async (url, o = {}) => {
    calls.push([o.method || 'GET', url, o.body ? JSON.parse(o.body) : null, o.headers.Authorization]);
    if (!o.method) return cur ? { ok: true, status: 200, json: async () => cur } : { ok: false, status: 404 };
    return { ok: put < 300, status: put, json: async () => ({}) };
  };
  assert.equal(await publishSite(text, 'k1', gh({ sha: 's1', content: toBase64(text) })), 'same');
  assert.equal(calls.length, 1, 'те же цены — не отправляем');
  calls.length = 0;
  assert.equal(await publishSite(text, 'k1', gh({ sha: 's1', content: toBase64('старое') })), 'updated');
  const put = calls[1];
  assert.equal(put[0], 'PUT');
  assert.match(put[1], /repos\/Frodo2411\/fedya\.chinet\/contents\/prices-models\.js$/);
  assert.deepEqual([put[2].sha, put[2].branch, fromBase64(put[2].content), put[3]], ['s1', 'main', text, 'Bearer k1']);
  await assert.rejects(publishSite(text, 'bad', async () => ({ ok: false, status: 401 })), /ключ/);
  // на хостинг: приёмник prices-update.php, ключ в заголовке
  const { publishHosting } = await imp('js/site-publish.js');
  let sent = null;
  await publishHosting(text, 'site-key-1234567890', async (url, o) => { sent = [url, o.method, o.headers['X-Key'], o.body]; return { ok: true, status: 200 }; });
  assert.deepEqual(sent, ['https://fedya-chinit.by/prices-update.php', 'POST', 'site-key-1234567890', text]);
  await assert.rejects(publishHosting(text, 'x', async () => ({ ok: false, status: 403 })), /ключ сайта/);
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
  assert.equal(report.file.otherBrands, 0);
  assert.ok(report.unmapped.includes('Дисплей Tecno Spark 20 - In-Cell'), 'Tecno знаком, но модели нет в данных');
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
  assert.deepEqual(s, { taken: 1, issued: 1, revenue: 100, profit: 60, expenses: 15, net: 45, warranty: 0, warrantyCost: 0 });
});

await test('гарантийные заказы: признак и итоги', () => {
  assert.equal(isWarranty({ num: 'Г3' }), true);
  assert.equal(isWarranty({ num: 'г 3' }), true);
  assert.equal(isWarranty({ num: 3, warranty: '2027-01-01' }), false, '«Гарантия до» — не гарантийный заказ');
  assert.equal(isWarranty({ num: null, warrantyOrder: true }), true, 'ещё не отправлен');
  const orders = [
    { num: 5, date: '2026-10-01', status: 'Выдан', price: 100, part: 40, issued: '2026-10-02' },
    { num: 'Г1', date: '2026-10-20', status: 'Выдан', price: 0, part: 25, issued: '2026-10-21' },
    { num: 'Г2', date: '2026-10-22', status: 'В работе', price: 0, part: 30 },
  ];
  const s = summary(orders, [], '2026-10', 4);
  assert.deepEqual(s, { taken: 3, issued: 2, revenue: 100, profit: 35, expenses: 0, net: 35, warranty: 1, warrantyCost: 25 });
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
  // гарантийные заказы: своя нумерация Г1, Г2…, обычная не сбивается; столбец «Гарантия по №» появляется сам
  assert.equal(gas.post({ op: 'list', key: 'test-key' }).data.version, 2);
  const nextNum = Math.max(...gas.post({ op: 'list', key: 'test-key' }).data.orders.map((o) => (typeof o.num === 'number' ? o.num : 0))) + 1;
  const wr = gas.post({ op: 'batch', key: 'test-key', ops: [
    { id: 'w1', op: 'addOrder', warranty: true, fields: { model: 'iPhone 11', client: 'Иван', phone: '291112233', wfor: 2, price: 0, part: 25 } },
    { id: 'w2', op: 'addOrder', fields: { model: 'обычный' } },
    { id: 'w3', op: 'addOrder', warranty: true, fields: { model: 'Redmi', client: 'Оля', phone: '293334455' } },
  ] }).data;
  assert.deepEqual(wr.map((r) => r.num), ['Г1', nextNum, 'Г2']);
  const head2 = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  assert.equal(head2[head2.length - 1], 'Гарантия по №', 'столбец добавлен в конец');
  assert.equal(sh.getRange(wr[0].row, head2.length).getValue(), 2);
  const wl = gas.post({ op: 'list', key: 'test-key' }).data.orders;
  const g1 = wl.find((o) => o.num === 'Г1');
  assert.deepEqual([g1.wfor, g1.client, g1.price], [2, 'Иван', 0]);
  const wu = gas.post({ op: 'batch', key: 'test-key', ops: [
    { id: 'w4', op: 'updateOrder', num: 'Г1', row: wr[2].row, fields: { status: 'Выдан' } },
    { id: 'w5', op: 'updateOrder', num: 'г 2', fields: { status: 'Готов' } },
    { id: 'w6', op: 'updateOrder', num: 'Г9', fields: { status: 'Готов' } },
  ] }).data;
  assert.deepEqual(wu.map((r) => r.row), [wr[0].row, wr[2].row, undefined], 'правка по номеру Г, а не по строке');
  assert.equal(wu[2].ok, false);
  assert.equal(sh.getRange(wr[0].row, 17).getValue(), 'Выдан');
  assert.equal(sh.getRange(2, 17).getValue(), 'Принят', 'заказ №1 не тронут правкой Г1');
  const wrep = gas.post({ op: 'batch', key: 'test-key', ops: [{ id: 'w3', op: 'addOrder', warranty: true, fields: { model: 'Redmi' } }] }).data[0];
  assert.deepEqual([wrep.repeat, wrep.num], [true, 'Г2'], 'повтор гарантийного не создаёт Г3');
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
  // гарантийный: в очереди с признаком, в таблице — номер Г1; правка до отправки уходит в ту же строку
  offline = true;
  s.add('addOrder', { model: 'iPhone 11', client: 'Иван', phone: '375291112233', price: 0, wfor: 1 }, { warranty: true });
  const wp = s.orders().find((o) => o.pendingId);
  assert.equal(isWarranty(wp), true);
  s.update('updateOrder', wp, { part: 25 });
  offline = false;
  s.again = true;
  while (s.outbox.length || s.running) await (s.running || s.flush());
  assert.equal(s.failed.length, 0);
  const g = s.orders().find((o) => o.num === 'Г1');
  assert.ok(g && isWarranty(g), 'после отправки номер Г1');
  assert.equal(s.version, 2);
  assert.deepEqual([sh.getRange(g.row, 1).getValue(), sh.getRange(g.row, 3).getValue()], ['Г1', 'iPhone 11']);
  s.update('updateOrder', g, { status: 'Выдан' });
  while (s.outbox.length || s.running) await (s.running || s.flush());
  assert.equal(sh.getRange(g.row, 5).getValue(), 'Выдан');
  assert.equal(sh.getRange(1, 1).getValue(), '№');
});

await test('корзина: +1 к той же детали, по поставщикам, цена из нынешнего прайса, замена поставщика', async () => {
  const { cartAdd, cartReplace, cartQty, cartCount, cartGroups, cartText } = await imp('js/cart.js');
  const d11 = { sup: 'E', name: 'Дисплей iPhone 11 - In-Cell', cost: 40, model: 'iPhone 11', svc: 'd', tier: 'copy_lcd', use: 'iPhone 11 · дисплей' };
  let c = cartAdd([], d11);
  c = cartAdd(c, { ...d11, use: 'iPhone 11 · дисплей (второй заказ)' });
  c = cartAdd(c, { sup: 'P', name: 'Дисплей iPhone 11 - Original (снятый)', cost: 90, model: 'iPhone 11', svc: 'd', tier: 'orig_used' });
  c = cartAdd(c, { sup: 'E', name: 'Аккумулятор iPhone 11 - копия', cost: 25 });
  c = cartAdd(c, { sup: 'E', name: 'Пропавшая позиция', cost: 7 });
  assert.equal(c.length, 4);
  assert.equal(cartQty(c, 'E', d11.name), 2);
  assert.deepEqual(c[0].uses, ['iPhone 11 · дисплей', 'iPhone 11 · дисплей (второй заказ)']);
  const data = { ...DATA, parts: DATA.parts.map((p) => (p.name === 'Аккумулятор iPhone 11 - копия' ? { ...p, cost: 27 } : p)) };
  const g = cartGroups(c, data);
  assert.deepEqual(g.map((x) => x.sup), ['P', 'E'], 'основной поставщик (rank 0) первым');
  assert.deepEqual([g[1].left, g[1].total], [3, 2 * 40 + 27 + 7], 'цена аккумулятора уже новая, пропавшая — из корзины');
  assert.equal(g[1].items.find((x) => x.name === 'Пропавшая позиция').gone, true);
  assert.equal(g[0].items[0].stock, 'В наличии');
  // куплено: не считается в «осталось» и в списке для поставщика
  c = c.map((x) => (x.name === 'Пропавшая позиция' ? { ...x, done: true } : x));
  assert.equal(cartCount(c), 3);
  const ge = cartGroups(c, data)[1];
  assert.deepEqual([ge.left, ge.total], [2, 107]);
  assert.equal(cartText('Первый', ge.items), 'Первый:\n• Дисплей iPhone 11 - In-Cell — 2 шт.\n• Аккумулятор iPhone 11 - копия — 1 шт.');
  // другой поставщик: количество и «для чего» остаются; если такая деталь уже есть — складываются
  const id = c.find((x) => x.name === d11.name).id;
  const r = cartReplace(c, id, { sup: 'P', name: 'Дисплей iPhone 11 - Original (снятый)', cost: 90 });
  assert.equal(r.length, 3);
  assert.equal(cartQty(r, 'P', 'Дисплей iPhone 11 - Original (снятый)'), 3);
  assert.equal(cartQty(r, 'E', d11.name), 0);
  assert.ok(r.find((x) => x.sup === 'P').uses.includes('iPhone 11 · дисплей (второй заказ)'));
  // повторное добавление купленной детали — снова «купить»
  assert.equal(cartAdd(c, { sup: 'E', name: 'Пропавшая позиция', cost: 7 }).find((x) => x.name === 'Пропавшая позиция').done, false);
});

await test('версия в «Ещё» совпадает с выпуском в sw.js', () => {
  const sw = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))[1];
  const app = /export const APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'js/view-more.js'), 'utf8'))[1];
  assert.equal(app, sw);
  assert.match(sw, /^\d{4}-\d{2}-\d{2}\.\d+$/);
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
