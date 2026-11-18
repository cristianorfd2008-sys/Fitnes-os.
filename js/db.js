// Camada de persistência: IndexedDB (no próprio aparelho). Única fonte de verdade dos dados do usuário.
import { BACKUP_STORES, buildBackup, validateBackup } from './logic.js';

const DB_NAME = 'fitnessos';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      for (const s of ['exercises', 'programs', 'bodyMetrics', 'checkins']) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const st = db.createObjectStore('sessions', { keyPath: 'id' });
        st.createIndex('startedAt', 'startedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        let result;
        Promise.resolve(fn(t)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('Transação abortada'));
      }),
  );
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const getAll = (store) => tx(store, 'readonly', (t) => wrap(t.objectStore(store).getAll()));
export const get = (store, key) => tx(store, 'readonly', (t) => wrap(t.objectStore(store).get(key)));
export const put = (store, value) => tx(store, 'readwrite', (t) => { t.objectStore(store).put(value); return value; });
export const del = (store, key) => tx(store, 'readwrite', (t) => { t.objectStore(store).delete(key); });

export async function getMeta(key, fallback = null) {
  const r = await get('meta', key);
  return r ? r.value : fallback;
}
export const setMeta = (key, value) => put('meta', { key, value });

export async function exportAll() {
  const data = {};
  for (const s of BACKUP_STORES) data[s] = await getAll(s);
  return buildBackup(data);
}

/** Substitui TODOS os dados pelo backup (após validação). Atômico: uma única transação. */
export async function importAll(backup) {
  const v = validateBackup(backup);
  if (!v.ok) throw new Error(v.errors.join('\n'));
  await tx(BACKUP_STORES, 'readwrite', (t) => {
    for (const s of BACKUP_STORES) {
      const os = t.objectStore(s);
      os.clear();
      for (const rec of backup.data[s]) os.put(rec);
    }
  });
  return v.counts;
}

export async function wipeAll() {
  await tx(BACKUP_STORES, 'readwrite', (t) => { for (const s of BACKUP_STORES) t.objectStore(s).clear(); });
}

/** Pede ao navegador armazenamento persistente (reduz risco de remoção automática). */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false };
  const already = await navigator.storage.persisted();
  const granted = already || (await navigator.storage.persist());
  return { supported: true, granted };
}
