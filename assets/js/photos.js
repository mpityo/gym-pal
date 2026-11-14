/**
 * Your own photo of each machine, per gym (spec 09).
 *
 * Photos are far too big for the ~5 MB localStorage state, so they live in
 * IndexedDB: database 'gym-pal-photos', object store 'photos', keyPath 'key'.
 *
 *   record: { key: `${gymId ?? 'any'}:${exId}`, gymId, exId, blob, width, height, takenAt }
 *
 * One photo per exercise per gym; taking a new one replaces it. Every call is
 * wrapped so that, when IndexedDB is unavailable (some private modes), the
 * feature reports itself as unavailable instead of throwing into render().
 *
 * The storage itself sits behind a small adapter ({ getAll, get, put, delete,
 * clear }) so the pure logic and the export/import shape can be tested in Node
 * with an in-memory adapter.
 */

const DB_NAME = 'gym-pal-photos';
const STORE = 'photos';

// ── Pure helpers (tested) ────────────────────────────────────────────────

/** The storage key: a gym's own photo, or 'any' when there is no gym. */
export function photoKey(exId, gymId) {
  return `${gymId ?? 'any'}:${exId}`;
}

/** The gym's photo beats the 'any' photo; null when neither exists. */
export function pickPhoto(records, exId, gymId) {
  const list = records ?? [];
  if (gymId) {
    const mine = list.find((r) => r.key === photoKey(exId, gymId));
    if (mine) return mine;
  }
  return list.find((r) => r.key === photoKey(exId, null)) ?? null;
}

/** Metadata only, safe to keep in memory for every photo. */
function meta(rec) {
  return { key: rec.key, gymId: rec.gymId ?? null, exId: rec.exId, width: rec.width ?? null, height: rec.height ?? null, takenAt: rec.takenAt ?? null, bytes: rec.blob?.size ?? 0 };
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

/** [{ key, gymId, exId, takenAt, width, height, dataUrl }] for a backup file. */
export async function exportPhotosFrom(adapter) {
  const all = await adapter.getAll();
  const out = [];
  for (const r of all) {
    if (!r?.blob) continue;
    out.push({ key: r.key, gymId: r.gymId ?? null, exId: r.exId, takenAt: r.takenAt ?? null, width: r.width ?? null, height: r.height ?? null, dataUrl: await blobToDataUrl(r.blob) });
  }
  return out;
}

/** Writes photos from a backup file. Bad entries are skipped. Returns how many were imported. */
export async function importPhotosInto(adapter, list) {
  let n = 0;
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p.exId !== 'string' || typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/')) continue;
    try {
      const blob = await dataUrlToBlob(p.dataUrl);
      const gymId = p.gymId ?? null;
      await adapter.put({ key: photoKey(p.exId, gymId), gymId, exId: p.exId, blob, width: p.width ?? null, height: p.height ?? null, takenAt: p.takenAt ?? Date.now() });
      n += 1;
    } catch {
      // skip this one
    }
  }
  return n;
}

/** An in-memory adapter: used by tests, and as the shape the IndexedDB one follows. */
export function memoryAdapter() {
  const m = new Map();
  return {
    async getAll() { return [...m.values()]; },
    async get(key) { return m.get(key) ?? null; },
    async put(rec) { m.set(rec.key, rec); },
    async delete(key) { m.delete(key); },
    async clear() { m.clear(); },
  };
}

// ── IndexedDB adapter ────────────────────────────────────────────────────

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function idbAdapter() {
  let dbp = null;
  const db = () => {
    dbp ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'key' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('blocked'));
    });
    return dbp;
  };
  const tx = async (mode, fn) => {
    const store = (await db()).transaction(STORE, mode).objectStore(STORE);
    return req(fn(store));
  };
  return {
    getAll: () => tx('readonly', (s) => s.getAll()),
    get: async (key) => (await tx('readonly', (s) => s.get(key))) ?? null,
    put: (rec) => tx('readwrite', (s) => s.put(rec)),
    delete: (key) => tx('readwrite', (s) => s.delete(key)),
    clear: () => tx('readwrite', (s) => s.clear()),
  };
}

// ── The live photo store ─────────────────────────────────────────────────

let adapter = null;
/** null until checked; then true/false. */
let usable = null;
/** key -> metadata, for synchronous "is there a photo?" checks in list views. */
let index = new Map();
let ready = null;
const listeners = new Set();

/** Test-only / advanced: use another adapter (resets the in-memory index). */
export function _useAdapter(a) {
  adapter = a;
  usable = null;
  ready = null;
  index = new Map();
}

/** Loads the index once. Resolves to whether photos can be used here. */
export function init() {
  ready ??= (async () => {
    try {
      if (!adapter) {
        if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
        adapter = idbAdapter();
      }
      const all = await adapter.getAll();
      index = new Map(all.filter((r) => r?.key).map((r) => [r.key, meta(r)]));
      usable = true;
    } catch {
      usable = false;
      index = new Map();
    }
    notify();
    return usable;
  })();
  return ready;
}

/** Synchronous: true/false once init() has finished, null before. */
export function isAvailable() {
  return usable;
}

/** Called after the index changes (photo added/removed, init finished). Returns an unsubscribe function. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

/** Synchronous metadata for the photo that would be shown, or null. Needs init() to have finished. */
export function photoMeta(exId, gymId) {
  return pickPhoto([...index.values()], exId, gymId);
}

/** The gym's photo, else the 'any' photo, else null. */
export async function getPhoto(exId, gymId) {
  if (!(await init())) return null;
  try {
    const m = photoMeta(exId, gymId);
    return m ? await adapter.get(m.key) : null;
  } catch {
    return null;
  }
}

/** Saves (or replaces) the photo for this exercise at this gym. Returns false if it could not be saved. */
export async function putPhoto(exId, gymId, blob, { width = null, height = null } = {}) {
  if (!(await init())) return false;
  try {
    const first = index.size === 0;
    const rec = { key: photoKey(exId, gymId), gymId: gymId ?? null, exId, blob, width, height, takenAt: Date.now() };
    await adapter.put(rec);
    index.set(rec.key, meta(rec));
    // Photos are the first thing a browser evicts under storage pressure.
    if (first) globalThis.navigator?.storage?.persist?.().catch?.(() => {});
    notify();
    return true;
  } catch {
    return false;
  }
}

export async function deletePhoto(exId, gymId) {
  if (!(await init())) return false;
  try {
    const key = photoKey(exId, gymId);
    await adapter.delete(key);
    index.delete(key);
    notify();
    return true;
  } catch {
    return false;
  }
}

/** Metadata only (no blobs). */
export async function listPhotos() {
  if (!(await init())) return [];
  return [...index.values()];
}

/** { count, bytes } from the in-memory index. */
export function photoStats() {
  let bytes = 0;
  for (const m of index.values()) bytes += m.bytes;
  return { count: index.size, bytes };
}

export async function exportPhotos() {
  if (!(await init())) return [];
  return exportPhotosFrom(adapter);
}

export async function importPhotos(list) {
  if (!(await init())) return 0;
  const n = await importPhotosInto(adapter, list);
  const all = await adapter.getAll();
  index = new Map(all.filter((r) => r?.key).map((r) => [r.key, meta(r)]));
  notify();
  return n;
}

export async function clearPhotos() {
  if (!(await init())) return;
  try {
    await adapter.clear();
  } catch {
    // nothing else to do
  }
  index = new Map();
  notify();
}

// ── Object URLs ──────────────────────────────────────────────────────────

const urls = new Map();

/** An object URL for a record's blob, reused until releaseUrls(). */
export function photoUrl(rec) {
  const id = `${rec.key}@${rec.takenAt}`;
  let u = urls.get(id);
  if (!u) {
    u = URL.createObjectURL(rec.blob);
    urls.set(id, u);
  }
  return u;
}

/** Revoke every object URL. app.js calls this at the start of each render(). */
export function releaseUrls() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}
