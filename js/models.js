/* =========================================================================
   models.js — record shapes, normalisation and validation.
   ========================================================================= */

import { uid, normalize, slug } from './utils/text.js';

export class ValidationError extends Error {
  constructor (errors) { super(errors.join(' ')); this.name = 'ValidationError'; this.errors = errors; }
}

export function touch (rec) {
  const now = new Date().toISOString();
  if (!rec.createdAt) rec.createdAt = now;
  rec.updatedAt = now;
  return rec;
}

/* ------------------------------------------------------------------ paper */

export function newPaper (area) {
  return {
    id: uid('p'),
    area,                       // area id
    title: '',
    authors: [],               // display strings
    authorRefs: [],            // author record ids (registry)
    year: null,
    venue: '',
    doi: '',
    openalexId: '',
    type: '',
    abstract: '',
    keywords: [],              // strings
    concepts: [],              // { id, name, score }
    oaUrl: '',                 // open-access landing/pdf url
    pdfKey: '',                // key into the pdfs store (if a PDF is stored)
    pdfName: '',
    notes: '',                 // personal notes
    summary: '',               // synthesis: what the authors did (e.g. from /sintesi-lit)
    takeaways: [],             // key takeaways (strings)
    theme: '',                 // thematic sub-group inside the area (e.g. sintesi-lit theme)
    projectLinks: [],          // { project, text } — how the paper connects to our projects
    source: null,              // { kind:'sintesi-lit', file, folder, pdf, importedAt } when imported
    groupRefs: [],             // research group record ids
    referencedWorks: [],       // OpenAlex ids (for Explore)
    relatedWorks: [],          // OpenAlex ids (for Explore)
    createdAt: null,
    updatedAt: null
  };
}

export function normalizePaper (p) {
  p.title = (p.title || '').trim();
  p.authors = (p.authors || []).map(a => String(a).trim()).filter(Boolean);
  p.keywords = (p.keywords || []).map(k => String(k).trim()).filter(Boolean);
  p.takeaways = (p.takeaways || []).map(t => String(t).trim()).filter(Boolean);
  p.summary = (p.summary || '').trim();
  p.theme = (p.theme || '').trim();
  p.projectLinks = (p.projectLinks || [])
    .map(l => ({ project: String(l.project || '').trim(), text: String(l.text || '').trim() }))
    .filter(l => l.text);
  p.doi = (p.doi || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();
  p.year = p.year ? parseInt(p.year, 10) || null : null;
  // search indexes for IndexedDB multiEntry
  p.authorRefIdx = [...new Set(p.authorRefs || [])];
  p.groupRefIdx = [...new Set(p.groupRefs || [])];
  return p;
}

export function validatePaper (p) {
  const e = [];
  if (!p.area) e.push('Area is required.');
  if (!p.title) e.push('Title is required.');
  return e;
}

/* ----------------------------------------------------------------- author */

export function newAuthor (name = '') {
  return { id: uid('a'), name: name.trim(), nameKey: slug(name), openalexId: '', orcid: '', affiliation: '', notes: '', createdAt: null, updatedAt: null };
}
export function normalizeAuthor (a) {
  a.name = (a.name || '').trim();
  a.nameKey = slug(a.name);
  return a;
}
export function validateAuthor (a) { return a.name ? [] : ['Author name is required.']; }

/* ------------------------------------------------------------------ group */

export function newGroup (name = '') {
  return { id: uid('g'), name: name.trim(), nameKey: slug(name), institution: '', lead: '', notes: '', createdAt: null, updatedAt: null };
}
export function normalizeGroup (g) {
  g.name = (g.name || '').trim();
  g.nameKey = slug(g.name);
  return g;
}
export function validateGroup (g) { return g.name ? [] : ['Group name is required.']; }

/* ------------------------------------------------------------------- link */

export const LINK_KINDS = [
  { id: 'thematic', label: 'Thematic' },
  { id: 'group',    label: 'Same group' },
  { id: 'author',   label: 'Same author' },
  { id: 'cites',    label: 'Cites / builds on' },
  { id: 'contrast', label: 'Contrasts' }
];

export function newLink (area, aId, bId, kind = 'thematic', note = '') {
  return { id: uid('l'), area, aId, bId, kind, note: (note || '').trim(), createdAt: new Date().toISOString() };
}
