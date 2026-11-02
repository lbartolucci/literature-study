/* =========================================================================
   review.js — quiz on the papers just studied (post-Study quiz).
   Questions test the CONCEPTS on each paper's card (summary, key takeaways,
   project connection), not bibliographic trivia. Distractors are drawn
   preferably from the other papers just studied and from the same theme,
   so you have to discriminate between things you actually reviewed.
   ========================================================================= */

import { papersInArea } from '../store.js';
import { normalize, words, shuffle, pick, uid } from '../utils/text.js';

const longTakeaways = p => (p.takeaways || []).filter(t => t.trim().length >= 20);
const projectLink = p => (p.projectLinks || []).find(l => (l.text || '').trim().length >= 20);

/** Hide title words in a snippet so the answer isn't given away. */
function mask (text, title, max = 420) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const cut = clean.length > max ? clean.slice(0, max).replace(/\s+\S*$/, '') + '…' : clean;
  const hide = new Set(words(title).filter(w => w.length > 3));
  return cut.split(/\b/).map(tok => hide.has(normalize(tok)) ? '▁▁▁' : tok).join('');
}

/** Pick n distractors from tiers of candidates (best tier first), unique, ≠ correct. */
function tiered (correct, tiers, n = 3) {
  const out = [], seen = new Set([normalize(correct)]);
  for (const tier of tiers) {
    for (const x of shuffle(tier)) {
      const k = normalize(x);
      if (!x || seen.has(k)) continue;
      seen.add(k); out.push(x);
      if (out.length === n) return out;
    }
  }
  return out;
}
const opts = (correct, distractors) => shuffle([correct, ...distractors]).map(text => ({ text, correct: text === correct }));

/* Each builder: (p, ctx) → question | null.  ctx = { studied, sameTheme, area } */
const BUILD = {
  /** Which of these is a key point of P? */
  'spot-takeaway' (p, c) {
    const own = longTakeaways(p); if (!own.length) return null;
    const correct = pick(own);
    const from = list => list.filter(x => x.id !== p.id).flatMap(longTakeaways);
    const d = tiered(correct, [from(c.sameTheme(p)), from(c.studied), from(c.area)]);
    if (d.length < 3) return null;
    return { kind: 'mc', prompt: `Which of these is a key point of “${p.title}”?`, options: opts(correct, d), answer: correct };
  },
  /** Which is NOT a key point of P? (3 own + 1 intruder) */
  'odd-one-out' (p, c) {
    const own = longTakeaways(p); if (own.length < 3) return null;
    const from = list => list.filter(x => x.id !== p.id).flatMap(x => longTakeaways(x).map(t => ({ t, x })));
    const near = from(c.sameTheme(p)), pool = near.length ? near : [...from(c.studied), ...from(c.area)];
    const ownKeys = new Set(own.map(normalize));
    const cands = pool.filter(o => !ownKeys.has(normalize(o.t)));
    if (!cands.length) return null;
    const intruder = pick(cands);
    const three = shuffle(own).slice(0, 3);
    return { kind: 'mc', prompt: `Which of these is NOT a key point of “${p.title}”?`,
      options: opts(intruder.t, three), answer: intruder.t,
      explain: `That point comes from “${intruder.x.title}”.` };
  },
  /** Which paper does this key point come from? */
  'whose-takeaway' (p, c) {
    const own = longTakeaways(p); if (!own.length) return null;
    const t = pick(own);
    const titles = list => list.filter(x => x.id !== p.id).map(x => x.title);
    const d = tiered(p.title, [titles(c.studied), titles(c.sameTheme(p)), titles(c.area)]);
    if (d.length < 3) return null;
    return { kind: 'mc', prompt: 'Which paper does this key point come from?', context: mask(t, p.title),
      options: opts(p.title, d), answer: p.title };
  },
  /** Which paper does this summary describe? */
  'which-summary' (p, c) {
    if ((p.summary || '').trim().length < 60) return null;
    const titles = list => list.filter(x => x.id !== p.id).map(x => x.title);
    const d = tiered(p.title, [titles(c.studied), titles(c.sameTheme(p)), titles(c.area)]);
    if (d.length < 3) return null;
    return { kind: 'mc', prompt: 'Which paper does this summary describe?', context: mask(p.summary, p.title),
      options: opts(p.title, d), answer: p.title };
  },
  /** Which paper supports this point for the project? */
  'project-which' (p, c) {
    const l = projectLink(p); if (!l) return null;
    const titles = list => list.filter(x => x.id !== p.id).map(x => x.title);
    const d = tiered(p.title, [titles(c.studied), titles(c.sameTheme(p)), titles(c.area)]);
    if (d.length < 3) return null;
    return { kind: 'mc', prompt: `Which paper supports this point for ${l.project ? l.project.toUpperCase() : 'our project'}?`,
      context: mask(l.text, p.title), options: opts(p.title, d), answer: p.title };
  },
  /** Free recall of the key points (self-graded). */
  'recall-takeaways' (p) {
    const own = (p.takeaways || []).filter(t => t.trim().length >= 8); if (own.length < 2) return null;
    return { kind: 'open', prompt: `Recall the key points of “${p.title}”.`,
      hint: `${own.length} points on the card.`, answer: own.join('\n') };
  },
  /** Why it matters for the project (self-graded). */
  'recall-project' (p) {
    const l = projectLink(p); if (!l) return null;
    return { kind: 'open', prompt: `Why does “${p.title}” matter for ${l.project ? l.project.toUpperCase() : 'our project'}?`, answer: l.text };
  },
  /** What did the authors do? (self-graded) */
  'recall-summary' (p) {
    if ((p.summary || '').trim().length < 60) return null;
    return { kind: 'open', prompt: `What did the authors of “${p.title}” do, and what did they find?`, answer: p.summary };
  }
};

export const REVIEW_LABEL = {
  'spot-takeaway': 'Spot the key point', 'odd-one-out': 'Odd one out', 'whose-takeaway': 'Whose key point?',
  'which-summary': 'Identify from summary', 'project-which': 'Project connection',
  'recall-takeaways': 'Recall the key points', 'recall-project': 'Why it matters', 'recall-summary': 'Recall the study'
};

const MC_TYPES = ['spot-takeaway', 'odd-one-out', 'whose-takeaway', 'which-summary', 'project-which'];
const OPEN_TYPES = ['recall-takeaways', 'recall-project', 'recall-summary'];

/** Build a quiz on `papers` (the ones just studied).
 *  perPaper: questions per paper; includeOpen: add self-graded recall questions. */
export function generateReviewQuiz (papers, { perPaper = 2, includeOpen = true } = {}) {
  if (!papers.length) return [];
  const areaId = papers[0].area;
  const area = papersInArea(areaId);
  const ctx = {
    studied: papers, area,
    sameTheme: p => p.theme ? area.filter(x => x.theme === p.theme) : []
  };
  const out = [];
  for (const p of papers) {
    // at most one open question per paper, the rest multiple choice, all different types
    const mc = shuffle(MC_TYPES), op = shuffle(OPEN_TYPES);
    const wantOpen = includeOpen && perPaper >= 2 ? 1 : 0;
    const picked = [];
    for (const t of mc) { if (picked.length >= perPaper - wantOpen) break; const q = BUILD[t](p, ctx); if (q) picked.push([t, q]); }
    if (wantOpen) for (const t of op) { const q = BUILD[t](p, ctx); if (q) { picked.push([t, q]); break; } }
    // top up if some types had no material
    if (picked.length < perPaper) for (const t of [...mc, ...(includeOpen ? op : [])]) {
      if (picked.length >= perPaper) break;
      if (picked.some(([x]) => x === t)) continue;
      const q = BUILD[t](p, ctx); if (q) picked.push([t, q]);
    }
    for (const [type, q] of picked) out.push({ id: uid('q'), type, paperId: p.id, ...q });
  }
  // shuffle, but avoid the same paper twice in a row where possible
  const s = shuffle(out);
  for (let i = 1; i < s.length; i++) {
    if (s[i].paperId !== s[i - 1].paperId) continue;
    const j = s.findIndex((q, k) => k > i && q.paperId !== s[i - 1].paperId);
    if (j > 0) [s[i], s[j]] = [s[j], s[i]];
  }
  return s;
}
