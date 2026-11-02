/* =========================================================================
   backup.js — export / import the whole local database as a JSON file.
   PDFs are large and browser-specific; by default they are NOT included in
   the JSON backup (only the metadata and the OA link are). An option lets
   you include them if you really want a self-contained archive.
   ========================================================================= */

import * as db from './db.js';
import * as store from './store.js';
import { download } from './ui.js';

export async function exportBackup ({ includePdfs = false } = {}) {
  const snapshot = await db.exportAll({ includePdfs });
  if (includePdfs) {
    // turn blobs into base64 so they survive JSON
    for (const rec of snapshot.data.pdfs || []) {
      rec.blobBase64 = await blobToBase64(rec.blob);
      delete rec.blob;
    }
  }
  const name = `literature-study-backup-${new Date().toISOString().slice(0, 10)}.json`;
  download(name, JSON.stringify(snapshot, null, 2), 'application/json');
  return name;
}

export async function importBackup (file, { merge = true } = {}) {
  const text = await file.text();
  const snap = JSON.parse(text);
  if (!snap || !snap.data) throw new Error('This file is not a LiteratureStudy backup.');
  if (!merge) await db.resetData({ keepSettings: false });

  const d = snap.data;
  if (d.pdfs) for (const rec of d.pdfs) {
    if (rec.blobBase64) { rec.blob = base64ToBlob(rec.blobBase64, rec.type || 'application/pdf'); delete rec.blobBase64; }
  }
  for (const name of ['authors', 'groups', 'papers', 'links', 'sessions', 'reviews', 'dismissed', 'pdfs']) {
    if (Array.isArray(d[name])) await db.putMany(name, d[name]);
  }
  if (Array.isArray(d.meta)) for (const m of d.meta) await db.put('meta', m);
  await store.load();
  return counts(d);
}

function counts (d) {
  return { papers: (d.papers || []).length, authors: (d.authors || []).length, groups: (d.groups || []).length };
}

function blobToBase64 (blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}
function base64ToBlob (b64, type) {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
