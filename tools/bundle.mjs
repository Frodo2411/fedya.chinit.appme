#!/usr/bin/env node
// Сборка и правка зашифрованного пакета данных (data/prices.enc). Пароль — в переменной FC_PASSWORD.
//
//   node tools/bundle.mjs build <папка work из prais-tools> [data/prices.enc]   собрать из prais-tools
//   node tools/bundle.mjs decrypt [data/prices.enc] <out.json>                   расшифровать в JSON для правки
//   node tools/bundle.mjs encrypt <in.json> [data/prices.enc]                    зашифровать обратно (соль та же)
//   node tools/bundle.mjs site [data/prices.enc] <prices-models.js>              файл цен для сайта
//
// Соль берётся из существующего файла, чтобы на телефоне не пришлось заново вводить пароль.
// Названия поставщиков в открытом коде не пишем: при сборке они берутся из прошлого пакета
// или из FC_SUPPLIERS='E=Имя первого,P=Имя второго' (P — поставщик из pricelist.xlsx, у него есть наличие).

import fs from 'node:fs';
import path from 'node:path';
import { seal, open, deriveKeyBytes, fromB64, randomBytes, ITERATIONS } from '../js/crypto.js';
import { decode, encode } from '../js/data.js';
import { Pricer, siteFile } from '../js/engine.js';

const DEFAULT_OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'prices.enc');
const KIND = { battery: 'b', display: 'd', port: 'p', cover: 'c' };
const SF_FIELDS = ['battery', 'battery_orig', 'display_copy', 'display_copy_oled_mid', 'display_orig', 'port', 'cover'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function password() {
  const p = process.env.FC_PASSWORD;
  if (!p) throw new Error('Нужен пароль в переменной FC_PASSWORD');
  return p;
}

async function keyFor(file) {
  let salt;
  let iter = ITERATIONS;
  if (fs.existsSync(file)) {
    const env = JSON.parse(fs.readFileSync(file, 'utf8'));
    salt = fromB64(env.salt);
    iter = env.iter;
  } else {
    salt = randomBytes(16);
  }
  return { key: await deriveKeyBytes(password(), salt, iter), salt, iter };
}

async function read(file) {
  const env = JSON.parse(fs.readFileSync(file, 'utf8'));
  const key = await deriveKeyBytes(password(), fromB64(env.salt), env.iter);
  return open(env, key);
}

async function write(file, compact) {
  const { key, salt, iter } = await keyFor(file);
  const env = await seal(compact, key, salt, iter);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(env));
  return env;
}

function supplierNames(prev) {
  const out = { E: 'Поставщик 1', P: 'Поставщик 2' };
  if (prev) for (const k of Object.keys(out)) if (prev.suppliers[k]) out[k] = prev.suppliers[k].name;
  for (const pair of (process.env.FC_SUPPLIERS || '').split(',')) {
    const [k, v] = pair.split('=').map((x) => (x || '').trim());
    if (k && v) out[k] = v;
  }
  out.prev = prev ? prev.suppliers : {};
  return out;
}

function buildFromWork(work, priceDate, names) {
  const J = (f) => JSON.parse(fs.readFileSync(path.join(work, f), 'utf8'));
  const rows = new Map(J('candidates_f.json').map((r) => [r.id, r]));
  const mapping = J('mapping.json');
  const site = J('site_models.json');
  const mi = J('model_inputs.json');
  const info = new Map(mi.models.map((m) => [m.model, m]));
  const models = site.map(([brand, model]) => {
    const inf = info.get(model) || {};
    const sf = {};
    for (const k of SF_FIELDS) if (inf.smartfix && inf.smartfix[k]) sf[k] = inf.smartfix[k];
    const fx = 'ifixit_used' in inf ? inf.ifixit_used : (inf.ifixit ?? null);
    return { brand, model, year: inf.year || null, ifixit: fx, sf: Object.keys(sf).length ? sf : null, sfUrl: inf.smartfix_url || null };
  });
  const parts = [];
  for (const [id, m] of Object.entries(mapping)) {
    const r = rows.get(id);
    if (!r) continue;
    parts.push({
      sup: r.supplier === 'pricelist' ? 'P' : 'E', name: r.name, cost: r.cost, stock: r.stock || null, svc: KIND[r.kind],
      tier: m.tier, models: m.models, line: m.line,
    });
  }
  return {
    v: 1, priceDate, sfDate: '2026-10-10',
    // имя, сайт и прочее о поставщике переносим из прошлого пакета
    suppliers: {
      P: { ...(names.prev.P || {}), name: names.P, stock: true, rank: 0 },
      E: { ...(names.prev.E || {}), name: names.E, stock: false, rank: 1 },
    },
    models, parts, history: [],
  };
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'build') {
  const out = b || DEFAULT_OUT;
  const prev = fs.existsSync(out) ? decode(await read(out)) : null;
  const data = buildFromWork(a, process.env.FC_PRICE_DATE || '2026-10-10', supplierNames(prev));
  await write(out, encode(data));
  const back = decode(await read(out));
  console.log('ok:', back.models.length, 'моделей,', back.parts.length, 'позиций →', out, fs.statSync(out).size, 'байт');
} else if (cmd === 'decrypt') {
  const inFile = b ? a : DEFAULT_OUT;
  fs.writeFileSync(b || a, JSON.stringify(decode(await read(inFile)), null, 1));
} else if (cmd === 'encrypt') {
  await write(b || DEFAULT_OUT, encode(JSON.parse(fs.readFileSync(a, 'utf8'))));
} else if (cmd === 'site') {
  const inFile = b ? a : DEFAULT_OUT;
  const data = decode(await read(inFile));
  const d = new Date(data.priceDate);
  fs.writeFileSync(b || a, siteFile(new Pricer(data), MONTHS[d.getMonth()] + ' ' + d.getFullYear()));
} else {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 9).join('\n'));
}
