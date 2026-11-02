/* =========================================================================
   sync.js — optional cloud sync via Supabase (local-first, no build step).

   Design choices (documented in SUPABASE_SETUP.md):
   · No bundler / no CDN import. We talk to Supabase over its plain REST/Auth
     HTTP API with fetch, so the app stays dependency-free and offline-first
     (the service worker keeps caching the same static files).
   · Auth: email + password (simplest, most robust for a static PWA — no
     redirect handling). Session (access + refresh token) is persisted locally
     and refreshed automatically.
   · Storage model: a single table `records(user_id, app, collection,
     record_id, data jsonb, updated_at, deleted)` with row-level security that
     isolates each user. See SUPABASE_SETUP.md for the SQL.
   · Merge: LOCAL-FIRST, per-record, LAST-WRITE-WINS by `updated_at`. Never a
     blind overwrite. Deletes propagate as soft-delete tombstones. Local
     changes/deletes are detected by diffing against a snapshot of the last
     reconciled state, so we don't have to hook every delete path.

   The anon key pasted by the user is PUBLIC and safe to store on the device:
   RLS makes it useless without a logged-in user, and every row is scoped to
   auth.uid(). No secret keys are ever used here.
   ========================================================================= */

import * as db from './db.js';
import * as store from './store.js';

const APP = 'literature-study';
const COLLECTIONS = ['papers', 'authors', 'groups', 'links', 'sessions', 'reviews'];
// Initial pull cursor: strictly BELOW any record timestamp (pull uses gt.).
const EPOCH = '1970-01-01T00:00:00.000Z';
// Stable sentinel for records that carry no usable timestamp (e.g. old or
// JSON-imported records). It is 1 ms past EPOCH, so such records are still
// pushed AND are returned by another device's gt.EPOCH pull. Being stable
// (not now()), they are not re-pushed on every sync.
const MIN_TS = '1970-01-01T00:00:00.001Z';

/* ------------------------------------------------------- persistent state */

let config = { url: '', anonKey: '' };
let session = null;                 // { access_token, refresh_token, expires_at, user:{id,email} }
let syncState = { cursor: EPOCH, snapshot: {}, tombstones: {} };

export async function loadPersisted () {
  config = (await metaGet('sync.config')) || config;
  session = (await metaGet('sync.session')) || null;
  syncState = (await metaGet('sync.state')) || syncState;
  syncState.snapshot = syncState.snapshot || {};
  syncState.tombstones = syncState.tombstones || {};
  return { config, session, syncState };
}
const metaGet = async k => { const r = await db.get('meta', k); return r ? r.value : null; };
const metaPut = (k, v) => db.put('meta', { key: k, value: v });
const saveConfig = () => metaPut('sync.config', config);
const saveSession = () => metaPut('sync.session', session);
const saveState = () => metaPut('sync.state', syncState);

/* --------------------------------------------------------------- status - */

const listeners = new Set();
const status = { state: 'idle', lastSync: null, error: '', email: '' };
export function onStatus (fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); }
function setStatus (patch) { Object.assign(status, patch); listeners.forEach(fn => { try { fn(status); } catch (_) {} }); }

export function getConfig () { return { ...config }; }
export function isConfigured () { return !!(config.url && config.anonKey); }
export function currentUser () { return session && session.user ? session.user : null; }

export async function setConfig ({ url, anonKey }) {
  config = { url: (url || '').trim().replace(/\/$/, ''), anonKey: (anonKey || '').trim() };
  await saveConfig();
  setStatus({ state: isConfigured() ? (currentUser() ? 'idle' : 'logged-out') : 'not-configured', error: '' });
}

/* ------------------------------------------------------- HTTP primitives - */

async function http (path, { method = 'GET', body = null, auth = false, prefer = '', headers = {} } = {}) {
  if (!isConfigured()) throw new Error('Cloud sync is not configured.');
  const h = { apikey: config.anonKey, 'Content-Type': 'application/json', ...headers };
  if (auth) { if (!session) throw new Error('Not logged in.'); h.Authorization = 'Bearer ' + session.access_token; }
  if (prefer) h.Prefer = prefer;
  const res = await fetch(config.url + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error || data.hint)) || ('HTTP ' + res.status);
    const err = new Error(msg); err.status = res.status; err.data = data; throw err;
  }
  return data;
}

function adoptSession (d) {
  if (!d || !d.access_token) return false;
  const expiresAt = d.expires_at ? d.expires_at : Math.floor(Date.now() / 1000) + (d.expires_in || 3600);
  session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: expiresAt, user: d.user ? { id: d.user.id, email: d.user.email } : (session && session.user) };
  return true;
}

/* --------------------------------------------------------------- auth --- */

export async function signUp (email, password) {
  const d = await http('/auth/v1/signup', { method: 'POST', body: { email, password } });
  if (!adoptSession(d)) {
    // email confirmation is enabled on the project
    throw new Error('Account created, but this project requires email confirmation. Confirm via the email, then log in — or disable "Confirm email" in Supabase → Authentication → Providers → Email.');
  }
  await saveSession(); setStatus({ state: 'idle', email: session.user.email, error: '' });
  return session.user;
}

export async function signIn (email, password) {
  const d = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!adoptSession(d)) throw new Error('Login failed.');
  await saveSession(); setStatus({ state: 'idle', email: session.user.email, error: '' });
  return session.user;
}

export async function signOut () {
  try { if (session) await http('/auth/v1/logout', { method: 'POST', auth: true }); } catch (_) {}
  session = null; await saveSession();
  setStatus({ state: 'logged-out', email: '' });
}

async function ensureSession () {
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - now > 60) return session;
  // refresh
  try {
    const d = await http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
    if (adoptSession(d)) { await saveSession(); return session; }
  } catch (e) { /* fallthrough */ }
  session = null; await saveSession();
  setStatus({ state: 'logged-out', email: '' });
  return null;
}

/* ------------------------------------------------------- record adapter - */

function isoOf (rec) {
  const v = rec && (rec.updatedAt || rec.createdAt || rec.at);
  const n = v ? Date.parse(v) : 0;
  return (Number.isFinite(n) && n > 0) ? new Date(n).toISOString() : MIN_TS;
}
const tsMs = rec => Date.parse(isoOf(rec));
function hasTs (rec) { const v = rec && (rec.updatedAt || rec.createdAt || rec.at); return !!(v && Date.parse(v) > 0); }

/** Give any local record that lacks a usable timestamp a real `updatedAt`
 *  (persisted). This covers old records and JSON-imported data: without it,
 *  a timestamp-less record would look "in the past" and never reach other
 *  devices via the incremental (updated_at > cursor) pull. Runs once per
 *  record — afterwards it has a real timestamp and is skipped. Treating the
 *  moment of first sync as "now" also makes freshly imported data win merges. */
async function normalizeTimestamps () {
  for (const c of COLLECTIONS) {
    const rows = await db.all(c);
    for (const rec of rows) {
      if (rec && rec.id != null && !hasTs(rec)) { rec.updatedAt = new Date().toISOString(); await db.put(c, rec); }
    }
  }
}

const snap = c => (syncState.snapshot[c] = syncState.snapshot[c] || {});
const tomb = c => (syncState.tombstones[c] = syncState.tombstones[c] || {});

/* --------------------------------------------------------------- engine - */

let running = false, pending = false;

export async function syncNow ({ silent = false } = {}) {
  if (!isConfigured()) { setStatus({ state: 'not-configured' }); return { ok: false, reason: 'not-configured' }; }
  if (navigator.onLine === false) { setStatus({ state: 'offline' }); return { ok: false, reason: 'offline' }; }
  const s = await ensureSession();
  if (!s) { setStatus({ state: 'logged-out' }); return { ok: false, reason: 'logged-out' }; }
  if (running) { pending = true; return { ok: false, reason: 'busy' }; }
  running = true;
  setStatus({ state: 'syncing', error: '' });
  let changedLocal = false;
  try {
    // ---- 0. make sure every local record has a real timestamp ----
    await normalizeTimestamps();

    // ---- 1. PULL remote changes since cursor ----
    let cursor = syncState.cursor || EPOCH;
    let guard = 0;
    while (guard++ < 50) {
      const rows = await http(`/rest/v1/records?app=eq.${APP}&updated_at=gt.${encodeURIComponent(cursor)}&order=updated_at.asc&limit=1000`, { auth: true });
      if (!rows || !rows.length) break;
      for (const row of rows) { if (await mergeRemote(row)) changedLocal = true; }
      cursor = rows[rows.length - 1].updated_at;
      syncState.cursor = cursor;
      if (rows.length < 1000) break;
    }

    // ---- 2. detect local changes & deletes, build upserts ----
    const upserts = [];
    const now = new Date().toISOString();
    for (const c of COLLECTIONS) {
      const rows = await db.all(c);
      const present = new Set();
      for (const rec of rows) {
        const id = rec.id; present.add(id);
        const iso = isoOf(rec);
        const known = snap(c)[id];
        if (known == null || Date.parse(known) !== Date.parse(iso)) {
          upserts.push(row(c, id, rec, iso, false));
        }
      }
      // local deletes: was in snapshot, gone now, not already tombstoned
      for (const id of Object.keys(snap(c))) {
        if (present.has(id)) continue;
        if (tomb(c)[id]) continue;
        upserts.push(row(c, id, {}, now, true));
        tomb(c)[id] = now;
        delete snap(c)[id];
      }
    }

    // ---- 3. PUSH ----
    if (upserts.length) {
      await http(`/rest/v1/records?on_conflict=user_id,app,collection,record_id`, {
        method: 'POST', auth: true, prefer: 'resolution=merge-duplicates,return=minimal', body: upserts
      });
      // reflect pushed state into snapshot/tombstones
      for (const u of upserts) {
        if (u.deleted) { tomb(u.collection)[u.record_id] = u.updated_at; delete snap(u.collection)[u.record_id]; }
        else snap(u.collection)[u.record_id] = u.updated_at;
      }
    }

    await saveState();
    if (changedLocal) await store.load();          // refresh in-memory + UI
    setStatus({ state: 'synced', lastSync: Date.now(), error: '', email: session.user.email });
    return { ok: true, pulledChanged: changedLocal, pushed: upserts.length };
  } catch (e) {
    console.error('Sync error', e);
    setStatus({ state: 'error', error: e.message || String(e) });
    return { ok: false, reason: 'error', error: e.message };
  } finally {
    running = false;
    if (pending) { pending = false; setTimeout(() => syncNow({ silent: true }), 300); }
  }
}

function row (collection, record_id, data, updated_at, deleted) {
  return { user_id: session.user.id, app: APP, collection, record_id, data, updated_at, deleted };
}

async function mergeRemote (r) {
  const c = r.collection, id = r.record_id, rMs = Date.parse(r.updated_at);
  if (!COLLECTIONS.includes(c)) return false;
  const local = await db.get(c, id);
  const localMs = local ? tsMs(local) : (tomb(c)[id] ? Date.parse(tomb(c)[id]) : null);
  if (r.deleted) {
    if (localMs == null || rMs >= localMs) {
      if (local) await db.del(c, id);
      tomb(c)[id] = r.updated_at; delete snap(c)[id];
      return !!local;
    }
  } else {
    if (!local || rMs >= localMs) {
      await db.put(c, r.data);
      snap(c)[id] = r.updated_at; delete tomb(c)[id];
      return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------- auto-sync --- */

let debounce = null;
export function scheduleAutoSync (delay = 1500) {
  if (!isConfigured() || !currentUser()) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => { syncNow({ silent: true }); }, delay);
}

let wired = false;
export function initAutoSync () {
  if (wired) return; wired = true;
  window.addEventListener('online', () => { setStatus({ state: 'idle' }); scheduleAutoSync(400); });
  window.addEventListener('offline', () => setStatus({ state: 'offline' }));
  // sync shortly after any data mutation
  store.subscribe((type) => {
    if (typeof type === 'string' && /paper|author|group|link|session|review/.test(type)) scheduleAutoSync();
  });
  if (isConfigured() && currentUser()) { setStatus({ email: currentUser().email }); scheduleAutoSync(1200); }
  else if (isConfigured()) setStatus({ state: 'logged-out' });
  else setStatus({ state: 'not-configured' });
}
