// «Федя чинит · мастер»: цены для клиента, поставщики, заработок, журнал заказов.
// Данные прайса лежат в data/prices.enc зашифрованными: открыть их можно только паролем.

import { h, fill, icon, toast } from './ui.js';
import { open, seal, deriveKeyBytes, fromB64, toB64 } from './crypto.js';
import { decode, encode } from './data.js';
import { Pricer, withOwnParts } from './engine.js';
import { ModelSearch } from './search.js';
import { store } from './store.js';
import { SheetSync } from './sheet.js';
import { createPricesView, REPAIR, VAR_APP, lcFirst } from './view-prices.js';
import { createOrdersView, openOrderForm } from './view-orders.js';
import { createSummaryView } from './view-summary.js';
import { createMoreView, openSheetSetup } from './view-more.js';

// ownParts — свои детали (цену вписал сам), см. withOwnParts в engine.js
const DEFAULT_SETTINGS = { clientFooter: 'Гарантия на работу 4 месяца.', clientHints: true, supplierNotes: {}, formula: null, ownParts: [], ts: 0 };
// Гарантия стала 4 месяца: прежнюю строку по умолчанию заменяем, свою строку мастера не трогаем
const OLD_FOOTER = 'Гарантия на работу 3 месяца.';
function withDefaults(s) {
  const out = { ...DEFAULT_SETTINGS, ...s };
  if (out.clientFooter === OLD_FOOTER) out.clientFooter = DEFAULT_SETTINGS.clientFooter;
  return out;
}

const app = {
  data: null,
  repoData: null,
  pricer: null,
  search: null,
  key: null,
  salt: null,
  iter: null,
  settings: withDefaults(store.get('settings', {})),
  sheet: null,
  views: {},
  tab: 'prices',

  setData(d) {
    this.data = d;
    this.pricer = this.makePricer();
    this.search = new ModelSearch(d.models);
  },

  // Расчёт по прайсам и своим деталям из настроек
  makePricer() {
    return new Pricer(withOwnParts(this.data, this.settings.ownParts), this.settings.formula);
  },

  redraw() {
    for (const [name, v] of Object.entries(this.views)) if (name === this.tab) v.draw();
    drawTabbar();
  },

  // redraw: false — для текстовых полей «Ещё»: перерисовка сбросила бы фокус
  saveSettings(patch, opts = {}) {
    const next = { ...this.settings, ...patch, ts: Date.now() };
    if (patch.formula === null) next.formula = null;
    this.settings = next;
    store.set('settings', next);
    if ('formula' in patch || 'ownParts' in patch) this.pricer = this.makePricer();
    if (opts.redraw !== false) this.redraw();
    backupSettings();
  },

  newOrderFromPrice(entry, svc, o, p) {
    // в «Запчасть» — деталь вместе с проклейкой: это расход на ремонт
    const glue = this.pricer.glueFor(entry.model, svc);
    openOrderForm(this, null, {
      device: 'Телефон', model: entry.model, problem: REPAIR[svc] + ' (' + lcFirst(VAR_APP[o.tier]) + ')',
      price: p.price, part: Math.round((p.cost + glue.total) * 100) / 100,
      comment: 'Деталь: ' + partNote(p) + glueNote(glue),
    });
    if (!this.sheet.connected) toast('Таблица не подключена: заказ уйдёт в неё после подключения', 4000);
  },

  // Комплекс одним заказом: цена со скидкой, в «Запчасть» — все детали и проклейка на весь комплекс (вскрытие одно)
  newOrderFromCombo(entry, items, t) {
    const glue = this.pricer.glueFor(entry.model, items.map((x) => x.svc));
    const parts = items.reduce((a, x) => a + x.cost, 0);
    openOrderForm(this, null, {
      device: 'Телефон', model: entry.model,
      problem: 'Комплекс: ' + items.map((x) => lcFirst(REPAIR[x.svc]) + ' (' + lcFirst(VAR_APP[x.tier]) + ')').join(', '),
      price: t.total, part: Math.round((parts + glue.total) * 100) / 100,
      comment: (t.discount ? 'Без скидки ' + t.sum + ' р., скидка за комплекс ' + this.pricer.S.combo_discount + '% на работу: −' + t.discount + ' р. ' : '')
        + 'Детали: ' + items.map((x) => partNote(x.p)).join('; ') + glueNote(glue),
    });
    if (!this.sheet.connected) toast('Таблица не подключена: заказ уйдёт в неё после подключения', 4000);
  },

  openSheetSetup() {
    openSheetSetup(this);
  },

  async sheetKey() {
    const bytes = new Uint8Array([...this.key, ...new TextEncoder().encode('fedya-sheet-v1')]);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return toB64(hash).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
  },

  async scriptCode() {
    const res = await fetch('apps-script/Code.gs', { cache: 'no-cache' });
    if (!res.ok) throw new Error('Не загрузился код скрипта');
    const code = await res.text();
    return code.replace("'__KEY__'", JSON.stringify(await this.sheetKey()));
  },

  async applyData(next) {
    const cur = store.get('prices.local');
    const env = await seal(encode(next), this.key, this.salt, this.iter);
    store.set('prices.prev', cur || { repo: true });
    if (!store.set('prices.local', env)) throw new Error('на телефоне не хватило места');
    this.setData(decode(encode(next)));
    this.views.prices.reset();
    this.redraw();
    pricesChanged();
  },

  hasPrevData() {
    return !!store.get('prices.prev');
  },

  async restorePrevData() {
    const prev = store.get('prices.prev');
    if (!prev || !confirm('Вернуть прайсы, которые были до последнего обновления?')) return;
    const cur = store.get('prices.local');
    if (prev.repo) {
      store.remove('prices.local');
      this.setData(this.repoData);
    } else {
      this.setData(decode(await open(prev, this.key)));
      store.set('prices.local', prev);
    }
    if (cur) store.set('prices.prev', cur);
    else store.remove('prices.prev');
    pricesChanged();
    this.views.prices.reset();
    this.redraw();
    toast('Вернул прошлые прайсы');
  },

  afterSheetConnected() {
    this.sheet.flush();
    syncBackups();
  },

  async checkUpdate() {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (!reg) { location.reload(); return; }
    await reg.update();
    if (reg.installing || reg.waiting) toast('Загружаю новую версию…');
    else toast('Это последняя версия');
  },

  logout() {
    store.remove('key');
    location.reload();
  },
};

// Для комментария заказа: «поставщик — деталь цена р.» и «; проклейка: …»
function supName(k) {
  return (app.pricer.data.suppliers[k] || {}).name || k;
}

function partNote(p) {
  return supName(p.sup) + ' — ' + p.part + ' ' + p.cost + ' р.';
}

function glueNote(glue) {
  const text = glue.items.map((g) => (g.fallback ? 'клей/скотч ' : supName(g.sup) + ' — ' + g.name + ' ') + g.cost + ' р.').join('; ');
  return text ? '; проклейка: ' + text : '';
}

// --- Резервная копия настроек и прайсов в служебном листе таблицы (зашифрованы тем же ключом)
let settingsTimer = null;
function backupSettings() {
  if (!app.sheet || !app.sheet.connected) return;
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    try {
      const env = await seal(app.settings, app.key, app.salt, app.iter);
      await app.sheet.backupSet('settings', JSON.stringify(env), app.settings.ts || Date.now());
    } catch { /* попробуем при следующем изменении */ }
  }, 1500);
}

// Прайсы на телефоне поменялись (обновление или «вернуть прошлые»): запоминаем время и отправляем копию в таблицу.
// Пока копия не дошла, стоит флажок: при следующей связи с таблицей наша версия главнее.
function pricesChanged() {
  store.set('prices.ts', Date.now());
  store.set('prices.push', true);
  pushPrices();
}

async function pushPrices() {
  if (!app.sheet || !app.sheet.connected) return;
  const local = store.get('prices.local');
  try {
    // пустое значение — «прайс из приложения, своего обновления нет»
    await app.sheet.backupSet('prices', local ? JSON.stringify(local) : '', store.get('prices.ts', Date.now()));
    store.remove('prices.push');
  } catch { /* отправим при следующей связи */ }
}

async function syncBackups() {
  if (!app.sheet.connected) return;
  try {
    const rs = await app.sheet.backupGet('settings');
    if (rs && rs.value && rs.ts > (app.settings.ts || 0)) {
      const remote = await open(JSON.parse(rs.value), app.key);
      app.settings = withDefaults(remote);
      store.set('settings', app.settings);
      app.pricer = app.makePricer();
      app.redraw();
    } else if (app.settings.ts && (!rs || rs.ts < app.settings.ts)) {
      backupSettings();
    }
    if (store.get('prices.push')) { await pushPrices(); return; }
    const localTs = store.get('prices.ts', 0);
    const rp = await app.sheet.backupGet('prices');
    if (!rp) { if (localTs) await pushPrices(); return; }
    if (rp.ts > localTs) {
      // в таблице более свежее состояние (например, обновлял прайс с компьютера)
      if (rp.value) {
        const env = JSON.parse(rp.value);
        const remote = decode(await open(env, app.key));
        if (remote.priceDate < app.repoData.priceDate) return; // прайс в приложении новее этой копии
        store.set('prices.local', env);
        store.set('prices.ts', rp.ts);
        app.setData(remote);
        toast('Загрузил прайсы от ' + remote.priceDate.split('-').reverse().join('.') + ' из таблицы');
      } else {
        store.set('prices.ts', rp.ts);
        if (!store.get('prices.local')) return;
        store.remove('prices.local');
        app.setData(app.repoData);
      }
      app.views.prices.reset();
      app.redraw();
    } else if (rp.ts < localTs) {
      await pushPrices();
    }
  } catch { /* резервная копия не обязательна */ }
}

// --- Оболочка
const TABS = [['prices', 'Цены', 'tag'], ['orders', 'Заказы', 'list'], ['summary', 'Итоги', 'chart'], ['more', 'Ещё', 'more']];
const scrolls = {};
let tabbar = null;
let mainEl = null;

function drawTabbar() {
  if (!tabbar) return;
  const pending = app.sheet.outbox.length + app.sheet.failed.length;
  // название с логотипом — только в меню слева на компьютере
  fill(tabbar, h('div', { class: 'brand' }, h('img', { src: 'icons/icon-180.png', alt: '' }), 'Федя чинит'), ...TABS.map(([id, label, ic]) => h('button', {
    class: 'tab' + (app.tab === id ? ' on' : ''), 'aria-label': label, 'aria-current': app.tab === id ? 'page' : null,
    onclick: () => switchTab(id),
  }, icon(ic), label, id === 'orders' && pending ? h('span', { class: 'dot', text: String(pending) }) : null)));
}

function switchTab(id) {
  if (id === app.tab) {
    if (id === 'prices' && app.views.prices.model) { app.views.prices.draw(); }
    window.scrollTo(0, 0);
    return;
  }
  scrolls[app.tab] = window.scrollY;
  app.tab = id;
  for (const [name, v] of Object.entries(app.views)) v.el.hidden = name !== id;
  app.views[id].draw();
  drawTabbar();
  window.scrollTo(0, scrolls[id] || 0);
  if ((id === 'orders' || id === 'summary') && app.sheet.connected && (!app.sheet.cache || Date.now() - app.sheet.cache.at > 60000)) app.sheet.refresh();
}

function startUI() {
  app.sheet = new SheetSync(() => {
    if (app.tab === 'orders' || app.tab === 'summary') app.views[app.tab].draw();
    drawTabbar();
  });
  app.views = {
    prices: createPricesView(app),
    orders: createOrdersView(app),
    summary: createSummaryView(app),
    more: createMoreView(app),
  };
  for (const [name, v] of Object.entries(app.views)) v.el.classList.add('view-' + name);
  mainEl = h('main', { class: 'screen' }, Object.values(app.views).map((v) => v.el));
  tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Разделы' });
  fill(document.body, mainEl, tabbar);
  for (const [name, v] of Object.entries(app.views)) v.el.hidden = name !== app.tab;
  app.views[app.tab].draw();
  drawTabbar();
  if (app.sheet.connected) {
    app.sheet.refresh();
    syncBackups();
  }
  // Вернулся в приложение или появилась сеть: отправить очередь, а если список устарел или была ошибка — перечитать
  const syncNow = () => {
    if (!app.sheet.connected) return;
    const stale = !app.sheet.cache || Date.now() - app.sheet.cache.at > 60000;
    if (app.sheet.error || stale) app.sheet.refresh();
    else app.sheet.flush();
    if (store.get('prices.push')) pushPrices();
  };
  window.addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (pendingReload && !document.querySelector('.sheet')) { location.reload(); return; }
    syncNow();
  });
}

// --- Вход
// Прайс из сети, а при плохой связи — из кэша телефона, не дольше нескольких секунд ожидания
async function fetchBundle() {
  let cached = null;
  try { cached = 'caches' in window ? await caches.match('data/prices.enc') : null; } catch { cached = null; }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cached ? 4000 : 30000);
  try {
    const res = await fetch('data/prices.enc', { cache: 'no-cache', signal: ctrl.signal });
    if (!res.ok) throw new Error('Не загрузились данные прайса (' + res.status + ')');
    return await res.json();
  } catch (e) {
    if (cached) return cached.json();
    throw e.name === 'AbortError' ? new Error('Слишком медленный интернет') : e;
  } finally {
    clearTimeout(timer);
  }
}

async function unlock(keyBytes, env) {
  const repo = decode(await open(env, keyBytes));
  app.key = keyBytes;
  app.salt = fromB64(env.salt);
  app.iter = env.iter;
  app.repoData = repo;
  let data = repo;
  const localEnv = store.get('prices.local');
  if (localEnv) {
    let local = null;
    try { local = decode(await open(localEnv, keyBytes)); } catch { local = null; }
    if (local && local.priceDate >= repo.priceDate) data = local;
    else {
      // прайс в приложении новее своего обновления (или старый ключ): своё больше не нужно
      store.remove('prices.local');
      store.remove('prices.prev');
      store.set('prices.ts', Date.now());
      store.set('prices.push', true);
    }
  }
  app.setData(data);
}

function lockScreen(env, message) {
  const input = h('input', { class: 'input', type: 'password', placeholder: 'Пароль', autocomplete: 'current-password', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, enterkeyhint: 'go' });
  const err = h('div', { class: 'err', text: message || '' });
  const btn = h('button', { class: 'btn primary block', style: 'margin-top:12px', text: 'Открыть' });
  const go = async () => {
    if (!input.value.trim()) return;
    btn.disabled = true;
    fill(btn, h('span', { class: 'spin' }), ' Проверяю…');
    err.textContent = '';
    try {
      const key = await deriveKeyBytes(input.value, fromB64(env.salt), env.iter);
      await unlock(key, env);
      store.set('key', toB64(key));
      startUI();
    } catch {
      err.textContent = 'Пароль не подошёл';
      btn.disabled = false;
      btn.textContent = 'Открыть';
    }
  };
  btn.onclick = go;
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  fill(document.body, h('div', { class: 'lock' },
    h('img', { class: 'logo', src: 'icons/icon-180.png', alt: '' }),
    h('h1', { text: 'Федя чинит · мастер' }),
    h('div', { class: 'muted', text: 'Введи пароль один раз, телефон его запомнит.' }),
    h('form', { onsubmit: (e) => { e.preventDefault(); go(); } }, h('div', { style: 'margin-top:18px' }, input), btn),
    err));
  setTimeout(() => input.focus(), 50);
}

// --- Обновление приложения
let pendingReload = false;
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const started = Date.now();
  let had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had) { had = true; return; }
    if (Date.now() - started < 4000 && !document.querySelector('.sheet')) location.reload();
    else { pendingReload = true; toast('Приложение обновилось: перезапустится, когда вернёшься в него', 4000); }
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function main() {
  registerSW();
  let env;
  try {
    env = await fetchBundle();
  } catch (e) {
    fill(document.body, h('div', { class: 'lock' }, h('h1', { text: 'Нет связи' }), h('div', { class: 'muted', text: e.message + '. Открой приложение, когда появится интернет.' })));
    return;
  }
  const saved = store.get('key');
  if (!saved) { lockScreen(env); return; }
  try {
    await unlock(fromB64(saved), env);
    startUI();
  } catch {
    store.remove('key');
    lockScreen(env, 'Пароль поменялся, введи новый');
  }
}

main();
