// Связь с Google Таблицей через Apps Script.
// Изменения сначала ложатся в очередь на телефоне и уходят в таблицу, как только есть интернет.
// Каждое изменение с id: если ответ потерялся и запрос ушёл второй раз, строка не задвоится.

import { store, newId } from './store.js';
import { DEFAULT_LISTS } from './orders.js';

const blank = (v) => (v === '' || v === undefined ? null : v);
// Версия скрипта таблицы, которая нужна приложению (apps-script/Code.gs, VERSION): 3 — гарантийные заказы Г1, Г2…
export const SCRIPT_VERSION = 3;
// С какой версии скрипт умеет удалять заказ
export const DELETE_VERSION = 4;
// С какой версии скрипт работает с выкупленными устройствами (листы «Устройства» и «Запчасти»)
export const DEVICES_VERSION = 5;

export class SheetSync {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.cfg = store.get('sheet');
    this.outbox = store.get('outbox', []);
    this.failed = store.get('failed', []);
    this.cache = store.get('orders');
    // Что уже добавлено в таблицу: id операции → номер и строка (чтобы править только что созданное)
    this.sent = store.get('sent', {});
    this.inflight = new Set();
    this.busy = false;
    this.error = null;
  }

  get connected() {
    return !!(this.cfg && this.cfg.url && this.cfg.key);
  }

  get lists() {
    return { ...DEFAULT_LISTS, ...((this.cache && this.cache.lists) || {}) };
  }

  // Версия скрипта таблицы: с 3-й он нумерует гарантийные заказы отдельно (Г1, Г2…) и при формуле в «№». null — список ещё не загружен
  get version() {
    return this.cache ? this.cache.version || 1 : null;
  }

  configure(cfg) {
    this.cfg = cfg;
    if (cfg) store.set('sheet', cfg);
    else {
      store.remove('sheet');
      store.remove('orders');
      this.cache = null;
    }
  }

  save() {
    store.set('outbox', this.outbox);
    store.set('failed', this.failed);
  }

  async call(op, payload = {}, cfg = this.cfg) {
    let res;
    try {
      res = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ ...payload, op, key: cfg.key }), redirect: 'follow' });
    } catch {
      const err = new Error('Скрипт таблицы не ответил приложению. Проверь интернет и настройки развертывания.');
      err.network = true;
      throw err;
    }
    if (!res.ok) throw new Error('Таблица ответила ошибкой ' + res.status);
    let j;
    try {
      j = await res.json();
    } catch {
      throw new Error('Таблица ответила не так, как ждали. Проверь адрес веб-приложения и доступ «Все».');
    }
    if (!j.ok) throw new Error(j.error || 'Ошибка в таблице');
    return j.data;
  }

  // --- Очередь изменений. extra — признаки самой операции, например { warranty: true } для гарантийного заказа
  add(kind, fields, extra) {
    const op = { id: newId(), op: kind, fields, at: Date.now(), ...extra };
    this.outbox.push(op);
    this.save();
    this.onChange();
    this.flush();
    return op.id;
  }

  update(kind, target, fields) {
    const ref = target.pendingId || null;
    // Правка ещё не отправленной строки: дописываем в саму очередь, если она сейчас не в пути
    const queued = ref && !this.inflight.has(ref) ? this.outbox.find((o) => o.id === ref) : null;
    if (queued) Object.assign(queued.fields, fields);
    else {
      // Строка уже ушла (или уходит): номер знаем из ответа таблицы, а если ещё нет — таблица найдёт его по ref
      const sent = ref ? this.sent[ref] : null;
      this.outbox.push({
        id: newId(), op: kind, ref: ref || undefined,
        num: target.num ?? (sent ? sent.num : null), row: target.row ?? (sent ? sent.row : null),
        was: target.was || (sent ? sent.was : undefined), fields, at: Date.now(),
      });
    }
    this.save();
    this.onChange();
    this.flush();
  }

  // Удалить заказ (kind — deleteDevice, deletePart для выкупа). Ещё не ушедшее в таблицу просто убираем из очереди
  // вместе с его правками, а у устройства — и с его запчастями
  remove(target, kind = 'deleteOrder') {
    const ref = target.pendingId || null;
    if (ref && !this.inflight.has(ref) && this.outbox.some((o) => o.id === ref)) {
      const gone = new Set([ref]);
      for (let more = true; more;) {
        more = false;
        for (const o of this.outbox) {
          if (!gone.has(o.id) && (gone.has(o.ref) || gone.has(o.dref))) { gone.add(o.id); more = true; }
        }
      }
      this.outbox = this.outbox.filter((o) => !gone.has(o.id));
    } else {
      const sent = ref ? this.sent[ref] : null;
      this.outbox.push({
        id: newId(), op: kind, ref: ref || undefined,
        num: target.num ?? (sent ? sent.num : null), row: target.row ?? (sent ? sent.row : null),
        was: target.was || (sent ? sent.was : undefined), fields: {}, at: Date.now(),
      });
    }
    this.save();
    this.onChange();
    this.flush();
  }

  dropFailed(id) {
    this.failed = this.failed.filter((f) => f.id !== id);
    this.save();
    this.onChange();
  }

  // Отправить очередь. Если отправка уже идёт, дождаться её и отправить ещё раз то, что добавилось.
  flush() {
    if (!this.connected || !this.outbox.length) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.again = false;
    this.running = this.send().finally(() => {
      this.running = null;
      if (this.again && this.outbox.length) return this.flush();
      return undefined;
    });
    return this.running;
  }

  async send() {
    this.busy = true;
    this.onChange();
    const ops = this.outbox.slice();
    this.inflight = new Set(ops.map((o) => o.id));
    try {
      const results = await this.call('batch', { ops });
      const byId = new Map(results.map((r) => [r.id, r]));
      this.outbox = this.outbox.filter((o) => !byId.has(o.id));
      for (const op of ops) {
        const r = byId.get(op.id);
        if (r && !r.ok) this.failed.push({ ...op, error: r.error });
        if (r && r.ok && ['addOrder', 'addExpense', 'addDevice', 'addPart'].includes(op.op)) {
          const f = op.fields || {};
          let was;
          if (op.op === 'addExpense') was = { date: blank(f.date), what: blank(f.what), sum: blank(f.sum) };
          // номер устройства у запчасти могла подставить таблица (запчасть к только что добавленному устройству)
          if (op.op === 'addPart') was = { dnum: r.dnum ?? blank(f.dnum), name: blank(f.name), price: blank(f.price) };
          this.sent[op.id] = { num: r.num ?? null, row: r.row, was };
        }
      }
      const ids = Object.keys(this.sent);
      for (const id of ids.slice(0, Math.max(0, ids.length - 100))) delete this.sent[id];
      store.set('sent', this.sent);
      this.error = null;
      this.save();
      await this.load();
    } catch (e) {
      this.error = e.message;
    } finally {
      this.inflight = new Set();
      this.busy = false;
      this.onChange();
    }
  }

  async load() {
    if (!this.connected) return;
    const data = await this.call('list');
    this.cache = { ...data, at: Date.now() };
    store.set('orders', this.cache);
    this.error = null;
    this.onChange();
  }

  async refresh() {
    try {
      if (this.outbox.length) {
        this.again = true;
        await this.flush();
      } else {
        this.busy = true;
        this.onChange();
        await this.load();
      }
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  // Заказы с учётом ещё не отправленных изменений
  orders() {
    const list = ((this.cache && this.cache.orders) || []).map((o) => ({ ...o }));
    const byNum = new Map(list.map((o) => [String(o.num), o]));
    for (const op of this.outbox) {
      if (op.op === 'updateOrder' || op.op === 'deleteOrder') {
        const num = op.num ?? (op.ref && this.sent[op.ref] ? this.sent[op.ref].num : null);
        const o = num !== null && num !== undefined ? byNum.get(String(num)) : list.find((x) => x.pendingId && x.pendingId === op.ref);
        if (o && op.op === 'deleteOrder') o.deleted = true;
        else if (o) Object.assign(o, op.fields, { pending: true });
      } else if (op.op === 'addOrder') {
        list.push({ ...op.fields, num: null, row: null, pending: true, pendingId: op.id, warrantyOrder: op.warranty || undefined });
      }
    }
    return list.filter((o) => !o.deleted);
  }

  expenses() {
    const list = ((this.cache && this.cache.expenses) || []).map((e) => ({ ...e, was: { date: e.date, what: e.what, sum: e.sum } }));
    for (const op of this.outbox) {
      if (op.op === 'updateExpense') {
        const row = op.row ?? (op.ref && this.sent[op.ref] ? this.sent[op.ref].row : null);
        const e = row !== null && row !== undefined ? list.find((x) => x.row === row) : list.find((x) => x.pendingId && x.pendingId === op.ref);
        if (e) {
          Object.assign(e, op.fields, { pending: true });
          // Следующая правка должна искать строку уже с этими значениями: таблица применит правки по порядку
          if (e.row) e.was = { date: blank(e.date), what: blank(e.what), sum: blank(e.sum) };
        }
      } else if (op.op === 'addExpense') {
        list.push({ ...op.fields, row: null, pending: true, pendingId: op.id });
      }
    }
    return list;
  }

  // Листы выкупа («Устройства», «Запчасти») прочитаны: скрипт версии 5 и листы есть в таблице
  get devicesReady() {
    return !!(this.cache && Array.isArray(this.cache.devices));
  }

  // Выкупленные устройства с учётом ещё не отправленных изменений
  devices() {
    const list = ((this.cache && this.cache.devices) || []).map((d) => ({ ...d }));
    const byNum = new Map(list.map((d) => [String(d.num), d]));
    for (const op of this.outbox) {
      if (op.op === 'updateDevice' || op.op === 'deleteDevice') {
        const num = op.num ?? (op.ref && this.sent[op.ref] ? this.sent[op.ref].num : null);
        const d = num !== null && num !== undefined ? byNum.get(String(num)) : list.find((x) => x.pendingId && x.pendingId === op.ref);
        if (d && op.op === 'deleteDevice') d.deleted = true;
        else if (d) Object.assign(d, op.fields, { pending: true });
      } else if (op.op === 'addDevice') {
        list.push({ ...op.fields, num: null, row: null, pending: true, pendingId: op.id });
      }
    }
    return list.filter((d) => !d.deleted);
  }

  // Запчасти выкупленных устройств. was — по чему таблица найдёт строку при правке (строки сдвигаются при удалении)
  parts() {
    const wasOf = (p) => ({ dnum: blank(p.dnum), name: blank(p.name), price: blank(p.price) });
    const list = ((this.cache && this.cache.parts) || []).map((p) => ({ ...p, was: wasOf(p) }));
    const devices = this.devices();
    for (const op of this.outbox) {
      if (op.op === 'updatePart' || op.op === 'deletePart') {
        const row = op.row ?? (op.ref && this.sent[op.ref] ? this.sent[op.ref].row : null);
        const p = row !== null && row !== undefined ? list.find((x) => x.row === row) : list.find((x) => x.pendingId && x.pendingId === op.ref);
        if (p && op.op === 'deletePart') p.deleted = true;
        else if (p) {
          Object.assign(p, op.fields, { pending: true });
          if (p.row) p.was = wasOf(p);
        }
      } else if (op.op === 'addPart') {
        // к устройству, которое тоже ещё не дошло до таблицы: номер узнаем из ответа таблицы
        const dev = op.dref ? this.sent[op.dref] : null;
        const dnum = op.fields.dnum ?? (dev ? dev.num : null);
        list.push({ ...op.fields, dnum, row: null, pending: true, pendingId: op.id, dref: dnum === null ? op.dref : undefined });
      }
    }
    // запчасти удалённого устройства в таблице тоже удалятся
    const nums = new Set(devices.filter((d) => d.num !== null && d.num !== undefined).map((d) => String(d.num)));
    const refs = new Set(devices.filter((d) => d.pendingId).map((d) => d.pendingId));
    return list.filter((p) => !p.deleted && (p.dref ? refs.has(p.dref) : (p.dnum === null || p.dnum === undefined || nums.has(String(p.dnum)))));
  }

  // Адрес скрипта — один на все устройства. Новое развертывание скрипта даёт новый адрес: устройство с самым новым
  // скриптом оставляет свой адрес в таблице, а устройство со скриптом старее (через свой скрипт той же таблицы) читает его,
  // проверяет своим ключом и переключается. true — переключились
  async followUrl() {
    if (!this.connected || this.version === null) return false;
    const r = await this.backupGet('script');
    const saved = r && r.value ? JSON.parse(r.value) : null;
    if (saved && saved.url && saved.url !== this.cfg.url && saved.version > this.version) {
      const cfg = { ...this.cfg, url: saved.url };
      const info = await this.call('ping', {}, cfg);
      if (!(info && info.version > this.version)) return false;
      this.configure(cfg);
      await this.load();
      return true;
    }
    if (this.version >= SCRIPT_VERSION && !(saved && saved.version >= this.version)) {
      await this.backupSet('script', JSON.stringify({ url: this.cfg.url, version: this.version }), Date.now());
    }
    return false;
  }

  // Резервная копия данных приложения на служебном листе (данные зашифрованы)
  async backupGet(name) {
    return this.call('kvGet', { name });
  }

  async backupSet(name, value, ts) {
    return this.call('kvSet', { name, value, ts });
  }
}
