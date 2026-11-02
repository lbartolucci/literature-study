/* =========================================================================
   runner.js — play a quiz one question at a time, with immediate feedback.
   · Multiple choice: tap an option (or press 1–4) → correct/wrong shown at
     once, with the source paper; Next (Enter) to continue.
   · Open / recall: type or dictate, "Show answer" (Enter) → compare with the
     card, then grade yourself Got it / Partly / Missed (1/2/3).
   Fills session.answers[qid] (text) and session.results[qid] = { score, self }.
   ========================================================================= */

import { state, paper as findPaper } from '../store.js';
import { qs, qsa } from '../ui.js';
import { esc, answerAcceptable } from '../utils/text.js';
import { voicebarHTML, attachDictation } from '../dictation.js';

const SELF = [
  { id: 'got', label: 'Got it', score: 1 },
  { id: 'partial', label: 'Partly', score: 0.5 },
  { id: 'missed', label: 'Missed', score: 0 }
];

export function scoreOf (session) {
  const rs = session.questions.map(q => (session.results || {})[q.id]).filter(Boolean);
  const points = rs.reduce((s, r) => s + (r.score || 0), 0);
  const mc = session.questions.filter(q => q.kind === 'mc');
  const mcCorrect = mc.filter(q => ((session.results || {})[q.id] || {}).score === 1).length;
  return { correct: Math.round(points * 10) / 10, total: session.questions.length, mcCorrect, mcTotal: mc.length };
}

/** Mount the runner into `host`. labels: type → label. Returns a cleanup fn. */
export function runQuiz (host, session, { labels = {}, onDone = () => {} } = {}) {
  session.answers = session.answers || {};
  session.results = session.results || {};
  let i = 0, stage = 'ask', dictCleanup = null;

  function render () {
    if (dictCleanup) { try { dictCleanup(); } catch (_) {} dictCleanup = null; }
    const q = session.questions[i];
    const n = session.questions.length;
    const sc = scoreOf(session);
    const body = q.kind === 'mc'
      ? `<div class="options">${q.options.map((o, k) => `<button class="option" type="button" data-opt="${k}"><span class="option__key">${k + 1}</span>${esc(o.text)}</button>`).join('')}</div>`
      : `<textarea id="ans-${q.id}" placeholder="Type or dictate what you remember…">${esc(session.answers[q.id] || '')}</textarea>
         ${voicebarHTML({ field: `ans-${q.id}`, label: 'Dictate', lang: state.settings.dictationLang || 'en-US', punctuation: state.settings.dictationPunctuation })}
         ${q.hint ? `<p class="muted small" style="margin:8px 0 0">${esc(q.hint)}</p>` : ''}
         <button class="btn btn--primary btn--block" data-reveal style="margin-top:12px">Show answer</button>`;
    host.innerHTML = `
      <div class="quiz-progress"><div class="quiz-progress__bar" style="width:${Math.round(i / n * 100)}%"></div></div>
      <div class="quiz-top"><span>Question ${i + 1} of ${n}</span><span>Score ${sc.correct}/${i}</span></div>
      <div class="card qcard">
        <div class="q-kind">${esc(labels[q.type] || q.type)} · ${q.kind === 'mc' ? 'multiple choice' : 'recall'}</div>
        <div class="q-text">${esc(q.prompt)}</div>
        ${q.context ? `<blockquote class="q-quote">${esc(q.context)}</blockquote>` : ''}
        ${body}
        <div class="q-feedback" hidden></div>
      </div>
      <div class="btn-row" style="margin:6px 0 30px"><button class="btn btn--primary btn--block" data-next hidden>${i + 1 < n ? 'Next' : 'See results'}</button></div>`;
    stage = 'ask';
    if (q.kind !== 'mc') dictCleanup = attachDictation(host, { punctuation: state.settings.dictationPunctuation });
    window.scrollTo(0, 0);
  }

  function sourceLine (q) {
    const p = findPaper(q.paperId);
    return p ? `<div class="q-source">From: ${esc(p.title)}</div>` : '';
  }

  function chooseMC (k) {
    const q = session.questions[i];
    if (stage !== 'ask' || q.kind !== 'mc') return;
    const o = q.options[k]; if (!o) return;
    const ok = o.text === q.answer;
    session.answers[q.id] = o.text;
    session.results[q.id] = { score: ok ? 1 : 0 };
    qsa('.option', host).forEach((b, kk) => {
      const t = q.options[kk].text;
      if (t === q.answer) b.classList.add('is-correct');
      else if (kk === k) b.classList.add('is-wrong');
      b.disabled = true;
    });
    const fb = qs('.q-feedback', host);
    fb.hidden = false;
    fb.className = 'q-feedback ' + (ok ? 'is-good' : 'is-bad');
    fb.innerHTML = `<b>${ok ? '✓ Correct' : '✗ Not quite'}</b>${ok ? '' : ' — the right answer is highlighted.'}
      ${q.explain ? `<div style="margin-top:6px">${esc(q.explain)}</div>` : ''}${sourceLine(q)}`;
    stage = 'done';
    const nx = qs('[data-next]', host); nx.hidden = false; nx.focus({ preventScroll: true });
  }

  function reveal () {
    const q = session.questions[i];
    if (stage !== 'ask' || q.kind === 'mc') return;
    const ta = qs(`#ans-${q.id}`, host);
    const given = ta ? ta.value.trim() : '';
    session.answers[q.id] = given;
    if (ta) ta.setAttribute('readonly', '');
    if (dictCleanup) { try { dictCleanup(); } catch (_) {} dictCleanup = null; }
    qs('[data-reveal]', host).remove();
    const lines = String(q.answer || '').split('\n').filter(Boolean);
    const expected = lines.length > 1
      ? `<ol class="q-expected-list">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>`
      : `<p class="prose" style="margin:6px 0 0">${esc(q.answer || '(judge from the paper)')}</p>`;
    const close = q.answer && q.answer.length < 60 && answerAcceptable(given, q.answer);
    const fb = qs('.q-feedback', host);
    fb.hidden = false; fb.className = 'q-feedback';
    fb.innerHTML = `<b>On your card:</b>${expected}${sourceLine(q)}
      ${close ? '<div class="small" style="color:var(--good);margin-top:6px">Your answer looks close.</div>' : ''}
      <div class="small muted" style="margin-top:10px">How did you do?</div>
      <div class="self-grade">${SELF.map((s, k) => `<button class="btn btn--small grade grade--${s.id}" data-self="${s.id}"><span class="option__key">${k + 1}</span>${s.label}</button>`).join('')}</div>`;
    stage = 'grade';
  }

  function grade (id) {
    const q = session.questions[i];
    if (stage !== 'grade') return;
    const s = SELF.find(x => x.id === id); if (!s) return;
    session.results[q.id] = { score: s.score, self: s.id };
    advance();
  }

  function advance () {
    if (i + 1 < session.questions.length) { i++; render(); }
    else { cleanup(); session.score = scoreOf(session); onDone(session); }
  }

  function onClick (e) {
    const o = e.target.closest('[data-opt]'); if (o) return chooseMC(parseInt(o.dataset.opt, 10));
    if (e.target.closest('[data-reveal]')) return reveal();
    const g = e.target.closest('[data-self]'); if (g) return grade(g.dataset.self);
    if (e.target.closest('[data-next]')) return advance();
  }
  function onKey (e) {
    if (!host.isConnected) return;
    const inText = e.target && /TEXTAREA|INPUT|SELECT/.test(e.target.tagName);
    const q = session.questions[i];
    if (stage === 'ask' && q.kind === 'mc' && !inText && /^[1-9]$/.test(e.key)) { e.preventDefault(); chooseMC(parseInt(e.key, 10) - 1); }
    else if (stage === 'ask' && q.kind !== 'mc' && e.key === 'Enter' && (e.ctrlKey || e.metaKey || !inText)) { e.preventDefault(); reveal(); }
    else if (stage === 'grade' && !inText && /^[1-3]$/.test(e.key)) { e.preventDefault(); grade(SELF[parseInt(e.key, 10) - 1].id); }
    else if (stage === 'done' && e.key === 'Enter') { e.preventDefault(); advance(); }
  }

  host.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  function cleanup () {
    host.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    if (dictCleanup) { try { dictCleanup(); } catch (_) {} dictCleanup = null; }
  }
  render();
  return cleanup;
}
