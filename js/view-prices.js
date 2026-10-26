// Экран «Цены»: поиск модели, ремонты, варианты деталей с ценой клиенту, поставщиком и заработком.

import { h, fill, icon, money, toast, copyText, openSheet, field, select, parseNum, fmtDate } from './ui.js';
import { SERVICES, SITE_SERVICES, ORDER, OWN, clientPrice, riskReserve, comboTotal, diffCoef, noveltyCoef, workFee, sfKey, GLUE_NAME } from './engine.js';
import { store, newId, today } from './store.js';
import { telHref } from './view-orders.js';

// Заметка «как заказать»: @бот → Telegram, адрес сайта и телефон — тоже нажимаются
export function linkify(text) {
  const out = [];
  const re = /(https?:\/\/[^\s,;]+)|((?:www\.|t\.me\/)[^\s,;]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:by|ru|com|net|org|shop|store)\b(?:\/[^\s,;]*)?)|(@[A-Za-z][A-Za-z0-9_]{3,31})|(\+?\d[\d\s()-]{7,}\d)/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const href = m[1] ? t : m[2] ? 'https://' + t : m[3] ? 'https://t.me/' + t.slice(1) : telHref(t);
    out.push(h('a', { href, target: '_blank', rel: 'noopener', text: t }));
    last = m.index + t.length;
  }
  out.push(text.slice(last));
  return out;
}

export const SVC = {
  b: 'Аккумулятор', d: 'Дисплей', p: 'Разъём зарядки', c: 'Задняя крышка', g: 'Проклейка',
  cr: 'Задняя камера', cf: 'Фронтальная камера', ls: 'Громкий динамик', es: 'Слуховой динамик', vb: 'Вибромотор', fp: 'Сканер отпечатка',
  bt: 'Шлейф кнопок', fx: 'Межплатный шлейф', fo: 'Другой шлейф', hs: 'Корпус', cg: 'Стекло камеры', sim: 'SIM-лоток',
  tc: 'Тачскрин', gl: 'Стекло экрана',
};
export const VAR_APP = {
  copy: 'Копия', copy_boost: 'Копия усиленная', verified: 'Копия без ошибки', copy_lcd: 'Копия ЖК (In-Cell, TFT)', copy_oled: 'Копия OLED',
  orig_reglass: 'Оригинал, переклей', orig_used: 'Оригинал, снятый', orig_new: 'Оригинал новый',
  gd: 'дисплея', gc: 'задней крышки', gb: 'батареи',
};
// Как на сайте
export const VAR_CLIENT = {
  copy: 'Копия', copy_boost: 'Копия усиленная', verified: 'Копия без ошибки', copy_lcd: 'Копия', copy_oled: 'Копия OLED',
  orig_reglass: 'Оригинал, переклей', orig_used: 'Оригинал, снятый', orig_new: 'Оригинал',
};
export const REPAIR = {
  b: 'Замена аккумулятора', d: 'Замена дисплея', p: 'Замена разъёма зарядки', c: 'Замена задней крышки',
  cr: 'Замена задней камеры', cf: 'Замена фронтальной камеры', ls: 'Замена громкого динамика', es: 'Замена слухового динамика', vb: 'Замена вибромотора',
  fp: 'Замена сканера отпечатка', bt: 'Замена шлейфа кнопок', fx: 'Замена межплатного шлейфа', fo: 'Замена шлейфа (вспышка, микрофон, датчики, SIM)',
  hs: 'Замена корпуса', cg: 'Замена стекла камеры', sim: 'Замена SIM-лотка', tc: 'Замена тачскрина', gl: 'Замена стекла экрана (переклейка)',
};

// «Копия ЖК (In-Cell, TFT)» → «копия ЖК (In-Cell, TFT)»: сокращения не трогаем
export const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

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
  // combo — комплекс: ремонт → вариант детали (по одному на ремонт), для открытой модели
  const st = { q: '', model: null, svc: store.get('svc', 'd'), overrides: new Map(), open: new Set(), showHidden: false, combo: new Map() };
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
  const modelScreen = h('div', { class: 'model-screen' });
  // «Скопировать клиенту» — отдельно от экрана модели: у сдвинутого свайпом экрана fixed-кнопки съехали бы вниз
  const dock = h('div', { class: 'dock' });

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
          h('div', { class: 'small faint', style: 'margin-top:6px' }, 'Ищи по-русски и с ошибками: «айфон 14 про», «самсунг а52», «поко х6», «пиксель 6».')),
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

  // push: false — модель открыта из истории браузера (кнопка «вперёд»), новый шаг не нужен
  function openModel(name, push = true) {
    if (push) {
      const state = { fcModel: name };
      if (history.state && history.state.fcModel) history.replaceState(state, '');
      else history.pushState(state, '');
    }
    st.model = name;
    st.combo = new Map();
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
    shift(0);
    window.scrollTo(0, 0);
  }

  // Назад к поиску: открытая модель — шаг в истории браузера, его и снимаем (закроет popstate)
  function back() {
    if (history.state && history.state.fcModel) history.back();
    else closeModel();
  }

  // Кнопка «назад» браузера и мыши, жест Safari, «назад» на Android, Esc на компьютере — к поиску
  if (history.state && history.state.fcModel) history.replaceState(null, ''); // после перезагрузки открыт поиск
  window.addEventListener('popstate', (ev) => {
    const name = ev.state && ev.state.fcModel;
    if (name && app.pricer.byName.has(name)) { if (st.model !== name) openModel(name, false); }
    else if (st.model) closeModel();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && st.model && !root.hidden && !document.querySelector('.sheet')) back();
  });

  // Свайп от левого края экрана — назад к поиску, как в приложениях айфона. У веб-приложения на экране «Домой» такого
  // жеста нет, поэтому делаем свой; в Safari браузер листает историю сам (popstate выше), там свой не включаем
  const EDGE = 28;
  const standalone = navigator.standalone === true || (!!window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  let drag = null;
  function shift(x) {
    for (const el of [modelScreen, dock]) el.style.transform = x ? 'translateX(' + x + 'px)' : '';
  }
  document.addEventListener('touchstart', (ev) => {
    drag = null;
    if (!standalone || !st.model || root.hidden || ev.touches.length !== 1 || document.querySelector('.sheet')) return;
    const t = ev.touches[0];
    if (t.clientX <= EDGE) drag = { x: t.clientX, y: t.clientY, dx: 0, on: false, at: Date.now() };
  }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (!drag) return;
    const t = ev.touches[0];
    const dx = t.clientX - drag.x;
    const dy = t.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; } // листает вверх-вниз
      if (dx < 10) return;
      drag.on = true;
      root.classList.add('swiping');
    }
    ev.preventDefault();
    drag.dx = Math.max(0, dx);
    shift(drag.dx);
  }, { passive: false });
  // отпустил дальше трети экрана или резко смахнул — назад, иначе экран возвращается на место
  const release = (cancel) => {
    const d = drag;
    drag = null;
    if (!d || !d.on) return;
    root.classList.remove('swiping');
    const fast = d.dx > 40 && d.dx / Math.max(1, Date.now() - d.at) > 0.6;
    if (!cancel && (d.dx > window.innerWidth / 3 || fast)) {
      shift(window.innerWidth);
      setTimeout(back, 160);
    } else shift(0);
  };
  document.addEventListener('touchend', () => release(false));
  document.addEventListener('touchcancel', () => release(true));

  // Название модели в закреплённой строке «‹ Поиск» появляется, когда большой заголовок уехал под неё
  let titleWatch = null;
  function watchTitle(bar, title) {
    if (titleWatch) titleWatch.disconnect();
    if (!('IntersectionObserver' in window)) return;
    titleWatch = new IntersectionObserver(([en]) => bar.classList.toggle('stuck', !en.isIntersecting && en.boundingClientRect.top < 80),
      { rootMargin: '-64px 0px 0px 0px' });
    titleWatch.observe(title);
  }

  function priceOf(entry, svc, o) {
    const ov = st.overrides.get(entry.model + '|' + svc + '|' + o.tier);
    if (!ov) return { price: o.price, formula: o.formula, smartfix: o.smartfix, cost: o.cost, sup: o.sup, part: o.part, stock: o.stock, inStock: o.inStock, override: false };
    const cp = clientPrice(app.pricer.S, o.work, ov.cost, o.sf, riskReserve(app.pricer.S, svc, ov.cost));
    return { ...cp, cost: ov.cost, sup: ov.sup, part: ov.name, stock: ov.stock, inStock: app.pricer.inStock(ov), override: true };
  }

  function stockBadge(sup, stock) {
    if (sup === OWN) return h('span', { class: 'badge info', text: 'своя цена' });
    const s = app.data.suppliers[sup];
    if (!s || !s.stock) return h('span', { class: 'badge warn', text: 'уточнить наличие' });
    if (stock === 'В наличии') return h('span', { class: 'badge good', text: 'в наличии' });
    return h('span', { class: 'badge bad', text: (stock || 'нет в наличии').toLowerCase() });
  }

  function supName(key) {
    const s = app.pricer.data.suppliers[key];
    return (s && s.name) || key;
  }

  function supSite(key) {
    const s = app.data.suppliers[key] || {};
    const r = (app.repoData && app.repoData.suppliers[key]) || {};
    return (s.site !== undefined ? s.site : r.site) || null; // пустая строка — сайт убрали
  }

  // Одно нажатие: название детали в буфер и сайт поставщика в новой вкладке — останется вставить в поиск
  function siteButton(sup, partName, small) {
    const site = supSite(sup);
    if (!site) return null;
    const host = site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return h('a', {
      class: small ? 'link' : 'btn small block', style: small ? 'margin-left:6px' : 'margin-top:8px', href: site, target: '_blank', rel: 'noopener',
      onclick: () => { copyText(partName); toast('Название скопировано: вставь его в поиск на сайте', 3500); },
    }, small ? 'сайт ↗' : 'Открыть ' + host + ' ↗');
  }

  // Проклейка к ремонту: что взять и где; на цену клиенту не влияет, только на заработок
  function glueRow(g) {
    if (g.fallback) return h('div', { class: 'glue' }, h('span', { class: 'small', text: 'Проклейка: ' + money(g.cost) }), h('span', { class: 'tiny faint', text: ' · ' + g.name }));
    return h('div', { class: 'glue' },
      h('button', {
        class: 'glue-name', 'aria-label': 'Скопировать название проклейки',
        onclick: async () => { if (await copyText(g.name)) toast('Название проклейки скопировано'); },
      },
      h('span', { class: 'small' }, 'Проклейка ' + GLUE_NAME[g.type] + ': ', h('b', { text: money(g.cost) }), g.pack ? h('span', { class: 'faint', text: ' (штука из набора)' }) : null),
      h('span', { class: 'tiny muted break', style: 'display:block', text: supName(g.sup) + ' · ' + g.name })),
      h('span', { class: 'glue-side' }, stockBadge(g.sup, g.stock), siteButton(g.sup, g.name, true)));
  }

  function variantCard(entry, svc, o) {
    const S = app.pricer.S;
    const p = priceOf(entry, svc, o);
    const key = entry.model + '|' + svc + '|' + o.tier;
    const glue = app.pricer.glueFor(entry.model, svc);
    const earn = p.price - p.cost - glue.total;
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
      h('div', { class: 'earn' }, 'заработок ', h('b', { text: money(Math.round(earn * 100) / 100) }), ' · деталь ', money(p.cost),
        glue.total ? ' · проклейка ' + money(glue.total) : '', ' · работа ', o.work, ' р.',
        riskReserve(S, svc, p.cost) ? ' · запас на брак ' + money(Math.round(riskReserve(S, svc, p.cost) * 100) / 100) : '',
        h('span', { class: 'faint', text: ' · налог ' + Math.round(p.price * S.tax) + ' р.' })),
      h('button', {
        class: 'part', 'aria-label': 'Скопировать название детали',
        onclick: async () => { if (await copyText(p.part)) toast('Название детали скопировано'); },
      },
      h('span', { class: 'sup' }, supName(p.sup), stockBadge(p.sup, p.stock), p.override ? h('span', { class: 'badge info', text: 'выбрана вручную' }) : null,
        h('span', { class: 'copyhint' }, 'копировать')),
      h('span', { class: 'pname', text: p.part }),
      !p.override && o.colours > 1 ? h('span', { class: 'tiny faint', text: 'Цветов: ' + o.colours + ', цена по самому дорогому' }) : null),
      siteButton(p.sup, p.part),
      o.ownId && !p.override ? ownLine(entry, svc, o.ownId) : null,
      note ? h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Как заказать: ', linkify(note)) : null,
      glue.items.map((g) => glueRow(g)),
      o.alt && !p.override ? h('div', { class: 'alt' }, 'Второй поставщик: ', h('b', { text: supName(o.alt.sup) + ' — ' + money(o.alt.cost) }), ' ', stockBadge(o.alt.sup, o.alt.stock),
        siteButton(o.alt.sup, o.alt.part, true),
        h('div', { class: 'tiny faint break', text: o.alt.part })) : null,
      h('div', { class: 'sfline', text: sfText }),
      o.hidden ? h('div', { class: 'tiny', style: 'color:var(--accent);margin-top:6px', text: 'Скрыт: не дешевле варианта получше' }) : null,
      h('div', { class: 'actions wrap' },
        h('button', { class: 'btn small primary', onclick: () => app.newOrderFromPrice(entry, svc, o, p) }, 'Записать заказ'),
        h('button', {
          class: 'btn small' + (st.combo.get(svc) === o.tier ? ' on' : ''),
          onclick: () => { if (st.combo.get(svc) === o.tier) st.combo.delete(svc); else st.combo.set(svc, o.tier); draw(); },
        }, st.combo.get(svc) === o.tier ? '✓ В комплексе' : 'В комплекс'),
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

  // Своя деталь в карточке: когда вписана и кнопка «Изменить»
  function ownLine(entry, svc, id) {
    const item = (app.settings.ownParts || []).find((x) => x.id === id);
    if (!item) return null;
    return h('div', { class: 'row', style: 'margin-top:8px' },
      h('div', { class: 'tiny faint grow', text: 'Цена детали вписана ' + fmtDate(item.date) + '. Обновлять её при загрузке прайсов не будет.' }),
      h('button', { class: 'btn small', text: 'Изменить', onclick: () => openOwnPart(app, entry, svc, item) }));
  }

  // Почему нет деталей и что делать: своя деталь, а у айфонов с лазером ещё и корпус
  function emptyState(e, svc, noParts) {
    const laser = svc === 'c' && e.model.startsWith('iPhone') && !app.pricer.noLaser.has(e.model);
    const hs = e.services.hs.opts.filter((o) => !o.hidden);
    const hsFrom = hs.length ? Math.min(...hs.map((o) => priceOf(e, 'hs', o).price)) : null;
    let why;
    if (laser) {
      why = h('div', {}, 'На этой модели заднее стекло снимается только лазером, поэтому крышки из прайса здесь не считаются.',
        h('br'), 'Если делаешь с лазером (сам или отдаёшь) — впиши свою деталь или добавь модель в «Ещё → Расчёт цены → Модели без лазера».',
        hsFrom ? h('div', { style: 'margin-top:8px' }, 'Без лазера меняют корпус целиком.') : null);
    } else if (noParts) {
      why = h('div', {}, 'Деталей для этой модели в прайсе пока нет.', h('br'), 'Если они есть у поставщика — загрузи его свежий прайс: «Ещё» → «Прайсы поставщиков». Или впиши свою деталь.');
    } else {
      why = h('div', {}, 'У поставщиков нет детали для этого ремонта.', h('br'), 'Купил или нашёл её в другом месте — впиши цену детали, приложение посчитает цену клиенту.');
    }
    return h('div', { class: 'empty' }, why,
      h('div', { class: 'row wrap', style: 'justify-content:center;margin-top:14px' },
        h('button', { class: 'btn small primary', text: '+ Своя деталь', onclick: () => openOwnPart(app, e, svc, null) }),
        laser && hsFrom ? h('button', { class: 'btn small', text: 'Корпус · от ' + hsFrom + ' р.', onclick: () => { st.svc = 'hs'; store.set('svc', 'hs'); draw(); } }) : null));
  }

  // Комплекс: выбранные ремонты, скидка на работу, итог и заработок
  function comboItems(entry) {
    const out = [];
    for (const [svc, tier] of st.combo) {
      const o = entry.services[svc].opts.find((x) => x.tier === tier);
      if (!o) continue;
      const p = priceOf(entry, svc, o);
      out.push({ svc, tier, o, p, price: p.price, work: o.work, cost: p.cost });
    }
    return out;
  }

  function comboText(entry) {
    const items = comboItems(entry);
    const t = comboTotal(app.pricer.S, items);
    const lines = [entry.model + ' — комплексный ремонт:'];
    for (const x of items) lines.push('• ' + REPAIR[x.svc] + ' (' + lcFirst(VAR_CLIENT[x.tier]) + ') — ' + x.price + ' р.');
    if (t.discount) lines.push('Скидка за комплекс (' + app.pricer.S.combo_discount + '% на работу): −' + t.discount + ' р.');
    lines.push('Итого: ' + t.total + ' р.');
    const foot = (app.settings.clientFooter || '').trim();
    if (foot) lines.push('', foot);
    return lines.join('\n');
  }

  function comboCard(entry) {
    const items = comboItems(entry);
    if (!items.length) return null;
    const S = app.pricer.S;
    const t = comboTotal(S, items);
    // проклейка на весь комплекс: телефон вскрывается один раз
    const glue = app.pricer.glueFor(entry.model, items.map((x) => x.svc)).total;
    const earn = items.reduce((a, x) => a + x.price - x.cost, 0) - glue - t.discount;
    return h('div', { class: 'card combo' },
      h('div', { class: 'head' }, h('div', { class: 'vname', text: 'Комплекс · ' + items.length }), h('div', { class: 'price', text: t.total + ' р.' })),
      items.map((x) => h('div', { class: 'small' }, SVC[x.svc] + ' — ' + lcFirst(VAR_APP[x.tier]) + ': ' + x.price + ' р.')),
      t.discount ? h('div', { class: 'small', style: 'margin-top:6px' }, 'Скидка ' + S.combo_discount + '% на работу второго и следующих: ', h('b', { text: '−' + t.discount + ' р.' })) : h('div', { class: 'tiny faint', style: 'margin-top:6px', text: 'Добавь второй ремонт — будет скидка ' + S.combo_discount + '% на его работу.' }),
      h('div', { class: 'earn', style: 'margin-top:6px' }, 'заработок ', h('b', { text: money(Math.round(earn * 100) / 100) }), glue ? ' · проклейка ' + money(glue) : ''),
      h('div', { class: 'actions wrap' },
        h('button', {
          class: 'btn small primary',
          onclick: () => (items.length === 1 ? app.newOrderFromPrice(entry, items[0].svc, items[0].o, items[0].p) : app.newOrderFromCombo(entry, items, t)),
        }, 'Записать заказ'),
        h('button', { class: 'btn small', onclick: async () => { if (await copyText(comboText(entry))) toast('Комплекс скопирован'); } }, icon('copy'), 'Скопировать клиенту'),
        h('button', { class: 'btn small', text: 'Очистить', onclick: () => { st.combo.clear(); draw(); } })));
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
    const noParts = SERVICES.every((svc) => !e.services[svc].opts.length);
    const coefs = 'сложность ×' + String(diffCoef(S, e)).replace('.', ',') + ', новизна ×' + String(noveltyCoef(S, e)).replace('.', ',');
    const title = h('h1', { text: e.model });
    const bar = h('div', { class: 'topbar' }, h('button', { class: 'back', onclick: back }, icon('back'), 'Поиск'), h('span', { class: 'tb-title', text: e.model }));
    fill(modelScreen, 
      bar,
      title,
      h('div', { class: 'small muted', text: [e.year ? e.year + ' г.' : null, 'iFixit ' + (e.ifixit ?? 'нет оценки'), coefs].filter(Boolean).join(' · ') }),
      // ремонты сайта — всегда, остальные — только если есть детали
      h('div', { class: 'repairs' }, SERVICES.filter((svc) => SITE_SERVICES.includes(svc) || e.services[svc].opts.length).map((svc) => {
        const vis = e.services[svc].opts.filter((o) => !o.hidden);
        const from = vis.length ? Math.min(...vis.map((o) => priceOf(e, svc, o).price)) : null;
        // и без деталей вкладка открывается: там можно вписать свою деталь
        return h('button', {
          class: 'repair' + (svc === st.svc ? ' on' : '') + (vis.length ? '' : ' none'),
          onclick: () => { st.svc = svc; store.set('svc', svc); draw(); },
        }, h('span', { class: 'name', text: SVC[svc] }), h('span', { class: 'from', text: from ? 'от ' + from + ' р.' : 'нет деталей' }));
      })),
      comboCard(e),
      visible.length ? h('div', { class: 'variants' }, visible.map((o) => variantCard(e, st.svc, o))) : emptyState(e, st.svc, noParts),
      visible.length ? h('button', { class: 'link', style: 'margin-top:8px;display:block', text: '+ Своя деталь (не из прайса)', onclick: () => openOwnPart(app, e, st.svc, null) }) : null,
      hidden.length ? h('button', { class: 'link', style: 'margin-top:8px', onclick: () => { st.showHidden = !st.showHidden; draw(); } },
        st.showHidden ? 'Не показывать скрытые варианты' : 'Скрытые варианты: ' + hidden.length + ' (не дешевле варианта получше)') : null,
      st.showHidden ? h('div', { class: 'variants', style: 'margin-top:12px' }, hidden.map((o) => variantCard(e, st.svc, o))) : null,
      h('div', { class: 'small faint', style: 'margin-top:14px', text: 'Работа ' + svcData.work + ' р. Цена = (работа + деталь) / (1 − ' + String(S.tax).replace('.', ',') + '), округление до ' + S.round + ' р., сверка с SmartFix.' }),
    );
    fill(dock, h('div', { class: 'inner' },
      h('button', {
        class: 'btn primary', disabled: !visible.length,
        onclick: async () => { if (await copyText(clientText(e, [st.svc]))) toast('Текст для клиента скопирован'); },
      }, icon('copy'), 'Скопировать клиенту'),
      h('button', {
        class: 'btn', 'aria-label': 'Скопировать все ремонты',
        onclick: async () => { if (await copyText(clientText(e, SERVICES))) toast('Все ремонты скопированы'); },
      }, 'Все')));
    fill(root, modelScreen, dock);
    watchTitle(bar, title);
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

// Своя деталь: у поставщиков её нет или берёшь в другом месте — вписываешь цену детали, приложение считает цену клиенту
// так же, как для деталей из прайса. Хранится в настройках (и в их копии в таблице), попадает и в файл цен для сайта.
export function openOwnPart(app, entry, svc, item) {
  const S = app.pricer.S;
  const tiers = ORDER[svc];
  const x = item ? { ...item } : { tier: tiers[0], cost: null, name: '' };
  const work = workFee(S, svc, entry);
  const preview = h('div', { class: 'card', style: 'margin-top:16px' });
  const update = () => {
    if (!(x.cost > 0)) {
      fill(preview, h('div', { class: 'small muted', text: 'Впиши цену детали — покажу цену клиенту и заработок.' }));
      return;
    }
    const key = sfKey(svc, x.tier);
    const sf = key && entry.sf ? entry.sf[key] : null;
    const cp = clientPrice(S, work, x.cost, sf, riskReserve(S, svc, x.cost));
    const glue = app.pricer.glueFor(entry.model, svc).total;
    const earn = Math.round((cp.price - x.cost - glue) * 100) / 100;
    fill(preview,
      h('div', { class: 'row' }, h('div', { class: 'grow small muted', text: 'Цена клиенту' }), h('b', { style: 'font-size:24px', text: cp.price + ' р.' })),
      h('div', { class: 'small muted', style: 'margin-top:4px' }, 'заработок ', h('b', { style: 'color:var(--good)', text: money(earn) }),
        ' · деталь ', money(x.cost), glue ? ' · проклейка ' + money(glue) : '', ' · работа ', work, ' р.'),
      cp.smartfix ? h('div', { class: 'tiny faint', style: 'margin-top:4px', text: 'Сверено с SmartFix: у них ' + cp.smartfix + ' р.' }) : null);
  };
  const body = h('div', {},
    h('div', { class: 'small muted', style: 'margin-top:8px', text: entry.model + ' · ' + REPAIR[svc] }),
    tiers.length > 1 ? field('Какая деталь', select(tiers.map((t) => ({ value: t, label: VAR_APP[t] })), x.tier, (v) => { x.tier = v; update(); })) : null,
    field('Цена детали, р.', h('input', {
      class: 'input num', inputmode: 'decimal', value: x.cost ?? '', placeholder: 'сколько платишь за деталь',
      oninput: (e) => { x.cost = parseNum(e.target.value); update(); },
    })),
    field('Где взять, название', h('input', {
      class: 'input', value: x.name || '', placeholder: 'Kufar, AliExpress, с донора…', autocomplete: 'off',
      oninput: (e) => { x.name = e.target.value; },
    })),
    preview,
    h('div', { class: 'tiny faint', style: 'margin-top:10px', text: 'Цена клиенту считается по той же формуле, что для деталей из прайса. Свою деталь видно только в этом ремонте этой модели; на сайт она попадёт при следующем «Обновить цены на сайте».' }));
  update();
  const save = () => {
    if (!(x.cost > 0)) { toast('Впиши цену детали'); return; }
    const rest = (app.settings.ownParts || []).filter((y) => y.id !== x.id);
    const next = { id: x.id || newId(), model: entry.model, svc, tier: x.tier, cost: x.cost, name: (x.name || '').trim(), date: today() };
    app.saveSettings({ ownParts: [...rest, next] });
    sheet.close();
    toast(item ? 'Своя деталь сохранена' : 'Своя деталь добавлена');
  };
  const remove = () => {
    if (!confirm('Убрать свою деталь «' + (item.name || VAR_APP[item.tier]) + '»?')) return;
    app.saveSettings({ ownParts: (app.settings.ownParts || []).filter((y) => y.id !== item.id) });
    sheet.close();
    toast('Своя деталь убрана');
  };
  const sheet = openSheet(item ? 'Своя деталь' : 'Своя деталь · ' + SVC[svc], body, [
    item ? h('button', { class: 'btn danger', text: 'Убрать', onclick: remove }) : h('button', { class: 'btn', text: 'Отмена', onclick: () => sheet.close() }),
    h('button', { class: 'btn primary', text: 'Сохранить', onclick: save }),
  ]);
}
