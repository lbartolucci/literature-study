/* =========================================================================
   text.js — small text helpers shared across the app.
   ========================================================================= */

/** Escape for safe insertion into HTML. */
export function esc (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Accent-insensitive, lower-case, trimmed normalisation for comparisons. */
export function normalize (s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
}

/** Split into words (letters/digits only). */
export function words (s) {
  return normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
}

export const STOPWORDS = new Set(('a an the of and or to in on for with without from by as at is are be ' +
  'this that these those we our their its it his her using use based via toward towards into over under ' +
  'new novel study analysis approach method methods model models results result effect effects between ' +
  'high low can may also more most such than then thus which was were has have had not can not').split(/\s+/));

export function significantWords (s) {
  return words(s).filter(w => w.length > 2 && !STOPWORDS.has(w));
}

/** A short, stable, URL-safe id. */
export function uid (prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Slugify a string for stable keys (e.g. author names). */
export function slug (s) {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
}

/** Human-friendly relative-ish date. */
export function fmtDate (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Compact author list for display, e.g. "Onori, Zhang +3". */
export function authorsShort (authors, max = 2) {
  if (!authors || !authors.length) return 'Unknown authors';
  const last = a => (a || '').trim().split(/\s+/).slice(-1)[0] || a;
  const shown = authors.slice(0, max).map(last).join(', ');
  const extra = authors.length - max;
  return extra > 0 ? `${shown} +${extra}` : shown;
}

/** Is a free-text answer acceptable vs. an expected string (fuzzy). */
export function answerAcceptable (given, expected) {
  const g = normalize(given), e = normalize(expected);
  if (!g) return false;
  if (g === e) return true;
  if (e.length > 4 && (g.includes(e) || e.includes(g))) return true;
  // token overlap
  const gs = new Set(words(g)), es = words(e).filter(Boolean);
  if (!es.length) return false;
  const hit = es.filter(w => gs.has(w)).length;
  return hit / es.length >= 0.6;
}

/** Escape a value for CSV. */
export function csvCell (v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle (arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sample (arr, n) { return shuffle(arr).slice(0, n); }
export function pick (arr) { return arr[Math.floor(Math.random() * arr.length)]; }
