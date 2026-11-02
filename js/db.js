/* =========================================================================
   db.js — persistence on IndexedDB.
   Why IndexedDB (not localStorage): abstracts, notes and especially PDF
   blobs quickly exceed the ~5 MB synchronous localStorage quota. Everything
   lives locally in the browser — nothing is ever uploaded.
   ========================================================================= */

const DB_NAME = 'literature-study';
const DB_VERSION = 2;   // v2: + reviews store (spaced-repetition state)

/** Logical schema version (written into backups). Bump when record shapes
 *  change, not when the app changes. */
export const SCHEMA_VERSION = 1;

const STORES = {
  papers: { keyPath: 'id', indexes: [
    ['area', 'area'],
    ['updatedAt', 'updatedAt'],
    ['doi', 'doi'],
    ['openalexId', 'openalexId'],
    ['authorRefIdx', 'authorRefIdx', { multiEntry: true }],
    ['groupRefIdx', 'groupRefIdx', { multiEntry: true }]
  ]},
  authors: { keyPath: 'id', indexes: [
    ['name', 'nameKey'],
    ['openalexId', 'openalexId']
  ]},
  groups: { keyPath: 'id', indexes: [
    ['name', 'nameKey']
  ]},
  links: { keyPath: 'id', indexes: [
    ['area', 'area'],
    ['aId', 'aId'],
    ['bId', 'bId']
  ]},
  pdfs: { keyPath: 'key' },                  // { key, blob, name, type, size }
  sessions: { keyPath: 'id', indexes: [      // saved Study quizzes
    ['area', 'area'],
    ['createdAt', 'createdAt']
  ]},
  reviews: { keyPath: 'id', indexes: [       // spaced-repetition state, one per paper (id = paper id)
    ['area', 'area'],
    ['due', 'due']
  ]},
  dismissed: { keyPath: 'id' },              // Explore suggestions the user rejected
  cache: { keyPath: 'key' },                 // OpenAlex responses with expiry
  meta: { keyPath: 'key' }                   // settings, areas, counters
};

let _db = null;

export function open () {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('This browser does not support IndexedDB.')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        const store = db.objectStoreNames.contains(name)
          ? req.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [idxName, path, opts] of (def.indexes || [])) {
          if (!store.indexNames.contains(idxName)) store.createIndex(idxName, path, opts || {});
        }
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open the database.'));
    req.onblocked = () => reject(new Error('Database blocked by another open tab.'));
  });
}

/* --------------------------------------------------------------- primitives */

function tx (stores, mode = 'readonly') { return open().then(db => db.transaction(stores, mode)); }
function wait (req) { return new Promise((ok, ko) => { req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error); }); }
function done (t) { return new Promise((ok, ko) => { t.oncomplete = () => ok(); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error || new Error('Transaction aborted')); }); }

export async function all (store) { const t = await tx(store); return wait(t.objectStore(store).getAll()); }
export async function get (store, id) { const t = await tx(store); return wait(t.objectStore(store).get(id)); }
export async function byIndex (store, index, value) { const t = await tx(store); return wait(t.objectStore(store).index(index).getAll(value)); }
export async function put (store, record) { const t = await tx(store, 'readwrite'); const r = await wait(t.objectStore(store).put(record)); await done(t); return r; }
export async function putMany (store, records) { if (!records.length) return; const t = await tx(store, 'readwrite'); const s = t.objectStore(store); records.forEach(r => s.put(r)); await done(t); }
export async function del (store, id) { const t = await tx(store, 'readwrite'); await wait(t.objectStore(store).delete(id)); await done(t); }
export async function clear (store) { const t = await tx(store, 'readwrite'); await wait(t.objectStore(store).clear()); await done(t); }

export const STORE_NAMES = Object.keys(STORES);

/* --------------------------------------------------------- meta / settings */

const DEFAULT_SETTINGS = {
  theme: 'auto',                // 'auto' | 'light' | 'dark'
  mailto: 'lorenzo.bartolucci@uniroma2.it',  // OpenAlex "polite pool" contact
  dictationPunctuation: true,
  dictationLang: 'en-US',
  autoLinkSuggestions: true
};

export const DEFAULT_AREAS = [
  { id: 'sustainable-mobility', name: 'Sustainable Mobility', emoji: '🚗', color: '#2f7cf6' },
  { id: 'batteries',           name: 'Batteries',            emoji: '🔋', color: '#12a150' },
  { id: 'hydrogen',            name: 'Hydrogen',             emoji: '💧', color: '#0ea5a3' },
  { id: 'biomass-biofuel',     name: 'Biomass / Biofuel',    emoji: '🌱', color: '#7aa100' },
  { id: 'multi-energy',        name: 'Multi-energy Systems', emoji: '⚡', color: '#d98a00' },
  { id: 'circular-economy',    name: 'Circular Economy',     emoji: '♻️', color: '#6d5efc' }
];

export async function settings () {
  const rec = await get('meta', 'settings');
  return { ...DEFAULT_SETTINGS, ...(rec ? rec.value : {}) };
}
export async function saveSettings (partial) {
  const next = { ...(await settings()), ...partial };
  await put('meta', { key: 'settings', value: next });
  return next;
}
export async function areas () {
  const rec = await get('meta', 'areas');
  return (rec && Array.isArray(rec.value) && rec.value.length) ? rec.value : DEFAULT_AREAS;
}
export async function saveAreas (list) { await put('meta', { key: 'areas', value: list }); return list; }

/* ---------------------------------------------------------- API cache ---- */

export async function cacheGet (key) {
  const rec = await get('cache', key);
  if (!rec) return null;
  if (rec.expires && rec.expires < Date.now()) { del('cache', key).catch(() => {}); return null; }
  return rec.value;
}
export async function cachePut (key, value, ttlMs = 7 * 24 * 3600 * 1000) {
  await put('cache', { key, value, expires: Date.now() + ttlMs, savedAt: Date.now() });
}
export async function cacheClear () { await clear('cache'); }

/* ------------------------------------------------------------ PDF blobs -- */

export async function putPdf (key, blob, meta = {}) {
  await put('pdfs', { key, blob, name: meta.name || 'paper.pdf', type: meta.type || 'application/pdf', size: blob.size, savedAt: Date.now() });
  return key;
}
export async function getPdf (key) { return get('pdfs', key); }
export async function delPdf (key) { return del('pdfs', key); }

/* --------------------------------------------------- domain operations --- */

/** Delete a paper and detach it from links (but keep authors/groups). */
export async function deletePaperCascade (paperId, pdfKey) {
  const db = await open();
  const t = db.transaction(['papers', 'links'], 'readwrite');
  t.objectStore('papers').delete(paperId);
  const linkStore = t.objectStore('links');
  const [a, b] = await Promise.all([
    wait(linkStore.index('aId').getAll(paperId)),
    wait(linkStore.index('bId').getAll(paperId))
  ]);
  [...a, ...b].forEach(l => linkStore.delete(l.id));
  await done(t);
  if (pdfKey) await delPdf(pdfKey).catch(() => {});
}

export async function linksOf (paperId) {
  const [a, b] = await Promise.all([byIndex('links', 'aId', paperId), byIndex('links', 'bId', paperId)]);
  const seen = new Set();
  return [...a, ...b].filter(l => (seen.has(l.id) ? false : seen.add(l.id)));
}

/** Full snapshot, ready for JSON serialisation (excludes the API cache). */
export async function exportAll ({ includePdfs = false } = {}) {
  const data = {};
  for (const name of STORE_NAMES) {
    if (name === 'cache') continue;
    if (name === 'pdfs' && !includePdfs) continue;
    data[name] = await all(name);
  }
  return {
    app: 'LiteratureStudy',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data
  };
}

export async function resetData ({ keepSettings = true } = {}) {
  const s = keepSettings ? await settings() : null;
  const a = keepSettings ? await areas() : null;
  for (const name of STORE_NAMES) await clear(name);
  if (s) await put('meta', { key: 'settings', value: s });
  if (a) await put('meta', { key: 'areas', value: a });
}
