// Окно «Обновить прайс»: читаем файл поставщика, показываем, что изменится, и применяем.

import { h, fill, money, toast, openSheet, field, parseNum } from './ui.js';
import { readTable } from './xlsx.js';
import { detect, buildImport, clientChanges, colName, oddRate } from './importer.js';
import { today } from './store.js';
import { SVC, VAR_APP } from './view-prices.js';
import { SERVICES } from './engine.js';

export async function openImport(app, supKey, file) {
  const sup = app.data.suppliers[supKey];
  let sheets;
  let cols;
  toast('Читаю прайс…', 3000);
  try {
    sheets = await readTable(file);
    cols = detect(sheets, supKey, app.data);
  } catch (e) {
    toast(e.message, 5000);
    return;
  }
  const body = h('div');
  const applyBtn = h('button', { class: 'btn primary', text: 'Применить' });
  let result = null;
  const opened = new Set(); // какие списки раскрыты: при перерисовке оставляем как было
  // Пересчёт цен всех моделей заметен на телефоне: после галочек пересчитываем, когда нажатия закончились
  let drawTimer = null;
  const drawSoon = () => { clearTimeout(drawTimer); drawTimer = setTimeout(draw, 500); };

  function colOptions(selected, allowNone) {
    const rows = sheets[cols.sheet].rows;
    const width = Math.max(...rows.slice(0, 400).map((r) => r.length));
    const sample = (ci) => {
      const r = rows.find((x, i) => i > 0 && x[cols.nameCol] && x[ci] !== undefined && x[ci] !== null);
      return r ? String(r[ci]).slice(0, 24) : '';
    };
    const opts = [];
    if (allowNone) opts.push(h('option', { value: '-1', text: 'нет', selected: selected === null }));
    for (let ci = 0; ci < width; ci++) {
      const head = cols.header && cols.header[ci] ? String(cols.header[ci]).slice(0, 24) : '';
      opts.push(h('option', { value: String(ci), selected: ci === selected, text: colName(ci) + (head ? ' · ' + head : '') + (sample(ci) ? ' · ' + sample(ci) : '') }));
    }
    return opts;
  }

  function rebuild() {
    try {
      result = buildImport(app.data, supKey, sheets, cols, today());
    } catch (e) {
      fill(body, h('div', { class: 'banner bad', text: e.message }), rateBox(), columnsBox());
      applyBtn.disabled = true;
      return;
    }
    applyBtn.disabled = false;
    draw();
  }

  // Цены в долларах: курс виден и меняется прямо здесь, цены пересчитываются сразу
  function rateBox() {
    if (sup.currency !== 'USD') return null;
    return field('Цены в файле в долларах. Курс, р. за $', h('input', {
      class: 'input num', inputmode: 'decimal', value: String(cols.rate).replace('.', ','),
      onchange: (e) => {
        const n = parseNum(e.target.value);
        const odd = n > 0 && n !== cols.rate ? oddRate(n, cols.rate) : null;
        if (n > 0 && (!odd || confirm(odd))) { cols.rate = n; rebuild(); } else e.target.value = String(cols.rate).replace('.', ',');
      },
    }));
  }

  function columnsBox() {
    const pc = cols.priceCols.find((c) => c.col === cols.priceCol);
    const stockText = cols.stockCols && cols.stockCols.length ? ', наличие ' + cols.stockCols.map(colName).join('+')
      : cols.stockCol !== null ? ', наличие ' + colName(cols.stockCol) : '';
    return h('details', {},
      h('summary', { text: 'Столбцы: название ' + colName(cols.nameCol) + ', цена ' + colName(cols.priceCol) + stockText }),
      cols.stockCols && cols.stockCols.length ? h('div', { class: 'small muted', text: 'В наличии, если «+» хоть в одном из столбцов ' + cols.stockCols.map(colName).join(', ') + '. Другие города не учитываю.' }) : null,
      pc && pc.known ? h('div', { class: 'small muted', text: 'Цена в этом столбце совпала с прошлой у ' + pc.hits + ' из ' + pc.known + ' знакомых позиций.' }) : null,
      field('Название детали', h('select', { class: 'input', onchange: (e) => { cols.nameCol = Number(e.target.value); rebuild(); } }, colOptions(cols.nameCol))),
      field(sup.currency === 'USD' ? 'Цена, $' : 'Цена, BYN', h('select', { class: 'input', onchange: (e) => { cols.priceCol = Number(e.target.value); rebuild(); } }, colOptions(cols.priceCol))),
      sup.stock ? field('Наличие', h('select', { class: 'input', onchange: (e) => { const v = Number(e.target.value); cols.stockCol = v < 0 ? null : v; cols.stockCols = null; rebuild(); } }, colOptions(cols.stockCol, true))) : null);
  }

  function draw() {
    clearTimeout(drawTimer);
    const r = result.report;
    const changes = clientChanges(app.data, result.next, app.settings.formula);
    const up = changes.filter((c) => c.old !== null && c.price !== null && c.price > c.old);
    const down = changes.filter((c) => c.old !== null && c.price !== null && c.price < c.old);
    const appeared = changes.filter((c) => c.old === null);
    const vanished = changes.filter((c) => c.price === null);
    const pct = cols.priceCols.find((c) => c.col === cols.priceCol);
    const warn = pct && pct.known > 20 && pct.hits < pct.known * 0.5;
    const changeRow = (c) => h('div', { class: 'other' },
      h('div', { class: 'grow' }, h('div', { class: 'small', text: c.model }), h('div', { class: 'tiny muted', text: SVC[c.svc] + ' · ' + VAR_APP[c.tier] })),
      h('div', { class: 'nowrap small mono', text: (c.old === null ? 'нет' : c.old) + ' → ' + (c.price === null ? 'нет' : c.price) }));
    const list = (title, items, render) => items.length
      ? h('details', { open: opened.has(title), ontoggle: (e) => { if (e.target.open) opened.add(title); else opened.delete(title); } },
        h('summary', { text: title + ': ' + items.length }),
        h('div', {}, items.slice(0, 300).map(render), items.length > 300 ? h('div', { class: 'tiny faint', text: '…и ещё ' + (items.length - 300) }) : null))
      : null;
    const before = app.data.parts.filter((p) => p.sup === supKey && p.cost).length;
    const strange = before > 50 && r.known < before * 0.3;
    const scroller = sheet ? sheet.el.querySelector('.sheet-body') : null;
    const scrollTop = scroller ? scroller.scrollTop : 0;
    fill(body, 
      h('div', { class: 'small muted', text: 'Файл: ' + file.name + ' · лист «' + sheets[cols.sheet].name + '»' }),
      warn ? h('div', { class: 'banner warn', style: 'margin-top:10px', text: 'Цены в выбранном столбце сильно отличаются от прошлых. Проверь столбец цены ниже: может быть, выбраны доллары или розница.' }) : null,
      strange ? h('div', { class: 'banner bad', style: 'margin-top:10px', text: 'Почти ни одна позиция не совпала с прошлым прайсом ' + sup.name + '. Это точно его файл? Если нет — нажми «Отмена».' }) : null,
      rateBox(),
      columnsBox(),
      h('div', { class: 'tiles', style: 'margin-top:8px' },
        tile('Позиций в файле', r.file.parts), tile('Знакомых', r.known),
        tile('Новых распознано', r.fresh.length), tile('Пропало из прайса', r.gone.length)),
      h('h2', { text: 'Цены клиенту' }),
      changes.length ? h('div', { class: 'small muted', text: 'Подорожает: ' + up.length + ' · подешевеет: ' + down.length + ' · новых вариантов: ' + appeared.length + ' · исчезнет: ' + vanished.length })
        : h('div', { class: 'small muted', text: 'Цены клиенту не изменятся.' }),
      list('Подорожает', up, changeRow),
      list('Подешевеет', down, changeRow),
      list('Новые варианты', appeared, changeRow),
      list('Исчезнут варианты', vanished, changeRow),
      r.fresh.length ? h('h2', { text: 'Новые позиции: проверь' }) : null,
      r.fresh.length ? h('div', { class: 'small muted', text: 'Разметил по правилам. Сними галочку, если позиция не подходит: она не попадёт в расчёт, и в следующий раз приложение это запомнит.' }) : null,
      freshGroups(r.fresh),
      list('Не распознаны (нет такой модели в приложении или непонятное название)', r.unmapped, (n) => h('div', { class: 'tiny muted break', style: 'padding:4px 0', text: n })),
      list('Пропали из прайса', r.gone, (n) => h('div', { class: 'tiny muted break', style: 'padding:4px 0', text: n })),
      list('Подорожали у поставщика', r.priceUp, (x) => h('div', { class: 'tiny muted break', style: 'padding:4px 0', text: x.name + ': ' + x.old + ' → ' + x.cost })),
      list('Подешевели у поставщика', r.priceDown, (x) => h('div', { class: 'tiny muted break', style: 'padding:4px 0', text: x.name + ': ' + x.old + ' → ' + x.cost })),
      r.extended ? h('div', { class: 'tiny faint', style: 'margin-top:10px', text: 'Знакомые позиции, к которым добавились модели только для приложения: ' + r.extended }) : null,
      r.file.noPrice ? h('div', { class: 'tiny faint', style: 'margin-top:10px', text: 'Без цены в файле: ' + r.file.noPrice + ' поз.' }) : null,
    );
    if (scroller) scroller.scrollTop = scrollTop;
  }

  // Новые позиции по ремонтам; список рисуем, только когда его раскрыли: позиций бывают тысячи
  function freshGroups(fresh) {
    const by = new Map();
    for (const p of fresh) {
      p._tier = p._tier || p.tier;
      if (!by.has(p.svc)) by.set(p.svc, []);
      by.get(p.svc).push(p);
    }
    const setAll = (items, on) => { for (const p of items) p.tier = on ? p._tier : 'skip'; draw(); };
    return [...SERVICES, 'g'].filter((svc) => by.has(svc)).map((svc) => {
      const items = by.get(svc);
      const key = 'fresh:' + svc;
      const off = items.filter((p) => p.tier === 'skip').length;
      return h('details', { open: opened.has(key), ontoggle: (e) => {
        if (e.target.open === opened.has(key)) return;
        if (e.target.open) opened.add(key); else opened.delete(key);
        draw();
      } },
      h('summary', { text: SVC[svc] + ': ' + items.length + (off ? ' · снято ' + off : '') }),
      opened.has(key) ? h('div', {},
        h('div', { class: 'row wrap', style: 'margin:6px 0' },
          h('button', { class: 'btn small', text: 'Снять все', onclick: () => setAll(items, false) }),
          h('button', { class: 'btn small', text: 'Отметить все', onclick: () => setAll(items, true) })),
        items.map((p) => h('label', { class: 'other', style: 'align-items:flex-start' },
          h('input', { type: 'checkbox', checked: p.tier !== 'skip', style: 'width:22px;height:22px;margin-top:2px;accent-color:var(--accent)',
            onchange: (e) => { p.tier = e.target.checked ? p._tier : 'skip'; drawSoon(); } }),
          h('div', { class: 'grow' }, h('div', { class: 'small break', text: p.name }),
            h('div', { class: 'tiny muted', text: SVC[p.svc] + ' · ' + VAR_APP[p._tier] + ' · ' + money(p.cost) + ' → ' + p.models.join(', ') }))))) : null);
    });
  }

  function tile(label, v) {
    return h('div', { class: 'tile' }, h('div', { class: 'v', text: String(v) }), h('div', { class: 'l', text: label }));
  }

  applyBtn.onclick = async () => {
    clearTimeout(drawTimer);
    applyBtn.disabled = true;
    try {
      for (const p of result.next.parts) { delete p._tier; delete p.fresh; }
      await app.applyData(result.next);
      toast('Прайс ' + sup.name + ' обновлён');
      sheet.close();
    } catch (e) {
      toast('Не получилось: ' + e.message, 5000);
      applyBtn.disabled = false;
    }
  };
  const sheet = openSheet('Прайс ' + sup.name, body, [h('button', { class: 'btn', text: 'Отмена', onclick: () => sheet.close() }), applyBtn]);
  // сначала показать окно, потом считать: на телефоне разбор большого прайса занимает пару секунд
  fill(body, h('div', { class: 'small muted', style: 'padding:16px 0' }, h('span', { class: 'spin' }), ' Сопоставляю позиции…'));
  applyBtn.disabled = true;
  await new Promise((r) => setTimeout(r, 30));
  rebuild();
}
