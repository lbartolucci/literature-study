/* =========================================================================
   generator.js — build Study questions from the papers in an area.
   Nothing is hand-written: every question comes from the user's own papers,
   notes, takeaways, authors and groups. If the material for a type is
   missing, that type simply doesn't appear.
   ========================================================================= */

import { state, papersInArea, author as findAuthor, group as findGroup } from '../store.js';
import { esc, normalize, words, significantWords, shuffle, sample, pick, uid, authorsShort } from '../utils/text.js';

/* Reduce an abstract to a short, title-safe snippet with proper nouns hidden. */
function snippet (text, titleWords) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const cut = clean.length > 320 ? clean.slice(0, 320).replace(/\s+\S*$/, '') + '…' : clean;
  const hide = new Set(titleWords.filter(w => w.length > 3));
  return cut.split(/\b/).map(tok => hide.has(normalize(tok)) ? '▁▁▁' : tok).join('');
}

function distinctAuthorNames () {
  const set = new Set();
  state.authors.forEach(a => set.add(a.name));
  state.papers.forEach(p => (p.authors || []).forEach(n => set.add(n)));
  return [...set].filter(Boolean);
}

/** Which question types can be built for this area, and why not. */
export function availability (areaId) {
  const ps = papersInArea(areaId);
  const authorsN = distinctAuthorNames().length;
  const withNotes = ps.filter(p => (p.notes || '').trim().length >= 12);
  const withTakeaways = ps.filter(p => (p.takeaways || []).some(t => t.trim().length >= 8));
  const withAbstract = ps.filter(p => (p.abstract || '').trim().length >= 60);
  const withGroup = ps.filter(p => (p.groupRefs || []).length);
  const withAuthors = ps.filter(p => (p.authors || []).length);
  const withYear = ps.filter(p => p.year);
  const withKeywords = ps.filter(p => (p.keywords || []).length || (p.concepts || []).length);
  const withSummary = ps.filter(p => (p.summary || '').trim().length >= 60);
  const withProject = ps.filter(p => (p.projectLinks || []).some(l => (l.text || '').trim().length >= 20));
  const themes = new Set(ps.map(p => p.theme).filter(Boolean));

  const info = {};
  const ok = {};
  const mark = (id, cond, reason) => { ok[id] = cond; if (!cond) info[id] = reason; };

  mark('author-of', authorsN >= 3 && withAuthors.length >= 1, 'need at least 3 distinct authors');
  mark('which-paper', ps.length >= 3 && withAbstract.length >= 1, 'need at least 3 papers, one with an abstract');
  mark('metadata', withYear.length >= 3, 'need at least 3 papers with a year');
  mark('concept', ps.length >= 3 && withKeywords.length >= 1, 'need papers with keywords/concepts');
  mark('group-of', withGroup.length >= 1, 'no paper is linked to a research group yet');
  mark('takeaway-open', withTakeaways.length >= 1, 'no paper has a key takeaway written');
  mark('notes-open', withNotes.length >= 1, 'no paper has personal notes written');
  mark('cloze', withTakeaways.length >= 1, 'need a takeaway of a few words');
  mark('which-summary', ps.length >= 3 && withSummary.length >= 1, 'need at least 3 papers, one with a summary');
  mark('takeaway-mc', withTakeaways.length >= 4, 'need at least 4 papers with takeaways');
  mark('theme-of', themes.size >= 3, 'need papers spread over at least 3 themes');
  mark('project-which', ps.length >= 3 && withProject.length >= 1, 'no paper has a project connection yet');
  mark('project-open', withProject.length >= 1, 'no paper has a project connection yet');

  return { ok, info, counts: { papers: ps.length, authors: authorsN, withNotes: withNotes.length, withTakeaways: withTakeaways.length } };
}

function fourOptions (correct, pool) {
  const distractors = sample(pool.filter(x => normalize(x) !== normalize(correct)), 3);
  const opts = shuffle([correct, ...distractors]);
  return opts.map(text => ({ text, correct: normalize(text) === normalize(correct) }));
}

/* -------------------------------------------------- individual builders -- */

function qAuthorOf (p) {
  const correct = p.authors[0];
  if (!correct) return null;
  const pool = distinctAuthorNames();
  if (pool.length < 3) return null;
  return {
    id: uid('q'), kind: 'mc', type: 'author-of', paperId: p.id,
    prompt: `Who is the first author of “${p.title}”?`,
    options: fourOptions(correct, pool), answer: correct
  };
}

function qWhichPaper (p, ps) {
  if ((p.abstract || '').length < 60) return null;
  const titles = ps.map(x => x.title).filter(Boolean);
  if (titles.length < 3) return null;
  return {
    id: uid('q'), kind: 'mc', type: 'which-paper', paperId: p.id,
    prompt: 'Which paper does this abstract belong to?',
    context: snippet(p.abstract, words(p.title)),
    options: fourOptions(p.title, titles), answer: p.title
  };
}

function qMetadata (p, ps) {
  if (!p.year) return null;
  const years = ps.map(x => x.year).filter(Boolean).map(String);
  const near = [];
  for (let d = -3; d <= 3; d++) if (d) near.push(String(p.year + d));
  const pool = [...new Set([...years, ...near])];
  return {
    id: uid('q'), kind: 'mc', type: 'metadata', paperId: p.id,
    prompt: `In which year was “${p.title}” published?`,
    options: fourOptions(String(p.year), pool), answer: String(p.year)
  };
}

function qConcept (p, ps) {
  const own = [...(p.keywords || []), ...((p.concepts || []).map(c => c.name))].filter(Boolean);
  if (!own.length) return null;
  const correct = pick(own);
  const others = [];
  ps.forEach(x => { if (x.id !== p.id) [...(x.keywords || []), ...((x.concepts || []).map(c => c.name))].forEach(k => others.push(k)); });
  const pool = [...new Set(others)].filter(k => !own.some(o => normalize(o) === normalize(k)));
  if (pool.length < 3) return null;
  return {
    id: uid('q'), kind: 'mc', type: 'concept', paperId: p.id,
    prompt: `Which keyword/topic is central to “${p.title}”?`,
    options: fourOptions(correct, [correct, ...pool]), answer: correct
  };
}

function qGroupOf (p) {
  const gids = p.groupRefs || [];
  if (!gids.length) return null;
  const g = findGroup(gids[0]);
  if (!g) return null;
  const pool = state.groups.map(x => x.name);
  if (pool.length < 3) {
    // fall back to an open question if we can't build 4 options
    return { id: uid('q'), kind: 'open', type: 'group-of', paperId: p.id,
      prompt: `Which research group is “${p.title}” associated with?`, answer: g.name };
  }
  return {
    id: uid('q'), kind: 'mc', type: 'group-of', paperId: p.id,
    prompt: `Which research group is “${p.title}” associated with?`,
    options: fourOptions(g.name, pool), answer: g.name
  };
}

function qTakeawayOpen (p) {
  const t = (p.takeaways || []).find(x => x.trim().length >= 8);
  if (!t) return null;
  return { id: uid('q'), kind: 'open', type: 'takeaway-open', paperId: p.id,
    prompt: `In your own words, what is the key takeaway of “${p.title}”?`, answer: (p.takeaways || []).join(' · ') };
}

function qNotesOpen (p) {
  if ((p.notes || '').trim().length < 12) return null;
  return { id: uid('q'), kind: 'open', type: 'notes-open', paperId: p.id,
    prompt: `Why did you save “${p.title}”? Recall your notes.`, answer: p.notes };
}

function qCloze (p) {
  const t = (p.takeaways || []).find(x => x.trim().split(/\s+/).length >= 4);
  if (!t) return null;
  const toks = t.split(/(\s+)/);
  const candidates = toks.map((w, i) => ({ w, i })).filter(o => significantWords(o.w).length && o.w.length > 4);
  if (!candidates.length) return null;
  const chosen = pick(candidates);
  const answer = chosen.w.replace(/[^A-Za-z0-9-]/g, '');
  const masked = toks.map((w, i) => i === chosen.i ? w.replace(answer, '▁▁▁▁') : w).join('');
  return { id: uid('q'), kind: 'open', type: 'cloze', paperId: p.id,
    prompt: `Fill the gap in your takeaway for “${p.title}”:`, context: masked, answer };
}

function qWhichSummary (p, ps) {
  if ((p.summary || '').length < 60) return null;
  const titles = ps.map(x => x.title).filter(Boolean);
  if (titles.length < 3) return null;
  return {
    id: uid('q'), kind: 'mc', type: 'which-summary', paperId: p.id,
    prompt: 'Which paper does this summary describe?',
    context: snippet(p.summary, words(p.title)),
    options: fourOptions(p.title, titles), answer: p.title
  };
}

function qTakeawayMC (p, ps) {
  const own = (p.takeaways || []).filter(t => t.trim().length >= 20);
  if (!own.length) return null;
  const correct = pick(own);
  const pool = [];
  ps.forEach(x => { if (x.id !== p.id) (x.takeaways || []).forEach(t => { if (t.trim().length >= 20) pool.push(t); }); });
  if (pool.length < 3) return null;
  return {
    id: uid('q'), kind: 'mc', type: 'takeaway-mc', paperId: p.id,
    prompt: `Which of these is a key takeaway of “${p.title}”?`,
    options: fourOptions(correct, [correct, ...pool]), answer: correct
  };
}

function qThemeOf (p, ps) {
  if (!p.theme) return null;
  const pool = [...new Set(ps.map(x => x.theme).filter(Boolean))];
  if (pool.length < 3) return null;
  return {
    id: uid('q'), kind: 'mc', type: 'theme-of', paperId: p.id,
    prompt: `Under which theme did you file “${p.title}”?`,
    options: fourOptions(p.theme, pool), answer: p.theme
  };
}

function projectLink (p) { return (p.projectLinks || []).find(l => (l.text || '').trim().length >= 20); }

function qProjectWhich (p, ps) {
  const l = projectLink(p);
  if (!l) return null;
  const titles = ps.map(x => x.title).filter(Boolean);
  if (titles.length < 3) return null;
  return {
    id: uid('q'), kind: 'mc', type: 'project-which', paperId: p.id,
    prompt: `Which paper supports this point for ${l.project ? l.project.toUpperCase() : 'our project'}?`,
    context: snippet(l.text, words(p.title)),
    options: fourOptions(p.title, titles), answer: p.title
  };
}

function qProjectOpen (p) {
  const l = projectLink(p);
  if (!l) return null;
  return { id: uid('q'), kind: 'open', type: 'project-open', paperId: p.id,
    prompt: `Why does “${p.title}” matter for ${l.project ? l.project.toUpperCase() : 'our project'}?`, answer: l.text };
}

/* --------------------------------------------------------------- assemble */

const BUILDERS = {
  'author-of': (ps) => ps.map(qAuthorOf),
  'which-paper': (ps) => ps.map(p => qWhichPaper(p, ps)),
  'metadata': (ps) => ps.map(p => qMetadata(p, ps)),
  'concept': (ps) => ps.map(p => qConcept(p, ps)),
  'group-of': (ps) => ps.map(qGroupOf),
  'takeaway-open': (ps) => ps.map(qTakeawayOpen),
  'notes-open': (ps) => ps.map(qNotesOpen),
  'cloze': (ps) => ps.map(qCloze),
  'which-summary': (ps) => ps.map(p => qWhichSummary(p, ps)),
  'takeaway-mc': (ps) => ps.map(p => qTakeawayMC(p, ps)),
  'theme-of': (ps) => ps.map(p => qThemeOf(p, ps)),
  'project-which': (ps) => ps.map(p => qProjectWhich(p, ps)),
  'project-open': (ps) => ps.map(qProjectOpen)
};

/** Generate a quiz.
 *  opts: { count, includeOpen, includeMC, focus: 'all'|'notes' } */
export function generate (areaId, { count = 8, includeOpen = true, includeMC = true, theme = '' } = {}) {
  const all = papersInArea(areaId);
  // A theme focuses which papers are ASKED about; distractors still come from the whole area.
  const focus = theme ? all.filter(p => p.theme === theme) : all;
  const ps = all;
  const avail = availability(areaId);
  let bag = [];
  for (const [type, builder] of Object.entries(BUILDERS)) {
    if (!avail.ok[type]) continue;
    const isOpen = ['takeaway-open', 'notes-open', 'cloze', 'group-of', 'project-open'].includes(type);
    if (isOpen && !includeOpen) continue;
    if (!isOpen && !includeMC) continue;
    const focusIds = new Set(focus.map(p => p.id));
    bag.push(...builder(ps).filter(q => q && focusIds.has(q.paperId)));
  }
  // de-duplicate identical prompts, shuffle, and cap
  const seen = new Set();
  bag = shuffle(bag).filter(q => (seen.has(q.prompt) ? false : seen.add(q.prompt)));
  return bag.slice(0, count);
}

export const TYPE_LABEL = {
  'author-of': 'Author', 'which-paper': 'Identify paper', 'metadata': 'Metadata',
  'concept': 'Key concept', 'group-of': 'Research group', 'takeaway-open': 'Takeaway',
  'notes-open': 'Your notes', 'cloze': 'Fill the gap',
  'which-summary': 'Identify from summary', 'takeaway-mc': 'Spot the takeaway', 'theme-of': 'Theme',
  'project-which': 'Project connection', 'project-open': 'Why it matters for the project'
};

/** Distinct themes in an area (for the Study focus selector). */
export function themesOf (areaId) {
  return [...new Set(papersInArea(areaId).map(p => p.theme).filter(Boolean))].sort();
}
