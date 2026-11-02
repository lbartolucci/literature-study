/* study.js — Study: spaced-repetition review of paper cards, then a quiz on
   exactly the papers just reviewed.
     setup → cards (recall · reveal · rate) → summary → quiz → results
   Ratings and quiz outcomes update the per-paper review state (srs.js), so
   the next session brings back what is due or was missed. */
import { area as findArea, state, paper as findPaper, review as findReview, saveSession } from '../store.js';
import { go } from '../router.js';
import { qs, toast } from '../ui.js';
import { esc, fmtDate, uid, authorsShort } from '../utils/text.js';
import { voicebarHTML, attachDictation } from '../dictation.js';
import { RATINGS, rate, quizResult, previewLabel, stats, themeStats, buildQueue, isNew, isDue } from '../srs.js';
import { generateReviewQuiz } from '../quiz/review.js';
import { runQuiz } from '../quiz/runner.js';
import { LABELS, exportButtonsHtml, wireExport } from '../quiz/export.js';

export default function studyView ({ area, query = {} }) {
  const a = findArea(area);
  if (!a) { go('/areas', { replace: true }); return { title: '…', html: '' }; }

  let host = null, dictCleanup = null, stopRunner = null, keyHandler = null;
  let theme = query.theme || '';
  let size = 10;
  // running session
  let deck = [], idx = 0, revealed = false, studied = [], tally = {};

  const projectsOf = p => [...new Set((p.projectLinks || []).map(l => (l.project || '').toUpperCase()).filter(Boolean))];
  const freeDict = () => { if (dictCleanup) { try { dictCleanup(); } catch (_) {} dictCleanup = null; } };

  /* ------------------------------------------------------------ setup -- */
  function setupHtml () {
    const s = stats(area, theme);
    const ts = themeStats(area);
    const q = buildQueue(area, { theme, limit: size });
    const dueN = q.filter(p => !isNew(findReview(p.id))).length, newN = q.length - dueN;
    const missed = state.reviews.filter(r => r.quizMiss && r.area === area).map(r => findPaper(r.id)).filter(p => p && (!theme || p.theme === theme));
    const tile = (n, label, cls = '') => `<div class="stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
    return `
      <div class="stat-row stat-row--4" style="margin-bottom:14px">
        ${tile(s.due, 'due today', s.due ? 'stat--hot' : '')}${tile(s.fresh, 'new')}${tile(s.learning + s.young, 'learning')}${tile(s.mature, 'mature')}
      </div>
      <div class="card">
        <h3 style="margin:0 0 6px">Study session</h3>
        <p class="muted small" style="margin:0 0 12px">Each card is a paper. Recall what it's about, reveal the card, rate how well you remembered it. Papers come back on a spaced schedule; anything you miss returns sooner. At the end, a quiz on the papers you just studied.</p>
        ${ts.length ? `<div class="field">
          <label for="st-theme">Theme</label>
          <select id="st-theme"><option value="">All themes</option>${ts.map(t => `<option value="${esc(t.theme)}" ${t.theme === theme ? 'selected' : ''}>${esc(t.theme)} — ${t.due} due · ${t.fresh} new</option>`).join('')}</select>
        </div>` : ''}
        <div class="field">
          <label for="st-size">Cards per session</label>
          <select id="st-size">${[5, 8, 10, 15, 20].map(n => `<option value="${n}" ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        ${q.length
          ? `<button class="btn btn--primary btn--block" data-start>Start · ${dueN ? `${dueN} due` : ''}${dueN && newN ? ' + ' : ''}${newN ? `${newN} new` : ''}</button>`
          : `<p class="small" style="margin:4px 0 10px">${s.total ? `All caught up${s.nextDue ? ` — next review ${esc(fmtDate(s.nextDue))}` : ''}.` : 'No papers with a summary, takeaways or notes to study yet.'}</p>
             ${s.total ? '<button class="btn btn--ghost btn--block" data-practice>Extra practice (weakest papers, ahead of schedule)</button>' : ''}`}
      </div>
      ${missed.length ? `<div class="detail-section"><h3>Missed in quizzes · due again</h3>
        <div class="list">${missed.slice(0, 6).map(p => `<a class="paper-item" href="#/area/${esc(area)}/paper/${esc(p.id)}"><div class="paper-item__title">${esc(p.title)}</div><div class="paper-item__meta">${esc(p.theme || '')}</div></a>`).join('')}</div></div>` : ''}
      <p class="muted small" style="margin-top:18px">Looking for quizzes on the whole area? <a href="#/area/${esc(area)}/quiz">Quiz section ›</a></p>`;
  }

  /* ------------------------------------------------------------ cards -- */
  function startDeck (papers, tagFor) {
    deck = papers.map(p => ({ p, tag: tagFor ? tagFor(p) : tagOf(p), repeat: 0 }));
    idx = 0; studied = []; tally = {};
    if (!deck.length) { toast('Nothing to study here.', 'info'); return; }
    renderCard();
  }
  function tagOf (p) {
    const r = findReview(p.id);
    if (r && r.quizMiss) return { cls: 'bad', text: 'Missed in quiz' };
    if (isNew(r)) return { cls: 'new', text: 'New' };
    if (isDue(r)) return { cls: 'due', text: 'Due' };
    return { cls: '', text: 'Practice' };
  }

  function renderCard () {
    freeDict();
    revealed = false;
    const { p, tag } = deck[idx];
    const projs = projectsOf(p);
    const nTk = (p.takeaways || []).length;
    const asks = [
      p.summary ? 'what they did and what they found' : '',
      nTk ? `the ${nTk} key point${nTk === 1 ? '' : 's'}` : '',
      projs.length ? `why it matters for ${projs.join(', ')}` : ''
    ].filter(Boolean);
    host.innerHTML = `
      <div class="quiz-progress"><div class="quiz-progress__bar" style="width:${Math.round(idx / deck.length * 100)}%"></div></div>
      <div class="quiz-top"><span>Card ${idx + 1} of ${deck.length}</span><span>${studied.length} studied</span></div>
      <div class="card flashcard">
        <div class="chips" style="margin-bottom:10px"><span class="chip tag tag--${tag.cls}">${esc(tag.text)}</span>${p.theme ? `<span class="chip chip--accent">${esc(p.theme)}</span>` : ''}</div>
        <div class="fc-title">${esc(p.title)}</div>
        <div class="detail-meta">${esc(authorsShort(p.authors))}${p.year ? ' · ' + p.year : ''}${p.venue ? ' · ' + esc(p.venue) : ''}</div>
        <div class="fc-prompt">
          <b>Recall before revealing</b>
          ${asks.length ? `<ul>${asks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="small" style="margin:6px 0 0">What is this paper about?</p>'}
          <details class="fc-write"><summary>Write it down first (optional)</summary>
            <textarea id="st-recall" placeholder="What you remember…"></textarea>
            ${voicebarHTML({ field: 'st-recall', label: 'Dictate', lang: state.settings.dictationLang || 'en-US', punctuation: state.settings.dictationPunctuation })}
          </details>
        </div>
        <div id="fc-back" hidden></div>
        <button class="btn btn--primary btn--block" data-show style="margin-top:14px">Show card</button>
      </div>
      <div id="fc-rate" hidden></div>
      <div class="btn-row" style="margin:4px 0 30px;justify-content:space-between">
        <button class="btn btn--ghost btn--small" data-quit>End session</button>
        <a class="btn btn--ghost btn--small" href="#/area/${esc(area)}/paper/${esc(p.id)}">Open paper ›</a>
      </div>`;
    dictCleanup = attachDictation(host, { punctuation: state.settings.dictationPunctuation });
    window.scrollTo(0, 0);
  }

  function backHtml (p, written) {
    const tk = (p.takeaways || []).filter(Boolean);
    const sec = (h, body) => `<div class="detail-section"><h3>${h}</h3>${body}</div>`;
    const parts = [];
    if (written) parts.push(sec('What you wrote', `<p class="prose fc-written">${esc(written)}</p>`));
    if (p.summary) parts.push(sec('Summary', `<p class="prose">${esc(p.summary)}</p>`));
    if (tk.length) parts.push(sec('Key points', `<ol class="fc-points">${tk.map(t => `<li>${esc(t)}</li>`).join('')}</ol>`));
    (p.projectLinks || []).filter(l => l.text).forEach(l => parts.push(sec(`Why it matters · ${esc((l.project || 'project').toUpperCase())}`, `<p class="prose">${esc(l.text)}</p>`)));
    if ((p.notes || '').trim()) parts.push(sec('Your notes', `<p class="prose">${esc(p.notes)}</p>`));
    if (p.abstract) {
      const alone = !p.summary && !tk.length;
      parts.push(alone ? sec('Abstract', `<p class="abstract">${esc(p.abstract)}</p>`)
        : `<details class="detail-section"><summary class="small muted">Abstract</summary><p class="abstract">${esc(p.abstract)}</p></details>`);
    }
    return parts.join('');
  }

  function reveal () {
    if (revealed) return;
    revealed = true;
    const { p } = deck[idx];
    const ta = qs('#st-recall', host);
    const written = ta ? ta.value.trim() : '';
    freeDict();
    const wr = qs('.fc-write', host); if (wr && !written) wr.remove(); else if (ta) ta.setAttribute('readonly', '');
    const back = qs('#fc-back', host);
    back.innerHTML = '<hr class="divider">' + backHtml(p, written);
    back.hidden = false;
    qs('[data-show]', host).remove();
    const r = findReview(p.id);
    const rateBox = qs('#fc-rate', host);
    rateBox.innerHTML = `<p class="muted small" style="margin:0 0 8px;text-align:center">How well did you remember it?</p>
      <div class="rate-row">${RATINGS.map((x, k) => `
        <button class="rate rate--${x.id}" data-rate="${x.id}" title="${esc(x.hint)} (${k + 1})">
          <b>${x.label}</b><span>${previewLabel(r, x.id)}</span></button>`).join('')}</div>`;
    rateBox.hidden = false;
  }

  async function doRate (rating) {
    if (!revealed) return;
    revealed = false;                       // guard against double taps while saving
    const item = deck[idx];
    try { await rate(item.p, rating); } catch (e) { console.error(e); toast('Could not save the rating.', 'error'); }
    tally[rating] = (tally[rating] || 0) + 1;
    if (!studied.some(p => p.id === item.p.id)) studied.push(item.p);
    if (rating === 'again' && item.repeat < 1) deck.push({ ...item, tag: { cls: 'bad', text: 'Again' }, repeat: item.repeat + 1 });
    idx++;
    if (idx < deck.length) renderCard(); else summary();
  }

  /* ---------------------------------------------------------- summary -- */
  function summary () {
    freeDict();
    if (!studied.length) { host.innerHTML = setupHtml(); return; }
    host.innerHTML = `
      <div class="card" style="text-align:center">
        <h3 style="margin:0 0 4px">Session done</h3>
        <p class="muted small" style="margin:0">${studied.length} paper${studied.length === 1 ? '' : 's'} studied</p>
        <div class="chips" style="justify-content:center;margin:12px 0 4px">${RATINGS.filter(x => tally[x.id]).map(x => `<span class="chip tag tag--r-${x.id}">${x.label} ${tally[x.id]}</span>`).join('')}</div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 6px">Quiz on what you just studied</h3>
        <p class="muted small" style="margin:0 0 12px">Questions only on these ${studied.length} papers: spot the key point, odd one out, whose finding, project link, plus recall questions you grade yourself. Mistakes send the paper back to Study today.</p>
        <div class="field">
          <label for="qz-per">Questions per paper</label>
          <select id="qz-per">${[1, 2, 3].map(n => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        <label class="chip chip--tap"><input type="checkbox" id="qz-open" checked style="margin-right:6px">Include recall questions (self-graded)</label>
        <button class="btn btn--primary btn--block" data-quiz style="margin-top:14px">Start quiz</button>
        <button class="btn btn--ghost btn--block" data-skip style="margin-top:8px">Skip quiz</button>
      </div>`;
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------- quiz -- */
  function startQuiz () {
    const perPaper = parseInt(qs('#qz-per', host).value, 10);
    const includeOpen = qs('#qz-open', host).checked;
    const questions = generateReviewQuiz(studied, { perPaper, includeOpen });
    if (!questions.length) { toast('Not enough material on these papers for a quiz.', 'info', 4500); return; }
    const session = { id: uid('s'), kind: 'review', area, createdAt: new Date().toISOString(),
      config: { perPaper, includeOpen, theme }, paperIds: studied.map(p => p.id), questions, answers: {}, results: {} };
    stopRunner = runQuiz(host, session, { labels: LABELS, onDone: s => results(s) });
  }

  async function results (s) {
    stopRunner = null;
    // per-paper score → review state
    const per = new Map();
    s.questions.forEach(q => {
      const r = s.results[q.id]; if (!r) return;
      const e = per.get(q.paperId) || { sum: 0, n: 0 }; e.sum += r.score; e.n++; per.set(q.paperId, e);
    });
    const rows = [];
    for (const [pid, e] of per) {
      const p = findPaper(pid); if (!p) continue;
      const sc = e.sum / e.n;
      try { await quizResult(p, sc); } catch (err) { console.error(err); }
      rows.push({ p, sc });
    }
    rows.sort((x, y) => x.sc - y.sc);
    const missed = rows.filter(x => x.sc < 0.5).map(x => x.p);
    await saveSession(s);
    host.innerHTML = `
      <div class="card" style="text-align:center">
        <div class="big-score">${s.score.correct}<span>/${s.score.total}</span></div>
        <p class="muted small" style="margin:4px 0 0">Multiple choice ${s.score.mcCorrect}/${s.score.mcTotal}${s.score.total > s.score.mcTotal ? ' · recall self-graded' : ''}</p>
        ${missed.length ? `<p class="small" style="margin:10px 0 0"><b>${missed.length}</b> paper${missed.length === 1 ? '' : 's'} back in Study today.</p>` : '<p class="small" style="margin:10px 0 0;color:var(--good)">No paper missed.</p>'}
        ${exportButtonsHtml()}
      </div>
      <div class="detail-section"><h3>By paper</h3>
        <div class="list">${rows.map(({ p, sc }) => `
          <a class="paper-item" href="#/area/${esc(area)}/paper/${esc(p.id)}">
            <div class="paper-item__title"><span class="score-dot ${sc >= 0.75 ? 'is-good' : sc >= 0.5 ? 'is-mid' : 'is-bad'}"></span>${esc(p.title)}</div>
            <div class="paper-item__meta">${Math.round(sc * 100)}%${sc < 0.5 ? ' · due again today' : ''}</div>
          </a>`).join('')}</div>
      </div>
      <div class="btn-row" style="margin:16px 0 30px">
        ${missed.length ? `<button class="btn btn--primary" data-restudy>Restudy missed now (${missed.length})</button>` : ''}
        <button class="btn btn--ghost" data-done>Done</button>
      </div>`;
    wireExport(host, s);
    host._missed = missed;
    window.scrollTo(0, 0);
  }

  /* ----------------------------------------------------------- wiring -- */
  return {
    title: a.name, subtitle: 'Study', back: true, backTo: `/area/${area}`, titleText: a.name + ' · Study',
    html: '<div id="study-host"></div>',
    mount (root) {
      host = qs('#study-host', root);
      host.innerHTML = setupHtml();

      host.addEventListener('change', e => {
        if (e.target.id === 'st-theme') { theme = e.target.value; host.innerHTML = setupHtml(); }
        if (e.target.id === 'st-size') { size = parseInt(e.target.value, 10); host.innerHTML = setupHtml(); }
      });
      host.addEventListener('click', e => {
        if (stopRunner) return;                 // the quiz runner handles its own clicks
        if (e.target.closest('[data-start]')) return startDeck(buildQueue(area, { theme, limit: size }));
        if (e.target.closest('[data-practice]')) return startDeck(buildQueue(area, { theme, limit: size, practice: true }));
        if (e.target.closest('[data-show]')) return reveal();
        const r = e.target.closest('[data-rate]'); if (r) return doRate(r.dataset.rate);
        if (e.target.closest('[data-quit]')) { deck = deck.slice(0, idx); return summary(); }
        if (e.target.closest('[data-quiz]')) return startQuiz();
        if (e.target.closest('[data-skip]') || e.target.closest('[data-done]')) { host.innerHTML = setupHtml(); window.scrollTo(0, 0); return; }
        if (e.target.closest('[data-restudy]')) return startDeck(host._missed || [], () => ({ cls: 'bad', text: 'Missed in quiz' }));
      });
      keyHandler = e => {
        if (!host || !host.isConnected || stopRunner || !deck.length || idx >= deck.length) return;
        if (!qs('.flashcard', host)) return;
        const inText = e.target && /TEXTAREA|INPUT|SELECT/.test(e.target.tagName);
        if (inText) return;
        if (!revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
        else if (revealed && /^[1-4]$/.test(e.key)) { e.preventDefault(); doRate(RATINGS[parseInt(e.key, 10) - 1].id); }
      };
      document.addEventListener('keydown', keyHandler);
    },
    cleanup () {
      freeDict();
      if (stopRunner) try { stopRunner(); } catch (_) {}
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
    }
  };
}
