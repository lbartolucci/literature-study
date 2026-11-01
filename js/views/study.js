/* study.js — generate a quiz from the area's papers, run it, export it. */
import { area as findArea, papersInArea, paper as findPaper, state, saveSession, deleteSession } from '../store.js';
import { go } from '../router.js';
import { qs, qsa, toast, download, copyText, confirmDialog } from '../ui.js';
import { esc, fmtDate, uid, answerAcceptable } from '../utils/text.js';
import { voicebarHTML, attachDictation } from '../dictation.js';
import { generate, availability, TYPE_LABEL, themesOf } from '../quiz/generator.js';

export default function studyView ({ area }) {
  const a = findArea(area);
  if (!a) { go('/areas', { replace: true }); return { title: '…', html: '' }; }

  let dictCleanup = null;
  let current = null;   // { id, area, createdAt, config, questions, answers }

  const avail = availability(area);
  const sessions = state.sessions.filter(s => s.area === area).sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));

  function setupHtml () {
    const buildable = Object.entries(avail.ok).filter(([, v]) => v).map(([k]) => TYPE_LABEL[k]);
    const blocked = Object.entries(avail.info);
    return `
      <div class="card">
        <h3 style="margin:0 0 8px">New quiz</h3>
        <p class="muted small" style="margin:0 0 12px">Questions are built from your papers, notes, takeaways, authors and groups in <b>${esc(a.name)}</b>. ${papersInArea(area).length} paper(s) available.</p>
        <div class="field">
          <label for="q-count">Number of questions</label>
          <select id="q-count">${[5, 8, 10, 15, 20, 30, 50].map(n => `<option value="${n}" ${n === 8 ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        ${themesOf(area).length ? `<div class="field">
          <label for="q-theme">Focus on theme</label>
          <select id="q-theme"><option value="">All themes</option>${themesOf(area).map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
        </div>` : ''}
        <div class="btn-row" style="margin-bottom:6px">
          <label class="chip chip--tap"><input type="checkbox" id="q-mc" checked style="margin-right:6px">Multiple choice</label>
          <label class="chip chip--tap"><input type="checkbox" id="q-open" checked style="margin-right:6px">Open answer</label>
        </div>
        ${buildable.length ? `<p class="small muted" style="margin:10px 0 0">Available: ${buildable.map(esc).join(', ')}.</p>` : ''}
        ${blocked.length ? `<details style="margin-top:8px"><summary class="small muted">Some types need more material</summary>
          <ul class="small muted">${blocked.map(([k, why]) => `<li>${esc(TYPE_LABEL[k] || k)}: ${esc(why)}</li>`).join('')}</ul></details>` : ''}
        <button class="btn btn--primary btn--block" id="q-start" style="margin-top:14px">Generate quiz</button>
      </div>
      ${sessions.length ? `
      <div class="detail-section">
        <h3>Past quizzes</h3>
        <div class="list">${sessions.map(s => `
          <div class="paper-item" data-session="${esc(s.id)}">
            <div class="paper-item__title">${fmtDate(s.createdAt)} — ${s.questions.length} questions</div>
            <div class="paper-item__meta">${s.score ? `MC score ${s.score.correct}/${s.score.total}` : 'not graded'} · tap to export</div>
          </div>`).join('')}</div>
      </div>` : ''}`;
  }

  function runHtml (session) {
    const qs_ = session.questions.map((q, i) => questionCard(q, i)).join('');
    return `
      <div class="quiz-progress"><div class="quiz-progress__bar" id="qbar" style="width:0%"></div></div>
      <p class="muted small" id="qcount">0 of ${session.questions.length} answered</p>
      ${qs_}
      <div class="btn-row" style="margin:10px 0 30px">
        <button class="btn btn--primary btn--block" id="q-finish">Finish & grade</button>
      </div>`;
  }

  function questionCard (q, i) {
    const body = q.kind === 'mc'
      ? `<div class="options" data-q="${q.id}">${q.options.map((o, oi) => `<button class="option" type="button" data-opt="${oi}">${esc(o.text)}</button>`).join('')}</div>`
      : `<textarea id="ans-${q.id}" data-q="${q.id}" placeholder="Type or dictate your answer…"></textarea>${voicebarHTML({ field: `ans-${q.id}`, label: 'Dictate' })}`;
    return `
      <div class="card" id="card-${q.id}">
        <div class="q-kind">${esc(TYPE_LABEL[q.type] || q.type)} · ${q.kind === 'mc' ? 'multiple choice' : 'open'}</div>
        <div class="q-text">${i + 1}. ${esc(q.prompt)}</div>
        ${q.context ? `<div class="q-context">${esc(q.context)}</div>` : ''}
        ${body}
      </div>`;
  }

  return {
    title: a.name, subtitle: 'Study', back: true, backTo: `/area/${area}`, titleText: a.name + ' · Study',
    html: `<div id="study-host">${setupHtml()}</div>`,
    mount (root) {
      const host = qs('#study-host', root);

      host.addEventListener('click', async e => {
        // start
        if (e.target.closest('#q-start')) {
          const count = parseInt(qs('#q-count', host).value, 10);
          const includeMC = qs('#q-mc', host).checked;
          const includeOpen = qs('#q-open', host).checked;
          if (!includeMC && !includeOpen) { toast('Pick at least one question style.', 'info'); return; }
          const questions = generate(area, { count, includeMC, includeOpen, theme: (host.querySelector('#q-theme') || {}).value || '' });
          if (!questions.length) { toast('Not enough material yet. Add papers, notes and takeaways first.', 'info', 5000); return; }
          current = { id: uid('s'), area, createdAt: new Date().toISOString(), config: { count, includeMC, includeOpen, theme: (host.querySelector('#q-theme') || {}).value || '' }, questions, answers: {} };
          host.innerHTML = runHtml(current);
          if (dictCleanup) dictCleanup();
          dictCleanup = attachDictation(host, { punctuation: state.settings.dictationPunctuation });
          window.scrollTo(0, 0);
          return;
        }
        // select MC option
        const opt = e.target.closest('.option');
        if (opt) {
          const group = opt.closest('.options');
          const qid = group.dataset.q;
          qsa('.option', group).forEach(o => o.classList.remove('is-selected'));
          opt.classList.add('is-selected');
          current.answers[qid] = opt.textContent.trim();
          updateProgress();
          return;
        }
        // finish
        if (e.target.closest('#q-finish')) { finish(); return; }
        // open a past session
        const sc = e.target.closest('[data-session]');
        if (sc) { exportSheet(state.sessions.find(s => s.id === sc.dataset.session)); return; }
      });

      host.addEventListener('input', e => {
        const ta = e.target.closest('textarea[data-q]');
        if (ta) { current.answers[ta.dataset.q] = ta.value.trim(); updateProgress(); }
      });

      function updateProgress () {
        if (!current) return;
        const answered = current.questions.filter(q => (current.answers[q.id] || '').length).length;
        const bar = qs('#qbar', host); const c = qs('#qcount', host);
        if (bar) bar.style.width = Math.round(answered / current.questions.length * 100) + '%';
        if (c) c.textContent = `${answered} of ${current.questions.length} answered`;
      }

      async function finish () {
        let correct = 0, mcTotal = 0;
        for (const q of current.questions) {
          const given = current.answers[q.id] || '';
          const card = qs(`#card-${q.id}`, host);
          if (q.kind === 'mc') {
            mcTotal++;
            const isRight = given && q.answer && given.trim().toLowerCase() === q.answer.trim().toLowerCase();
            if (isRight) correct++;
            qsa('.option', card).forEach(o => {
              const t = o.textContent.trim();
              if (t.toLowerCase() === q.answer.trim().toLowerCase()) o.classList.add('is-correct');
              else if (t === given) o.classList.add('is-wrong');
              o.style.pointerEvents = 'none';
            });
          } else {
            const ta = qs(`#ans-${q.id}`, host); if (ta) ta.setAttribute('readonly', '');
            const hint = answerAcceptable(given, q.answer);
            const note = document.createElement('div');
            note.className = 'q-context';
            note.style.marginTop = '10px';
            note.innerHTML = given
              ? `Saved for review. ${hint ? '<b style="color:var(--good)">Looks close to your notes.</b>' : 'Export and verify in chat for a proper judgement.'}`
              : '<span class="muted">No answer given.</span>';
            card.appendChild(note);
          }
        }
        current.score = { correct, total: mcTotal };
        await saveSession(current);
        toast(`Saved. Multiple-choice score: ${correct}/${mcTotal}.`, 'ok', 4500);
        // finish bar + export controls
        const finishBtn = qs('#q-finish', host);
        finishBtn.outerHTML = `
          <div class="card" style="text-align:center">
            <h3 style="margin:0 0 4px">Multiple-choice: ${correct}/${mcTotal}</h3>
            <p class="muted small">Open answers are saved as-is. Export the session and paste it into this Cowork project's chat to have your open answers verified against the papers.</p>
            <div class="btn-row" style="justify-content:center;margin-top:10px">
              <button class="btn btn--primary" data-export-md>Export Markdown</button>
              <button class="btn btn--ghost" data-export-json>Export JSON</button>
              <button class="btn btn--ghost" data-copy-md>Copy for chat</button>
            </div>
          </div>`;
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        qs('[data-export-md]', host).addEventListener('click', () => download(fileName(current, 'md'), toMarkdown(current), 'text/markdown'));
        qs('[data-export-json]', host).addEventListener('click', () => download(fileName(current, 'json'), toJson(current), 'application/json'));
        qs('[data-copy-md]', host).addEventListener('click', async () => { const ok = await copyText(toMarkdown(current)); toast(ok ? 'Copied — paste into chat.' : 'Copy failed; use Export instead.', ok ? 'ok' : 'error'); });
      }
    },
    cleanup () { if (dictCleanup) try { dictCleanup(); } catch (_) {} }
  };
}

/* --------------------------------------------------------------- export -- */

function fileName (s, ext) {
  const a = findArea(s.area);
  return `litstudy-quiz-${(a ? a.id : 'area')}-${s.createdAt.slice(0, 10)}.${ext}`;
}

function enrich (q) {
  const p = findPaper(q.paperId);
  return { ...q, paperTitle: p ? p.title : '' };
}

function toJson (s) {
  const out = {
    app: 'LiteratureStudy', kind: 'study-session',
    area: (findArea(s.area) || {}).name || s.area,
    createdAt: s.createdAt, config: s.config, score: s.score || null,
    instructions: 'Please verify my answers. For multiple-choice, confirm correctness. For open answers, judge them against each paper\'s notes/takeaways/abstract (field "expected") and give concise feedback and a score.',
    questions: s.questions.map(q => {
      const e = enrich(q);
      return {
        type: q.type, kind: q.kind, prompt: q.prompt, context: q.context || '',
        paperTitle: e.paperTitle,
        options: q.kind === 'mc' ? q.options.map(o => o.text) : undefined,
        correctAnswer: q.kind === 'mc' ? q.answer : undefined,
        expected: q.kind === 'open' ? q.answer : undefined,
        myAnswer: s.answers[q.id] || ''
      };
    })
  };
  return JSON.stringify(out, null, 2);
}

function toMarkdown (s) {
  const areaName = (findArea(s.area) || {}).name || s.area;
  const lines = [];
  lines.push(`# LiteratureStudy — Study session`);
  lines.push('');
  lines.push(`**Area:** ${areaName}  `);
  lines.push(`**Date:** ${fmtDate(s.createdAt)}  `);
  if (s.score) lines.push(`**Multiple-choice score:** ${s.score.correct}/${s.score.total}  `);
  lines.push('');
  lines.push('> Please verify my answers. Confirm the multiple-choice ones, and judge each open answer against the paper it refers to (the "Expected / from my notes" line) — give concise feedback and a score out of 5.');
  lines.push('');
  s.questions.forEach((q, i) => {
    const e = enrich(q);
    lines.push(`## Q${i + 1} · ${TYPE_LABEL[q.type] || q.type} (${q.kind === 'mc' ? 'multiple choice' : 'open'})`);
    if (e.paperTitle) lines.push(`*Paper: ${e.paperTitle}*`);
    lines.push('');
    lines.push(q.prompt);
    if (q.context) lines.push('', `> ${q.context.replace(/\n/g, ' ')}`);
    lines.push('');
    if (q.kind === 'mc') {
      q.options.forEach(o => lines.push(`- ${o.text === q.answer ? '**' + o.text + '**' : o.text}`));
      lines.push('');
      lines.push(`- **My answer:** ${s.answers[q.id] || '(none)'}`);
      lines.push(`- **Correct answer:** ${q.answer}`);
    } else {
      lines.push(`**My answer:** ${s.answers[q.id] || '(none)'}`);
      lines.push('');
      lines.push(`**Expected / from my notes:** ${q.answer || '(open — judge from the paper)'}`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

function exportSheet (s) {
  if (!s) return;
  import('../ui.js').then(({ openSheet }) => {
    const { root } = openSheet({ title: 'Export quiz' });
    root.innerHTML = `
      <p class="muted small">${fmtDate(s.createdAt)} · ${s.questions.length} questions${s.score ? ` · MC ${s.score.correct}/${s.score.total}` : ''}</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn--primary" data-md>Markdown</button>
        <button class="btn btn--ghost" data-json>JSON</button>
        <button class="btn btn--ghost" data-copy>Copy for chat</button>
      </div>
      <button class="btn btn--danger btn--small" data-del style="margin-top:14px">Delete this session</button>`;
    root.querySelector('[data-md]').addEventListener('click', () => download(fileName(s, 'md'), toMarkdown(s), 'text/markdown'));
    root.querySelector('[data-json]').addEventListener('click', () => download(fileName(s, 'json'), toJson(s), 'application/json'));
    root.querySelector('[data-copy]').addEventListener('click', async () => { const ok = await copyText(toMarkdown(s)); toast(ok ? 'Copied.' : 'Copy failed.', ok ? 'ok' : 'error'); });
    root.querySelector('[data-del]').addEventListener('click', async () => { await deleteSession(s.id); toast('Session deleted.'); go(`/area/${s.area}/study`); });
  });
}
