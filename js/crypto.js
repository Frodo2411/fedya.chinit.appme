// Шифрование данных прайса: PBKDF2-SHA256 из пароля, AES-GCM 256, данные сжаты gzip.
// Работает и в браузере, и в Node 22 (там те же WebCrypto и CompressionStream).

const subtle = globalThis.crypto.subtle;
export const ITERATIONS = 600000;

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function normPassword(p) {
  return String(p || '').trim().toLowerCase().replace(/\s+/g, '');
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// Ключ из пароля: 32 байта, их можно запомнить на телефоне, чтобы не вводить пароль каждый раз
export async function deriveKeyBytes(password, salt, iterations = ITERATIONS) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(normPassword(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  return new Uint8Array(bits);
}

function aesKey(keyBytes) {
  return subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Упаковать объект: {v, iter, salt, iv, data}
export async function seal(obj, keyBytes, salt, iterations = ITERATIONS) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('gzip'));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyBytes), packed));
  return { v: 1, iter: iterations, salt: toB64(salt), iv: toB64(iv), data: toB64(ct) };
}

// Распаковать. Неверный ключ — исключение.
export async function open(env, keyBytes) {
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, await aesKey(keyBytes), fromB64(env.data));
  const json = await pipe(new Uint8Array(plain), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(json));
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}
