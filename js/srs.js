/* =========================================================================
   srs.js — spaced repetition for Study.
   One review record per paper (id = paper id). A light SM-2 variant:
   self-rating Again / Hard / Good / Easy sets the next interval (days) and
   an ease factor; quiz mistakes send a paper back to "due today".
   ========================================================================= */

import { papersInArea, review as findReview, saveReview } from './store.js';

const DAY = 86400000;
const MIN_EASE = 1.3, MAX_EASE = 3.0, START_EASE = 2.5;
const HISTORY_MAX = 30;

export const RATINGS = [
  { id: 'again', label: 'Again', hint: "didn't remember" },
  { id: 'hard',  label: 'Hard',  hint: 'partly, with effort' },
  { id: 'good',  label: 'Good',  hint: 'remembered the core' },
  { id: 'easy',  label: 'Easy',  hint: 'all of it, instantly' }
];

const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** A paper is worth studying if there is something to recall on its back. */
export function isStudyable (p) {
  return (p.summary || '').trim().length >= 40
    || (p.takeaways || []).some(t => t.trim().length >= 8)
    || (p.notes || '').trim().length >= 12
    || (p.abstract || '').trim().length >= 60;
}

export function blankReview (p) {
  return { id: p.id, area: p.area, ease: START_EASE, interval: 0, due: null, reps: 0, lapses: 0,
    lastReviewed: null, lastRating: '', quizMiss: null, history: [] };
}

export const isDue = r => !!(r && r.due && Date.parse(r.due) <= endOfToday());
export const isNew = r => !r || !r.reps;

/** Next (interval, ease) for a rating — pure, used for previews too. */
function next (r, rating) {
  let ease = r.ease || START_EASE;
  const iv = r.interval || 0;
  let interval;
  switch (rating) {
    case 'again': interval = 0; ease -= 0.2; break;
    case 'hard':  interval = iv ? Math.max(1, Math.round(iv * 1.2)) : 1; ease -= 0.15; break;
    case 'good':  interval = iv === 0 ? 2 : iv < 3 ? 4 : Math.max(iv + 1, Math.round(iv * ease)); break;
    case 'easy':  interval = iv === 0 ? 5 : Math.max(iv + 2, Math.round(iv * ease * 1.3)); ease += 0.15; break;
    default: interval = iv;
  }
  return { interval: Math.min(interval, 365), ease: clamp(ease, MIN_EASE, MAX_EASE) };
}

export function previewLabel (r, rating) {
  const { interval } = next(r || { interval: 0 }, rating);
  return intervalLabel(interval);
}
export function intervalLabel (days) {
  if (!days) return 'today';
  if (days < 14) return days + 'd';
  if (days < 60) return Math.round(days / 7) + 'w';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return '1y';
}

function pushHistory (r, entry) {
  r.history = [...(r.history || []), entry].slice(-HISTORY_MAX);
}

/** Apply a self-rating from Study and persist. */
export async function rate (p, rating) {
  const r = { ...(findReview(p.id) || blankReview(p)) };
  const n = next(r, rating);
  const now = Date.now();
  r.area = p.area;
  r.interval = n.interval; r.ease = n.ease;
  r.due = new Date(now + n.interval * DAY).toISOString();
  r.reps = (r.reps || 0) + 1;
  if (rating === 'again') r.lapses = (r.lapses || 0) + 1;
  else r.quizMiss = null;               // studied again successfully → clear the quiz flag
  r.lastReviewed = new Date(now).toISOString();
  r.lastRating = rating;
  pushHistory(r, { at: r.lastReviewed, kind: 'study', rating });
  return saveReview(r);
}

/** Feed a quiz outcome back. score in [0,1] for the paper's questions. */
export async function quizResult (p, score) {
  const r = { ...(findReview(p.id) || blankReview(p)) };
  const now = new Date().toISOString();
  r.area = p.area;
  if (score < 0.5) {
    // missed → back to Study today, interval halved, ease down a notch
    r.interval = Math.floor((r.interval || 0) / 2);
    r.ease = clamp((r.ease || START_EASE) - 0.15, MIN_EASE, MAX_EASE);
    r.due = now;
    r.lapses = (r.lapses || 0) + 1;
    r.quizMiss = now;
  }
  pushHistory(r, { at: now, kind: 'quiz', score: Math.round(score * 100) / 100 });
  return saveReview(r);
}

export function level (r) {
  if (isNew(r)) return { id: 'new', label: 'New' };
  if ((r.interval || 0) >= 21) return { id: 'mature', label: 'Mature' };
  if ((r.interval || 0) >= 7) return { id: 'young', label: 'Young' };
  return { id: 'learning', label: 'Learning' };
}

function pool (areaId, theme) {
  return papersInArea(areaId).filter(isStudyable).filter(p => !theme || p.theme === theme);
}

/** Counts for the Study dashboard. */
export function stats (areaId, theme = '') {
  const ps = pool(areaId, theme);
  const out = { total: ps.length, due: 0, fresh: 0, learning: 0, young: 0, mature: 0, missed: 0, nextDue: null };
  for (const p of ps) {
    const r = findReview(p.id);
    const lv = level(r).id;
    if (lv === 'new') out.fresh++; else out[lv]++;
    if (!isNew(r) && isDue(r)) out.due++;
    if (r && r.quizMiss) out.missed++;
    if (r && r.due && !isDue(r) && (!out.nextDue || r.due < out.nextDue)) out.nextDue = r.due;
  }
  return out;
}

/** Build the card queue: due first (quiz misses, then most overdue, then
 *  lowest ease), then new papers in import order. `practice` = nothing due:
 *  revisit the weakest / least-recently reviewed papers ahead of schedule. */
export function buildQueue (areaId, { theme = '', limit = 10, newLimit = Infinity, practice = false } = {}) {
  const ps = pool(areaId, theme);
  const withR = ps.map(p => ({ p, r: findReview(p.id) }));
  if (practice) {
    return withR.filter(x => !isNew(x.r))
      .sort((a, b) => (a.r.ease - b.r.ease) || (a.r.lastReviewed || '').localeCompare(b.r.lastReviewed || ''))
      .slice(0, limit).map(x => x.p);
  }
  const due = withR.filter(x => !isNew(x.r) && isDue(x.r))
    .sort((a, b) => (!!b.r.quizMiss - !!a.r.quizMiss) || a.r.due.localeCompare(b.r.due) || (a.r.ease - b.r.ease));
  const fresh = withR.filter(x => isNew(x.r))
    .sort((a, b) => (a.p.createdAt || '').localeCompare(b.p.createdAt || '') || a.p.id.localeCompare(b.p.id));
  const out = due.map(x => x.p);
  const room = Math.max(0, Math.min(newLimit, limit - out.length));
  return [...out, ...fresh.slice(0, room).map(x => x.p)].slice(0, limit);
}

/** Per-theme due/new counts for the focus selector. */
export function themeStats (areaId) {
  const themes = [...new Set(papersInArea(areaId).map(p => p.theme).filter(Boolean))].sort();
  return themes.map(t => ({ theme: t, ...stats(areaId, t) }));
}
