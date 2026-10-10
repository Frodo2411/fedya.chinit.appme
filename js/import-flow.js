// Окно «Обновить прайс»: читаем файл поставщика, показываем, что изменится, и применяем.

import { h, fill, money, toast, openSheet, field } from './ui.js';
import { readTable } from './xlsx.js';
import { detect, buildImport, clientChanges, colName } from './importer.js';
import { today } from './store.js';
import { SVC, VAR_APP } from './view-prices.js';

export async function openImport(app, supKey, file) {
  const sup = app.data.suppliers[supKey];
  let sheets;
  let cols;
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
      fill(body, h('div', { class: 'banner bad', text: e.message }), columnsBox());
      applyBtn.disabled = true;
      return;
    }
    applyBtn.disabled = false;
    draw();
  }

  function columnsBox() {
    const pc = cols.priceCols.find((c) => c.col === cols.priceCol);
    return h('details', {},
      h('summary', { text: 'Столбцы: название ' + colName(cols.nameCol) + ', цена ' + colName(cols.priceCol) + (cols.stockCol !== null ? ', наличие ' + colName(cols.stockCol) : '') }),
      pc && pc.known ? h('div', { class: 'small muted', text: 'Цена в этом столбце совпала с прошлой у ' + pc.hits + ' из ' + pc.known + ' знакомых позиций.' }) : null,
      field('Название детали', h('select', { class: 'input', onchange: (e) => { cols.nameCol = Number(e.target.value); rebuild(); } }, colOptions(cols.nameCol))),
      field('Цена, BYN', h('select', { class: 'input', onchange: (e) => { cols.priceCol = Number(e.target.value); rebuild(); } }, colOptions(cols.priceCol))),
      sup.stock ? field('Наличие', h('select', { class: 'input', onchange: (e) => { const v = Number(e.target.value); cols.stockCol = v < 0 ? null : v; rebuild(); } }, colOptions(cols.stockCol, true))) : null);
  }

  function draw() {
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
      r.fresh.map((p) => {
        p._tier = p._tier || p.tier;
        return h('label', { class: 'other', style: 'align-items:flex-start' },
          h('input', { type: 'checkbox', checked: p.tier !== 'skip', style: 'width:22px;height:22px;margin-top:2px;accent-color:var(--accent)',
            onchange: (e) => { p.tier = e.target.checked ? p._tier : 'skip'; draw(); } }),
          h('div', { class: 'grow' }, h('div', { class: 'small break', text: p.name }),
            h('div', { class: 'tiny muted', text: SVC[p.svc] + ' · ' + VAR_APP[p._tier] + ' · ' + money(p.cost) + ' → ' + p.models.join(', ') })));
      }),
      list('Не распознаны (не на сайте или непонятное название)', r.unmapped, (n) => h('div', { class: 'tiny muted break', style: 'padding:4px 0', text: n })),
      list('Пропали из прайса', r.gone, (n) => h('div', { class: 'tiny muted break', style: 'padding:4px 0', text: n })),
      list('Подорожали у поставщика', r.priceUp, (x) => h('div', { class: 'tiny muted break', style: 'padding:4px 0', text: x.name + ': ' + x.old + ' → ' + x.cost })),
      list('Подешевели у поставщика', r.priceDown, (x) => h('div', { class: 'tiny muted break', style: 'padding:4px 0', text: x.name + ': ' + x.old + ' → ' + x.cost })),
      r.file.noPrice ? h('div', { class: 'tiny faint', style: 'margin-top:10px', text: 'Без цены в файле: ' + r.file.noPrice + ' поз.' }) : null,
    );
    if (scroller) scroller.scrollTop = scrollTop;
  }

  function tile(label, v) {
    return h('div', { class: 'tile' }, h('div', { class: 'v', text: String(v) }), h('div', { class: 'l', text: label }));
  }

  applyBtn.onclick = async () => {
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
  rebuild();
}
