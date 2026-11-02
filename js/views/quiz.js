/* quiz.js — the Quiz section: free quizzes on the whole area + history.
   Post-study quizzes are launched from Study; all sessions are listed here. */
import { area as findArea, papersInArea, state, saveSession } from '../store.js';
import { go } from '../router.js';
import { qs, toast } from '../ui.js';
import { esc, fmtDate, uid } from '../utils/text.js';
import { generate, availability, TYPE_LABEL, themesOf } from '../quiz/generator.js';
import { runQuiz } from '../quiz/runner.js';
import { LABELS, sessionTitle, scoreText, exportSheet, exportButtonsHtml, wireExport } from '../quiz/export.js';

export default function quizView ({ area }) {
  const a = findArea(area);
  if (!a) { go('/areas', { replace: true }); return { title: '…', html: '' }; }
  let stopRunner = null;

  function setupHtml () {
    const avail = availability(area);
    const buildable = Object.entries(avail.ok).filter(([, v]) => v).map(([k]) => TYPE_LABEL[k]);
    const blocked = Object.entries(avail.info);
    const themes = themesOf(area);
    const sessions = state.sessions.filter(s => s.area === area).sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));
    return `
      <div class="card">
        <h3 style="margin:0 0 8px">Free quiz</h3>
        <p class="muted small" style="margin:0 0 12px">Mixed questions on <b>all ${papersInArea(area).length} papers</b> in ${esc(a.name)} — including bibliographic ones (authors, years, groups). For a quiz on what you just reviewed, use <a href="#/area/${esc(area)}/study">Study</a>.</p>
        <div class="field">
          <label for="q-count">Number of questions</label>
          <select id="q-count">${[5, 8, 10, 15, 20, 30, 50].map(n => `<option value="${n}" ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        ${themes.length ? `<div class="field">
          <label for="q-theme">Focus on theme</label>
          <select id="q-theme"><option value="">All themes</option>${themes.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
        </div>` : ''}
        <div class="btn-row" style="margin-bottom:6px">
          <label class="chip chip--tap"><input type="checkbox" id="q-mc" checked style="margin-right:6px">Multiple choice</label>
          <label class="chip chip--tap"><input type="checkbox" id="q-open" checked style="margin-right:6px">Open answer</label>
        </div>
        ${buildable.length ? `<p class="small muted" style="margin:10px 0 0">Available: ${buildable.map(esc).join(', ')}.</p>` : ''}
        ${blocked.length ? `<details style="margin-top:8px"><summary class="small muted">Some types need more material</summary>
          <ul class="small muted">${blocked.map(([k, why]) => `<li>${esc(TYPE_LABEL[k] || k)}: ${esc(why)}</li>`).join('')}</ul></details>` : ''}
        <button class="btn btn--primary btn--block" id="q-start" style="margin-top:14px">Start quiz</button>
      </div>
      ${sessions.length ? `
      <div class="detail-section">
        <h3>Past quizzes</h3>
        <div class="list">${sessions.map(s => `
          <div class="paper-item" data-session="${esc(s.id)}">
            <div class="paper-item__title">${sessionTitle(s)} · ${fmtDate(s.createdAt)} — ${s.questions.length} questions</div>
            <div class="paper-item__meta">Score ${scoreText(s)} · tap to export</div>
          </div>`).join('')}</div>
      </div>` : ''}`;
  }

  return {
    title: a.name, subtitle: 'Quiz', back: true, backTo: `/area/${area}`, titleText: a.name + ' · Quiz',
    html: `<div id="quiz-host">${setupHtml()}</div>`,
    mount (root) {
      const host = qs('#quiz-host', root);
      host.addEventListener('click', e => {
        if (e.target.closest('#q-start')) {
          const count = parseInt(qs('#q-count', host).value, 10);
          const includeMC = qs('#q-mc', host).checked, includeOpen = qs('#q-open', host).checked;
          const theme = (host.querySelector('#q-theme') || {}).value || '';
          if (!includeMC && !includeOpen) { toast('Pick at least one question style.', 'info'); return; }
          const questions = generate(area, { count, includeMC, includeOpen, theme });
          if (!questions.length) { toast('Not enough material yet. Add papers, notes and takeaways first.', 'info', 5000); return; }
          const session = { id: uid('s'), kind: 'free', area, createdAt: new Date().toISOString(), config: { count, includeMC, includeOpen, theme }, questions, answers: {}, results: {} };
          stopRunner = runQuiz(host, session, { labels: LABELS, onDone: s => done(s) });
          return;
        }
        const sc = e.target.closest('[data-session]');
        if (sc) exportSheet(state.sessions.find(s => s.id === sc.dataset.session), `/area/${area}/quiz`);
      });

      async function done (s) {
        stopRunner = null;
        await saveSession(s);
        host.innerHTML = `
          <div class="card" style="text-align:center">
            <div class="big-score">${s.score.correct}<span>/${s.score.total}</span></div>
            <p class="muted small" style="margin:4px 0 0">Multiple choice ${s.score.mcCorrect}/${s.score.mcTotal}${s.score.total > s.score.mcTotal ? ' · open answers self-graded' : ''}</p>
            <p class="muted small">Export and paste into the Cowork chat to have open answers checked.</p>
            ${exportButtonsHtml()}
            <div class="btn-row" style="justify-content:center;margin-top:14px">
              <button class="btn btn--primary" data-again>New quiz</button>
            </div>
          </div>`;
        wireExport(host, s);
        qs('[data-again]', host).addEventListener('click', () => { host.innerHTML = setupHtml(); });
        window.scrollTo(0, 0);
      }
    },
    cleanup () { if (stopRunner) try { stopRunner(); } catch (_) {} }
  };
}
