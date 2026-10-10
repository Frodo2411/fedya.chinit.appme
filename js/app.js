// «Федя чинит · мастер»: цены для клиента, поставщики, заработок, журнал заказов.
// Данные прайса лежат в data/prices.enc зашифрованными: открыть их можно только паролем.

import { h, fill, icon, toast } from './ui.js';
import { open, seal, deriveKeyBytes, fromB64, toB64 } from './crypto.js';
import { decode, encode } from './data.js';
import { Pricer } from './engine.js';
import { ModelSearch } from './search.js';
import { store } from './store.js';
import { SheetSync } from './sheet.js';
import { createPricesView, REPAIR, VAR_APP } from './view-prices.js';
import { createOrdersView, openOrderForm } from './view-orders.js';
import { createSummaryView } from './view-summary.js';
import { createMoreView, openSheetSetup } from './view-more.js';

const DEFAULT_SETTINGS = { clientFooter: 'Гарантия на работу 3 месяца.', clientHints: true, supplierNotes: {}, formula: null, ts: 0 };

const app = {
  data: null,
  repoData: null,
  pricer: null,
  search: null,
  key: null,
  salt: null,
  iter: null,
  settings: { ...DEFAULT_SETTINGS, ...store.get('settings', {}) },
  sheet: null,
  views: {},
  tab: 'prices',

  setData(d) {
    this.data = d;
    this.pricer = new Pricer(d, this.settings.formula);
    this.search = new ModelSearch(d.models);
  },

  redraw() {
    for (const [name, v] of Object.entries(this.views)) if (name === this.tab) v.draw();
    drawTabbar();
  },

  saveSettings(patch) {
    const next = { ...this.settings, ...patch, ts: Date.now() };
    if (patch.formula === null) next.formula = null;
    this.settings = next;
    store.set('settings', next);
    if ('formula' in patch) this.pricer = new Pricer(this.data, next.formula);
    this.redraw();
    backupSettings();
  },

  newOrderFromPrice(entry, svc, o, p) {
    const sup = (this.data.suppliers[p.sup] || {}).name || p.sup;
    const variant = VAR_APP[o.tier];
    openOrderForm(this, null, {
      device: 'Телефон', model: entry.model, problem: REPAIR[svc] + ' (' + variant[0].toLowerCase() + variant.slice(1) + ')',
      price: p.price, part: p.cost, comment: 'Деталь: ' + sup + ' — ' + p.part,
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
    backupPrices(env);
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
      backupPrices(prev);
    }
    if (cur) store.set('prices.prev', cur);
    else store.remove('prices.prev');
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

function backupPrices(env) {
  if (!app.sheet || !app.sheet.connected) return;
  app.sheet.backupSet('prices', JSON.stringify(env), Date.now()).catch(() => {});
}

async function syncBackups() {
  if (!app.sheet.connected) return;
  try {
    const rs = await app.sheet.backupGet('settings');
    if (rs && rs.value && rs.ts > (app.settings.ts || 0)) {
      const remote = await open(JSON.parse(rs.value), app.key);
      app.settings = { ...DEFAULT_SETTINGS, ...remote };
      store.set('settings', app.settings);
      app.pricer = new Pricer(app.data, app.settings.formula);
      app.redraw();
    } else if (app.settings.ts && (!rs || rs.ts < app.settings.ts)) {
      backupSettings();
    }
    const rp = await app.sheet.backupGet('prices');
    if (rp && rp.value) {
      const env = JSON.parse(rp.value);
      const remote = decode(await open(env, app.key));
      if (remote.priceDate > app.data.priceDate) {
        store.set('prices.local', env);
        app.setData(remote);
        app.views.prices.reset();
        app.redraw();
        toast('Загрузил прайсы от ' + remote.priceDate.split('-').reverse().join('.') + ' из таблицы');
      }
    } else {
      const local = store.get('prices.local');
      if (local) backupPrices(local);
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
  fill(tabbar, ...TABS.map(([id, label, ic]) => h('button', {
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
  window.addEventListener('online', () => app.sheet.flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (pendingReload && !document.querySelector('.sheet')) { location.reload(); return; }
    if (app.sheet.connected) app.sheet.flush();
  });
}

// --- Вход
async function fetchBundle() {
  const res = await fetch('data/prices.enc', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Не загрузились данные прайса (' + res.status + ')');
  return res.json();
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
    try {
      const local = decode(await open(localEnv, keyBytes));
      if (local.priceDate >= repo.priceDate) data = local;
    } catch { /* старый ключ — используем прайс из приложения */ }
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
