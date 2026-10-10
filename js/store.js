// Хранилище на телефоне. В приватном режиме или при запрете хранения просто ничего не запоминаем.

const PREFIX = 'fc.';

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* нечего удалять */
    }
  },
};

export function newId() {
  const r = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return Date.now().toString(36) + Array.from(r, (x) => x.toString(36).padStart(2, '0')).join('');
}

export function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
