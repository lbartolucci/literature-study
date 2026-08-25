/* =========================================================================
   store.js — in-memory state + persistence bridge.
   A personal library fits comfortably in RAM (a few hundred papers), so we
   keep everything in memory for instant search/filter and use IndexedDB as
   the durable store. Every mutation flows through here.
   ========================================================================= */

import * as db from './db.js';
import {
  normalizePaper, validatePaper, normalizeAuthor, validateAuthor,
  normalizeGroup, validateGroup, touch, ValidationError, newLink
} from './models.js';
import { normalize, slug } from './utils/text.js';

export { ValidationError };

export const state = {
  papers: [], authors: [], groups: [], links: [], sessions: [], dismissed: [],
  settings: {}, areas: [], loaded: false
};

/* ----------------------------------------------------------- event bus -- */
const listeners = new Set();
export function subscribe (fn) { listeners.add(fn); return () => listeners.delete(fn); }
function announce (type, detail) { listeners.forEach(fn => { try { fn(type, detail); } catch (e) { console.error(e); } }); }

/* ------------------------------------------------------------- loading -- */
export async function load () {
  const [papers, authors, groups, links, sessions, dismissed, settings, areas] = await Promise.all([
    db.all('papers'), db.all('authors'), db.all('groups'), db.all('links'),
    db.all('sessions'), db.all('dismissed'), db.settings(), db.areas()
  ]);
  Object.assign(state, { papers, authors, groups, links, sessions, dismissed, settings, areas, loaded: true });
  announce('loaded');
  return state;
}

/* ------------------------------------------------------------- getters -- */
export const area = id => state.areas.find(a => a.id === id) || null;
export const paper = id => state.papers.find(p => p.id === id) || null;
export const author = id => state.authors.find(a => a.id === id) || null;
export const group = id => state.groups.find(g => g.id === id) || null;
export const papersInArea = areaId => state.papers.filter(p => p.area === areaId);
export const papersByAuthor = authorId => state.papers.filter(p => (p.authorRefs || []).includes(authorId));
export const papersByGroup = groupId => state.papers.filter(p => (p.groupRefs || []).includes(groupId));
export function areaCounts (areaId) {
  const ps = papersInArea(areaId);
  return { papers: ps.length, sessions: state.sessions.filter(s => s.area === areaId).length };
}

/* -------------------------------------------------------------- papers -- */
export async function savePaper (p) {
  normalizePaper(p);
  const errors = validatePaper(p);
  if (errors.length) throw new ValidationError(errors);
  touch(p);
  await db.put('papers', p);
  const i = state.papers.findIndex(x => x.id === p.id);
  if (i >= 0) state.papers[i] = p; else state.papers.push(p);
  announce('paper', p);
  return p;
}

export async function deletePaper (id) {
  const p = paper(id);
  await db.deletePaperCascade(id, p && p.pdfKey);
  state.papers = state.papers.filter(x => x.id !== id);
  state.links = state.links.filter(l => l.aId !== id && l.bId !== id);
  announce('paper-deleted', id);
}

/* ------------------------------------------------------------- authors -- */
/** Find an author by name (or OpenAlex id), else create one. Returns the record. */
export async function ensureAuthor ({ name, openalexId = '', orcid = '', affiliation = '' }) {
  const key = slug(name);
  let a = state.authors.find(x => (openalexId && x.openalexId === openalexId) || x.nameKey === key);
  if (a) {
    let changed = false;
    if (openalexId && !a.openalexId) { a.openalexId = openalexId; changed = true; }
    if (orcid && !a.orcid) { a.orcid = orcid; changed = true; }
    if (affiliation && !a.affiliation) { a.affiliation = affiliation; changed = true; }
    if (changed) await saveAuthor(a);
    return a;
  }
  a = normalizeAuthor({ id: 'a_' + key + '_' + Math.random().toString(36).slice(2, 6), name, nameKey: key, openalexId, orcid, affiliation, notes: '' });
  return saveAuthor(a);
}

export async function saveAuthor (a) {
  normalizeAuthor(a);
  const errors = validateAuthor(a);
  if (errors.length) throw new ValidationError(errors);
  touch(a);
  await db.put('authors', a);
  const i = state.authors.findIndex(x => x.id === a.id);
  if (i >= 0) state.authors[i] = a; else state.authors.push(a);
  announce('author', a);
  return a;
}

export async function deleteAuthor (id) {
  await db.del('authors', id);
  state.authors = state.authors.filter(x => x.id !== id);
  // detach from papers
  for (const p of state.papers) {
    if ((p.authorRefs || []).includes(id)) { p.authorRefs = p.authorRefs.filter(x => x !== id); await db.put('papers', normalizePaper(p)); }
  }
  announce('author-deleted', id);
}

/* -------------------------------------------------------------- groups -- */
export async function ensureGroup ({ name, institution = '', lead = '' }) {
  const key = slug(name);
  let g = state.groups.find(x => x.nameKey === key);
  if (g) return g;
  g = normalizeGroup({ id: 'g_' + key + '_' + Math.random().toString(36).slice(2, 6), name, nameKey: key, institution, lead, notes: '' });
  return saveGroup(g);
}
export async function saveGroup (g) {
  normalizeGroup(g);
  const errors = validateGroup(g);
  if (errors.length) throw new ValidationError(errors);
  touch(g);
  await db.put('groups', g);
  const i = state.groups.findIndex(x => x.id === g.id);
  if (i >= 0) state.groups[i] = g; else state.groups.push(g);
  announce('group', g);
  return g;
}
export async function deleteGroup (id) {
  await db.del('groups', id);
  state.groups = state.groups.filter(x => x.id !== id);
  for (const p of state.papers) {
    if ((p.groupRefs || []).includes(id)) { p.groupRefs = p.groupRefs.filter(x => x !== id); await db.put('papers', normalizePaper(p)); }
  }
  announce('group-deleted', id);
}

/* --------------------------------------------------------------- links -- */
export async function addLink (areaId, aId, bId, kind, note) {
  if (aId === bId) return null;
  const exists = state.links.find(l => l.kind === kind &&
    ((l.aId === aId && l.bId === bId) || (l.aId === bId && l.bId === aId)));
  if (exists) return exists;
  const l = newLink(areaId, aId, bId, kind, note);
  await db.put('links', l);
  state.links.push(l);
  announce('link', l);
  return l;
}
export async function removeLink (id) {
  await db.del('links', id);
  state.links = state.links.filter(l => l.id !== id);
  announce('link-removed', id);
}
export function linksOf (paperId) { return state.links.filter(l => l.aId === paperId || l.bId === paperId); }

/* ------------------------------------------------------------ sessions -- */
export async function saveSession (s) {
  await db.put('sessions', s);
  const i = state.sessions.findIndex(x => x.id === s.id);
  if (i >= 0) state.sessions[i] = s; else state.sessions.push(s);
  announce('session', s);
  return s;
}
export async function deleteSession (id) {
  await db.del('sessions', id);
  state.sessions = state.sessions.filter(x => x.id !== id);
  announce('session-deleted', id);
}

/* ------------------------------------------------------------ dismissed - */
export async function dismiss (openalexId) {
  const rec = { id: openalexId, at: Date.now() };
  await db.put('dismissed', rec);
  state.dismissed.push(rec);
}
export const isDismissed = id => state.dismissed.some(d => d.id === id);

/* ----------------------------------------------------------- settings --- */
export async function updateSettings (partial) {
  state.settings = await db.saveSettings(partial);
  announce('settings', state.settings);
  return state.settings;
}
export async function saveAreas (list) {
  state.areas = await db.saveAreas(list);
  announce('areas', state.areas);
  return state.areas;
}
