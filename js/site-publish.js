// Цены на сайт одной кнопкой: приложение кладёт prices-models.js в репозиторий сайта через GitHub API,
// сайт обновляется сам. Нужен ключ GitHub (fine-grained token) с доступом только к репозиторию сайта:
// Contents — Read and write. Ключ хранится только на этом телефоне, в таблицу не копируется.

import { store } from './store.js';

export const SITE_REPO = 'Frodo2411/fedya.chinet';
const PATH = 'prices-models.js';
const BRANCH = 'main';
const API = 'https://api.github.com/repos/' + SITE_REPO + '/contents/' + PATH;

export const siteToken = () => store.get('siteToken', '') || '';
export const setSiteToken = (t) => (t ? store.set('siteToken', t.trim()) : store.remove('siteToken'));

// UTF-8 в base64 и обратно (atob/btoa понимают только латиницу)
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const why = (status) => (status === 401 ? 'ключ GitHub не подходит или истёк — введи новый'
  : status === 403 || status === 404 ? 'у ключа нет доступа к репозиторию сайта (нужно Contents: Read and write)'
    : status === 409 || status === 422 ? 'файл на сайте только что поменялся — нажми ещё раз'
      : 'GitHub ответил ' + status);

// Отправить файл цен. Возвращает 'same', если на сайте уже эти цены, иначе 'updated'.
export async function publishSite(text, token, fetchFn = fetch) {
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  let r;
  try { r = await fetchFn(API + '?ref=' + BRANCH, { headers, cache: 'no-store' }); } catch { throw new Error('нет связи с GitHub'); }
  if (!r.ok && r.status !== 404) throw new Error(why(r.status));
  const cur = r.ok ? await r.json() : null;
  if (cur && cur.content && fromBase64(cur.content) === text) return 'same';
  const body = { message: 'Цены с телефона', content: toBase64(text), branch: BRANCH, ...(cur ? { sha: cur.sha } : {}) };
  try { r = await fetchFn(API, { method: 'PUT', headers, body: JSON.stringify(body) }); } catch { throw new Error('нет связи с GitHub'); }
  if (!r.ok) throw new Error(why(r.status));
  return 'updated';
}
