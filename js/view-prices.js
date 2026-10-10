// Экран «Цены»: поиск модели, ремонты, варианты деталей с ценой клиенту, поставщиком и заработком.

import { h, fill, icon, money, toast, copyText } from './ui.js';
import { SERVICES, clientPrice, diffCoef, noveltyCoef } from './engine.js';
import { store } from './store.js';

export const SVC = { b: 'Аккумулятор', d: 'Дисплей', p: 'Разъём зарядки', c: 'Задняя крышка' };
export const VAR_APP = {
  copy: 'Копия', copy_boost: 'Копия усиленная', verified: 'Копия без ошибки', copy_lcd: 'Копия ЖК (In-Cell, TFT)', copy_oled: 'Копия OLED',
  orig_reglass: 'Оригинал, переклей', orig_used: 'Оригинал, снятый', orig_new: 'Оригинал новый',
};
// Как на сайте
export const VAR_CLIENT = {
  copy: 'Копия', copy_boost: 'Копия усиленная', verified: 'Копия без ошибки', copy_lcd: 'Копия', copy_oled: 'Копия OLED',
  orig_reglass: 'Оригинал, переклей', orig_used: 'Оригинал, снятый', orig_new: 'Оригинал',
};
export const REPAIR = { b: 'Замена аккумулятора', d: 'Замена дисплея', p: 'Замена разъёма зарядки', c: 'Замена задней крышки' };

// Пояснения для клиента, по тексту с сайта
function clientHint(svc, tier, model) {
  const iphone = model.startsWith('iPhone');
  if (svc === 'b') {
    return {
      copy: iphone ? 'не от производителя; на iPhone может появиться сообщение о неизвестной детали' : 'батарея не от производителя телефона',
      copy_boost: iphone ? 'ёмкость больше заводской; может появиться сообщение о неизвестной детали' : 'ёмкость больше заводской',
      verified: 'без сообщения о неизвестной детали',
      orig_used: 'батарея производителя с другого телефона, ёмкость от 95%',
      orig_new: 'новая, от производителя',
    }[tier];
  }
  if (svc === 'd') {
    return {
      copy_lcd: 'ЖК-экран (In-Cell, TFT), самый недорогой вариант',
      copy_oled: 'цвета и яркость ближе к оригиналу',
      orig_reglass: 'оригинальная матрица с новым стеклом',
      orig_used: 'оригинальный дисплей с другого телефона',
      orig_new: 'новый оригинальный дисплей',
    }[tier];
  }
  return { orig_used: 'оригинал с другого телефона', orig_new: 'оригинальная деталь' }[tier] || '';
}

export function createPricesView(app) {
  const st = { q: '', model: null, svc: store.get('svc', 'd'), overrides: new Map(), open: new Set(), showHidden: false };
  const root = h('div');
  const results = h('div');
  const input = h('input', {
    class: 'search', type: 'search', placeholder: 'Модель: айфон 14 про, редми ноут 13', autocomplete: 'off', autocorrect: 'off',
    autocapitalize: 'off', spellcheck: false, enterkeyhint: 'search', 'aria-label': 'Поиск модели',
    oninput: () => { st.q = input.value; drawResults(); },
    onkeydown: (e) => { if (e.key === 'Enter') { const first = app.search.find(st.q, 1)[0]; if (first) { input.blur(); openModel(first.model); } } },
  });
  const clear = h('button', { class: 'clear', 'aria-label': 'Очистить', text: '✕', onclick: () => { input.value = ''; st.q = ''; drawResults(); input.focus(); } });
  const searchScreen = h('div', {},
    h('div', { class: 'searchbar' }, h('div', { class: 'search-wrap' }, input, clear)),
    results);
  const modelScreen = h('div');

  function drawResults() {
    clear.hidden = !st.q;
    if (!st.q.trim()) {
      const recent = store.get('recent', []).filter((n) => app.pricer.byName.has(n));
      const sup = app.data.suppliers;
      fill(results, 
        recent.length ? h('h2', { text: 'Недавние' }) : null,
        recent.length ? h('div', { class: 'list' }, recent.map((n) => modelItem(app.pricer.byName.get(n)))) : null,
        h('div', { class: 'card flat', style: 'margin-top:16px' },
          h('div', { class: 'small muted' }, 'В прайсе ', app.data.models.length, ' моделей. Прайсы: ',
            Object.values(sup).map((s) => s.name + ' от ' + fmt(s.date || app.data.priceDate)).join(', '), '.'),
          h('div', { class: 'small faint', style: 'margin-top:6px' }, 'Ищи по-русски и с ошибками: «айфон 14 про», «самсунг а52», «поко х6».')),
      );
      return;
    }
    const found = app.search.find(st.q);
    fill(results, found.length
      ? h('div', { class: 'list' }, found.map(modelItem))
      : h('div', { class: 'empty' }, 'Такой модели нет в прайсе.', h('br'), 'Цена уточняется отдельно.'));
  }

  function modelItem(m) {
    return h('button', { class: 'item', onclick: () => { input.blur(); openModel(m.model); } },
      h('div', { class: 'grow' }, h('div', { class: 't', text: m.model }), h('div', { class: 's', text: [m.brand, m.year].filter(Boolean).join(' · ') })),
      h('span', { class: 'chev', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>' }));
  }

  function openModel(name) {
    st.model = name;
    st.overrides.clear();
    st.open.clear();
    st.showHidden = false;
    const recent = [name, ...store.get('recent', []).filter((n) => n !== name)].slice(0, 12);
    store.set('recent', recent);
    const e = app.pricer.model(name);
    const has = (svc) => e.services[svc].opts.some((o) => !o.hidden);
    if (!has(st.svc)) st.svc = SERVICES.find(has) || 'd';
    draw();
    window.scrollTo(0, 0);
  }

  function closeModel() {
    st.model = null;
    draw();
    window.scrollTo(0, 0);
  }

  function priceOf(entry, svc, o) {
    const ov = st.overrides.get(entry.model + '|' + svc + '|' + o.tier);
    if (!ov) return { price: o.price, formula: o.formula, smartfix: o.smartfix, cost: o.cost, sup: o.sup, part: o.part, stock: o.stock, inStock: o.inStock, override: false };
    const cp = clientPrice(app.pricer.S, o.work, ov.cost, o.sf);
    return { ...cp, cost: ov.cost, sup: ov.sup, part: ov.name, stock: ov.stock, inStock: app.pricer.inStock(ov), override: true };
  }

  function stockBadge(sup, stock) {
    const s = app.data.suppliers[sup];
    if (!s || !s.stock) return h('span', { class: 'badge warn', text: 'уточнить наличие' });
    if (stock === 'В наличии') return h('span', { class: 'badge good', text: 'в наличии' });
    return h('span', { class: 'badge bad', text: (stock || 'нет в наличии').toLowerCase() });
  }

  function supName(key) {
    return (app.data.suppliers[key] && app.data.suppliers[key].name) || key;
  }

  function variantCard(entry, svc, o) {
    const S = app.pricer.S;
    const p = priceOf(entry, svc, o);
    const key = entry.model + '|' + svc + '|' + o.tier;
    const earn = p.price - p.cost;
    const others = app.pricer.partsFor(entry.model, svc, o.tier);
    const note = (app.settings.supplierNotes || {})[p.sup];
    let sfText = null;
    if (p.smartfix) {
      let why = '';
      if (p.price < p.formula) why = ' · снижено под SmartFix, по формуле ' + p.formula + ' р.';
      else if (p.price > p.formula) why = ' · поднято до половины цены SmartFix, по формуле ' + p.formula + ' р.';
      if (p.price >= p.smartfix) why += ' · дороже SmartFix: ниже не опустить';
      sfText = 'SmartFix ' + p.smartfix + ' р.' + why;
    } else {
      sfText = 'У SmartFix нет цены на этот вариант';
    }
    const card = h('div', { class: 'card variant' + (o.hidden ? ' dim' : '') },
      h('div', { class: 'head' }, h('div', { class: 'vname', text: VAR_APP[o.tier] }), h('div', { class: 'price', text: p.price + ' р.' })),
      h('div', { class: 'earn' }, 'заработок ', h('b', { text: money(Math.round(earn * 100) / 100) }), ' · деталь ', money(p.cost), ' · работа ', o.work, ' р.',
        h('span', { class: 'faint', text: ' · налог ' + Math.round(p.price * S.tax) + ' р.' })),
      h('button', {
        class: 'part', 'aria-label': 'Скопировать название детали',
        onclick: async () => { if (await copyText(p.part)) toast('Название детали скопировано'); },
      },
      h('span', { class: 'sup' }, supName(p.sup), stockBadge(p.sup, p.stock), p.override ? h('span', { class: 'badge info', text: 'выбрана вручную' }) : null,
        h('span', { class: 'copyhint' }, 'копировать')),
      h('span', { class: 'pname', text: p.part }),
      !p.override && o.colours > 1 ? h('span', { class: 'tiny faint', text: 'Цветов: ' + o.colours + ', цена по самому дорогому' }) : null),
      note ? h('div', { class: 'tiny muted', style: 'margin-top:6px' }, 'Как заказать: ', note) : null,
      o.alt && !p.override ? h('div', { class: 'alt' }, 'Второй поставщик: ', h('b', { text: supName(o.alt.sup) + ' — ' + money(o.alt.cost) }), ' ', stockBadge(o.alt.sup, o.alt.stock),
        h('div', { class: 'tiny faint break', text: o.alt.part })) : null,
      h('div', { class: 'sfline', text: sfText }),
      o.hidden ? h('div', { class: 'tiny', style: 'color:var(--accent);margin-top:6px', text: 'Скрыт: не дешевле варианта получше' }) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn small primary', onclick: () => app.newOrderFromPrice(entry, svc, o, p) }, 'Записать заказ'),
        h('button', {
          class: 'btn small', onclick: () => { if (st.open.has(key)) st.open.delete(key); else st.open.add(key); draw(); },
        }, (st.open.has(key) ? 'Скрыть детали' : 'Все детали · ' + others.length))),
      st.open.has(key) ? h('div', { class: 'others' },
        p.override ? h('button', { class: 'link', text: 'Вернуть деталь по умолчанию', onclick: () => { st.overrides.delete(key); draw(); } }) : null,
        others.map((r) => {
          const chosen = p.override ? r === st.overrides.get(key) : r.name === p.part && r.sup === p.sup && r.cost === p.cost;
          return h('div', { class: 'other' },
            h('div', { class: 'grow' },
              h('div', { class: 'small' }, h('b', { text: supName(r.sup) + ' · ' + money(r.cost) }), ' ', stockBadge(r.sup, r.stock)),
              h('div', { class: 'tiny muted break', text: r.name })),
            chosen ? h('span', { class: 'small on', text: 'выбрана' })
              : h('button', { class: 'btn small', text: 'Выбрать', onclick: () => { st.overrides.set(key, r); draw(); } }));
        })) : null);
    return card;
  }

  function clientText(entry, svcs) {
    const hints = app.settings.clientHints !== false;
    const lines = [entry.model + (svcs.length === 1 ? ' — ' + REPAIR[svcs[0]].toLowerCase() : '')];
    lines.push('Цена под ключ (деталь и работа):');
    for (const svc of svcs) {
      const opts = entry.services[svc].opts.filter((o) => !o.hidden);
      if (!opts.length) continue;
      if (svcs.length > 1) lines.push('', SVC[svc] + ':');
      for (const o of opts) {
        const hint = hints ? clientHint(svc, o.tier, entry.model) : '';
        lines.push('• ' + VAR_CLIENT[o.tier] + ' — ' + priceOf(entry, svc, o).price + ' р.' + (hint ? ' (' + hint + ')' : ''));
      }
    }
    const foot = (app.settings.clientFooter || '').trim();
    if (foot) lines.push('', foot);
    return lines.join('\n');
  }

  function draw() {
    if (!st.model) {
      fill(root, searchScreen);
      drawResults();
      return;
    }
    const e = app.pricer.model(st.model);
    if (!e) { st.model = null; draw(); return; }
    const S = app.pricer.S;
    const svcData = e.services[st.svc];
    const visible = svcData.opts.filter((o) => !o.hidden);
    const hidden = svcData.opts.filter((o) => o.hidden);
    const coefs = 'сложность ×' + String(diffCoef(S, e)).replace('.', ',') + ', новизна ×' + String(noveltyCoef(S, e)).replace('.', ',');
    fill(modelScreen, 
      h('div', { class: 'topbar' }, h('button', { class: 'back', onclick: closeModel }, icon('back'), 'Поиск')),
      h('h1', { text: e.model }),
      h('div', { class: 'small muted', text: [e.year ? e.year + ' г.' : null, 'iFixit ' + (e.ifixit ?? 'нет оценки'), coefs].filter(Boolean).join(' · ') }),
      h('div', { class: 'repairs' }, SERVICES.map((svc) => {
        const vis = e.services[svc].opts.filter((o) => !o.hidden);
        const from = vis.length ? Math.min(...vis.map((o) => priceOf(e, svc, o).price)) : null;
        return h('button', {
          class: 'repair' + (svc === st.svc ? ' on' : ''), disabled: !vis.length,
          onclick: () => { st.svc = svc; store.set('svc', svc); draw(); },
        }, h('span', { class: 'name', text: SVC[svc] }), h('span', { class: 'from', text: from ? 'от ' + from + ' р.' : 'нет деталей' }));
      })),
      visible.length ? visible.map((o) => variantCard(e, st.svc, o))
        : h('div', { class: 'empty' }, 'У поставщиков нет деталей для этого ремонта.', h('br'), 'Цена уточняется отдельно.'),
      hidden.length ? h('button', { class: 'link', style: 'margin-top:8px', onclick: () => { st.showHidden = !st.showHidden; draw(); } },
        st.showHidden ? 'Не показывать скрытые варианты' : 'Скрытые варианты: ' + hidden.length + ' (не дешевле варианта получше)') : null,
      st.showHidden ? hidden.map((o) => variantCard(e, st.svc, o)) : null,
      h('div', { class: 'small faint', style: 'margin-top:14px', text: 'Работа ' + svcData.work + ' р. Цена = (работа + деталь) / (1 − ' + String(S.tax).replace('.', ',') + '), округление до ' + S.round + ' р., сверка с SmartFix.' }),
      h('div', { class: 'dock' }, h('div', { class: 'inner' },
        h('button', {
          class: 'btn primary', disabled: !visible.length,
          onclick: async () => { if (await copyText(clientText(e, [st.svc]))) toast('Текст для клиента скопирован'); },
        }, icon('copy'), 'Скопировать клиенту'),
        h('button', {
          class: 'btn', 'aria-label': 'Скопировать все ремонты',
          onclick: async () => { if (await copyText(clientText(e, SERVICES))) toast('Все ремонты скопированы'); },
        }, 'Все'))),
    );
    fill(root, modelScreen);
  }

  function fmt(d) {
    if (!d) return '—';
    const [y, m, dd] = d.split('-');
    return dd + '.' + m + '.' + y;
  }

  return {
    el: root,
    draw,
    reset() { st.overrides.clear(); draw(); },
    openModel,
    get model() { return st.model; },
  };
}
