/* export.js — export a saved quiz session (Markdown / JSON / clipboard). */
import { area as findArea, paper as findPaper, deleteSession } from '../store.js';
import { go } from '../router.js';
import { toast, download, copyText, openSheet } from '../ui.js';
import { fmtDate } from '../utils/text.js';
import { TYPE_LABEL } from './generator.js';
import { REVIEW_LABEL } from './review.js';

export const LABELS = { ...TYPE_LABEL, ...REVIEW_LABEL };
const SELF_LABEL = { got: 'got it', partial: 'partly', missed: 'missed' };

export function sessionTitle (s) {
  return s.kind === 'review' ? 'After study' : 'Free quiz';
}
export function scoreText (s) {
  if (!s.score) return 'not graded';
  return `${s.score.correct}/${s.score.total}`;
}

function fileName (s, ext) {
  const a = findArea(s.area);
  return `litstudy-quiz-${(a ? a.id : 'area')}-${s.createdAt.slice(0, 10)}.${ext}`;
}
const titleOf = q => { const p = findPaper(q.paperId); return p ? p.title : ''; };
function resultText (s, q) {
  const r = (s.results || {})[q.id];
  if (!r) return '';
  if (q.kind === 'mc') return r.score === 1 ? 'correct' : 'wrong';
  return 'self-graded: ' + (SELF_LABEL[r.self] || r.score);
}

export function toJson (s) {
  return JSON.stringify({
    app: 'LiteratureStudy', kind: 'study-session', quizKind: s.kind || 'free',
    area: (findArea(s.area) || {}).name || s.area,
    createdAt: s.createdAt, config: s.config, score: s.score || null,
    instructions: 'Please verify my answers. For multiple-choice, confirm correctness. For open answers, judge them against each paper\'s card (field "expected") and give concise feedback and a score; also check my self-grade.',
    questions: s.questions.map(q => ({
      type: q.type, kind: q.kind, prompt: q.prompt, context: q.context || '',
      paperTitle: titleOf(q),
      options: q.kind === 'mc' ? q.options.map(o => o.text) : undefined,
      correctAnswer: q.kind === 'mc' ? q.answer : undefined,
      expected: q.kind === 'open' ? q.answer : undefined,
      myAnswer: (s.answers || {})[q.id] || '',
      result: resultText(s, q)
    }))
  }, null, 2);
}

export function toMarkdown (s) {
  const L = [];
  L.push('# LiteratureStudy — Quiz session', '');
  L.push(`**Area:** ${(findArea(s.area) || {}).name || s.area}  `);
  L.push(`**Type:** ${sessionTitle(s)}  `);
  L.push(`**Date:** ${fmtDate(s.createdAt)}  `);
  if (s.score) L.push(`**Score:** ${scoreText(s)}  `);
  L.push('', '> Please verify my answers. Confirm the multiple-choice ones, and judge each open answer against the paper it refers to (the "On my card" line) — concise feedback and a score out of 5; check my self-grade too.', '');
  s.questions.forEach((q, i) => {
    L.push(`## Q${i + 1} · ${LABELS[q.type] || q.type} (${q.kind === 'mc' ? 'multiple choice' : 'open'})`);
    const t = titleOf(q); if (t) L.push(`*Paper: ${t}*`);
    L.push('', q.prompt);
    if (q.context) L.push('', `> ${q.context.replace(/\n/g, ' ')}`);
    L.push('');
    const mine = (s.answers || {})[q.id] || '(none)';
    if (q.kind === 'mc') {
      q.options.forEach(o => L.push(`- ${o.text === q.answer ? '**' + o.text + '**' : o.text}`));
      L.push('', `- **My answer:** ${mine}`, `- **Correct answer:** ${q.answer}`);
    } else {
      L.push(`**My answer:** ${mine}`, '', `**On my card:** ${(q.answer || '(open — judge from the paper)').replace(/\n/g, ' · ')}`);
    }
    const r = resultText(s, q); if (r) L.push('', `*Result: ${r}*`);
    L.push('');
  });
  return L.join('\n');
}

export function exportButtonsHtml () {
  return `<div class="btn-row" style="justify-content:center;margin-top:10px">
      <button class="btn btn--ghost btn--small" data-export-md>Markdown</button>
      <button class="btn btn--ghost btn--small" data-export-json>JSON</button>
      <button class="btn btn--ghost btn--small" data-copy-md>Copy for chat</button>
    </div>`;
}
export function wireExport (root, s) {
  root.querySelector('[data-export-md]').addEventListener('click', () => download(fileName(s, 'md'), toMarkdown(s), 'text/markdown'));
  root.querySelector('[data-export-json]').addEventListener('click', () => download(fileName(s, 'json'), toJson(s), 'application/json'));
  root.querySelector('[data-copy-md]').addEventListener('click', async () => { const ok = await copyText(toMarkdown(s)); toast(ok ? 'Copied — paste into chat.' : 'Copy failed; use Export instead.', ok ? 'ok' : 'error'); });
}

export function exportSheet (s, backTo) {
  if (!s) return;
  const { root } = openSheet({ title: 'Export quiz' });
  root.innerHTML = `
    <p class="muted small">${sessionTitle(s)} · ${fmtDate(s.createdAt)} · ${s.questions.length} questions · score ${scoreText(s)}</p>
    ${exportButtonsHtml()}
    <button class="btn btn--danger btn--small" data-del style="margin-top:14px">Delete this session</button>`;
  wireExport(root, s);
  root.querySelector('[data-del]').addEventListener('click', async () => { await deleteSession(s.id); toast('Session deleted.'); go(backTo || `/area/${s.area}/quiz`); });
}
