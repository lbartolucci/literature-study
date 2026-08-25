/* =========================================================================
   openalex.js — query OpenAlex (https://openalex.org).
   OpenAlex is free, needs no key and has open CORS. We join the "polite
   pool" by sending a mailto. Responses are cached in IndexedDB for 7 days.
   Nothing about the user's library is ever sent — only public queries.
   ========================================================================= */

import { cacheGet, cachePut, settings } from './db.js';

const BASE = 'https://api.openalex.org';
const TTL = 7 * 24 * 3600 * 1000;
const TIMEOUT = 15000;

const SELECT = [
  'id', 'doi', 'title', 'display_name', 'publication_year', 'publication_date',
  'type', 'authorships', 'primary_location', 'best_oa_location', 'open_access',
  'abstract_inverted_index', 'keywords', 'concepts', 'topics',
  'referenced_works', 'related_works', 'cited_by_count'
].join(',');

export class NetworkError extends Error {
  constructor (message, cause) { super(message); this.name = 'NetworkError'; this.cause = cause; }
}
export const offline = () => navigator.onLine === false;

/* --------------------------------------------------- fetch with retry ---- */

async function getJson (url, { retries = 3, signal } = {}) {
  if (offline()) throw new NetworkError('You are offline: OpenAlex is not reachable.');
  const cached = await cacheGet(url).catch(() => null);
  if (cached) return cached;

  let last = null;
  for (let t = 0; t < retries; t++) {
    if (t > 0) await pause(400 * Math.pow(3, t - 1) + Math.random() * 200);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (res.status === 429 || res.status === 503) { last = new NetworkError('OpenAlex is busy. Retrying…'); continue; }
      if (res.status === 404) return null;
      if (!res.ok) throw new NetworkError(`OpenAlex returned an error (${res.status}).`);
      const data = await res.json();
      cachePut(url, data, TTL).catch(() => {});
      return data;
    } catch (e) {
      if (signal && signal.aborted) throw e;
      last = e.name === 'AbortError' ? new NetworkError('OpenAlex did not respond in time.')
        : (e instanceof NetworkError ? e : new NetworkError('Could not reach OpenAlex.', e));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw last || new NetworkError('Request failed.');
}
const pause = ms => new Promise(r => setTimeout(r, ms));

async function withMailto (path, params = {}) {
  const s = await settings().catch(() => ({}));
  const u = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
  u.searchParams.set('select', SELECT);
  if (s && s.mailto) u.searchParams.set('mailto', s.mailto);
  return u.toString();
}

/* ------------------------------------------------- abstract reconstruction */

export function reconstructAbstract (inverted) {
  if (!inverted || typeof inverted !== 'object') return '';
  const positions = [];
  for (const [word, idxs] of Object.entries(inverted)) for (const i of idxs) positions[i] = word;
  return positions.join(' ').replace(/\s+/g, ' ').trim();
}

/* --------------------------------------------------------- id helpers ---- */
export const shortId = id => (id || '').replace(/^https?:\/\/openalex\.org\//i, '');
export const cleanDoi = doi => (doi || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase();

/* --------------------------------------------------------- work → paper -- */

/** Map an OpenAlex work to the fields our paper record understands. */
export function mapWork (w) {
  if (!w) return null;
  const authorships = w.authorships || [];
  const authors = authorships.map(a => a.author && a.author.display_name).filter(Boolean);
  const authorMeta = authorships.map(a => ({
    name: a.author && a.author.display_name || '',
    openalexId: shortId(a.author && a.author.id),
    orcid: (a.author && a.author.orcid) || '',
    affiliation: (a.institutions && a.institutions[0] && a.institutions[0].display_name) || (a.raw_affiliation_strings && a.raw_affiliation_strings[0]) || ''
  })).filter(a => a.name);
  const loc = w.primary_location || {};
  const source = loc.source || {};
  const oa = w.open_access || {};
  const bestOa = w.best_oa_location || {};
  const keywords = (w.keywords || []).map(k => k.display_name || k.keyword).filter(Boolean);
  const concepts = (w.concepts || []).filter(c => (c.score || 0) >= 0.3)
    .map(c => ({ id: shortId(c.id), name: c.display_name, score: c.score, level: c.level }));
  const topics = (w.topics || []).map(t => ({ id: shortId(t.id), name: t.display_name }));
  return {
    title: w.title || w.display_name || '',
    authors,
    authorMeta,
    year: w.publication_year || null,
    venue: source.display_name || '',
    doi: cleanDoi(w.doi),
    openalexId: shortId(w.id),
    type: w.type || '',
    abstract: reconstructAbstract(w.abstract_inverted_index),
    keywords,
    concepts,
    topics,
    oaUrl: bestOa.pdf_url || oa.oa_url || bestOa.landing_page_url || loc.landing_page_url || '',
    isOa: !!oa.is_oa,
    oaStatus: oa.oa_status || '',
    pdfUrl: bestOa.pdf_url || (loc.is_oa ? loc.pdf_url : '') || '',
    referencedWorks: (w.referenced_works || []).map(shortId),
    relatedWorks: (w.related_works || []).map(shortId),
    citedByCount: w.cited_by_count || 0
  };
}

/* ------------------------------------------------------------- queries --- */

export async function searchWorks (query, { perPage = 15, filter = '', signal } = {}) {
  const url = await withMailto('/works', { search: query, filter, per_page: perPage, sort: 'relevance_score:desc' });
  const data = await getJson(url, { signal });
  return (data && data.results ? data.results : []).map(mapWork);
}

export async function getByDoi (doi, { signal } = {}) {
  const d = cleanDoi(doi);
  if (!d) return null;
  const url = await withMailto('/works', { filter: `doi:${d}`, per_page: 1 });
  const data = await getJson(url, { signal });
  const r = data && data.results && data.results[0];
  return r ? mapWork(r) : null;
}

export async function getById (id, { signal } = {}) {
  const w = shortId(id);
  if (!w) return null;
  const url = await withMailto('/works/' + encodeURIComponent(w));
  const data = await getJson(url, { signal });
  return data ? mapWork(data) : null;
}

/** Fetch several works by id in one call (used by Explore for related works). */
export async function getManyByIds (ids, { signal } = {}) {
  const list = [...new Set(ids.map(shortId))].filter(Boolean).slice(0, 50);
  if (!list.length) return [];
  const url = await withMailto('/works', { filter: `openalex_id:${list.join('|')}`, per_page: list.length });
  const data = await getJson(url, { signal });
  return (data && data.results ? data.results : []).map(mapWork);
}

/** Top works for a set of concept ids, most cited first. */
export async function worksByConcepts (conceptIds, { perPage = 25, fromYear = 0, signal } = {}) {
  const ids = [...new Set(conceptIds.map(shortId))].filter(Boolean).slice(0, 8);
  if (!ids.length) return [];
  let filter = `concepts.id:${ids.join('|')}`;
  if (fromYear) filter += `,from_publication_date:${fromYear}-01-01`;
  const url = await withMailto('/works', { filter, per_page: perPage, sort: 'cited_by_count:desc' });
  const data = await getJson(url, { signal });
  return (data && data.results ? data.results : []).map(mapWork);
}

export async function worksByAuthor (authorId, { perPage = 25, signal } = {}) {
  const a = shortId(authorId);
  if (!a) return [];
  const url = await withMailto('/works', { filter: `author.id:${a}`, per_page: perPage, sort: 'cited_by_count:desc' });
  const data = await getJson(url, { signal });
  return (data && data.results ? data.results : []).map(mapWork);
}

/* --------------------------------------------------- open-access PDF ----- */

/** Try to fetch an open-access PDF as a Blob. Cross-origin hosts frequently
 *  block this with CORS; when they do we return null and the caller keeps the
 *  link instead. Only ever attempted for open-access URLs. */
export async function tryFetchPdf (url, { signal } = {}) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal, mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.type && blob.type.indexOf('pdf') === -1 && blob.size < 1000) return null;
    return blob;
  } catch (_) {
    return null;   // CORS or network: caller falls back to the link
  }
}
