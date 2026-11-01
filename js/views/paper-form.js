/* paper-form.js — add or edit a paper. */
import { area as findArea, paper as findPaper, savePaper, ensureAuthor, ensureGroup, state, ValidationError } from '../store.js';
import { newPaper } from '../models.js';
import { go } from '../router.js';
import { qs, qsa, toast, el, confirmDialog } from '../ui.js';
import { esc } from '../utils/text.js';
import { voicebarHTML, attachDictation } from '../dictation.js';
import * as oa from '../openalex.js';
import { putPdf } from '../db.js';

export default function paperForm ({ area, id, edit }) {
  const a = findArea(area);
  if (!a) { go('/areas', { replace: true }); return { title: '…', html: '' }; }

  const editing = !!(edit && id);
  const working = editing ? JSON.parse(JSON.stringify(findPaper(id))) : newPaper(area);
  working.area = area;
  let pendingPdfBlob = null;          // set when a new PDF is chosen/fetched
  let pendingAuthorMeta = working._authorMeta || null;   // from OpenAlex

  const kw = () => (working.keywords || []).join(', ');
  let dictCleanup = null;

  const html = `
    ${editing ? '' : `
    <div class="card">
      <div class="field" style="margin-bottom:8px">
        <label>Look up on OpenAlex</label>
        <div class="hint">Paste a DOI or type a title. Verified metadata + any open-access PDF link are fetched automatically.</div>
      </div>
      <div class="section-toolbar" style="margin-bottom:8px">
        <div class="search-box">
          <input type="search" id="lookup" placeholder="10.1016/j…  or  paper title" autocomplete="off">
        </div>
        <button class="btn btn--primary" id="btn-lookup">Fetch</button>
      </div>
      <div id="lookup-results"></div>
    </div>`}

    <div class="card">
      <div class="field">
        <label for="f-title">Title *</label>
        <textarea id="f-title" style="min-height:56px">${esc(working.title)}</textarea>
        ${voicebarHTML({ field: 'f-title' })}
      </div>
      <div class="grid cols-2">
        <div class="field">
          <label for="f-year">Year</label>
          <input type="number" id="f-year" value="${working.year || ''}" placeholder="2024">
        </div>
        <div class="field">
          <label for="f-doi">DOI</label>
          <input type="text" id="f-doi" value="${esc(working.doi)}" placeholder="10.xxxx/…">
        </div>
      </div>
      <div class="field">
        <label for="f-authors">Authors <span class="hint">(comma-separated; saved to the Authors registry)</span></label>
        <input type="text" id="f-authors" value="${esc((working.authors || []).join(', '))}" placeholder="Simona Onori, …">
      </div>
      <div class="field">
        <label for="f-venue">Venue</label>
        <input type="text" id="f-venue" value="${esc(working.venue)}" placeholder="Journal / conference">
      </div>
      <div class="field">
        <label for="f-keywords">Keywords <span class="hint">(comma-separated)</span></label>
        <input type="text" id="f-keywords" value="${esc(kw())}" placeholder="state of health, Kalman filter…">
      </div>
      <div class="field">
        <label for="f-group">Research group <span class="hint">(links this paper to a group)</span></label>
        <input type="text" id="f-group" list="group-list" value="${esc(groupName(working))}" placeholder="e.g. Onori Lab">
        <datalist id="group-list">${state.groups.map(g => `<option value="${esc(g.name)}">`).join('')}</datalist>
      </div>
    </div>

    <div class="card">
      <div class="field">
        <label for="f-abstract">Abstract</label>
        <textarea id="f-abstract" placeholder="Abstract (auto-filled from OpenAlex when available)">${esc(working.abstract)}</textarea>
      </div>
    </div>

    <div class="card">
      <div class="field">
        <label for="f-summary">Summary</label>
        <textarea id="f-summary" placeholder="What the authors did (filled automatically by literature-synthesis imports)">${esc(working.summary || '')}</textarea>
      </div>
      <div class="field">
        <label for="f-theme">Theme</label>
        <input type="text" id="f-theme" value="${esc(working.theme || '')}" placeholder="Sub-topic inside this area">
      </div>
      <div class="field">
        <label for="f-projlinks">Connection to our projects</label>
        <textarea id="f-projlinks" placeholder="One per line, e.g.  NEREUS: why it matters for the project">${esc((working.projectLinks || []).map(l => (l.project ? l.project.toUpperCase() + ': ' : '') + l.text).join('\n'))}</textarea>
      </div>
    </div>

    <div class="card">
      <div class="field">
        <label for="f-notes">Your notes</label>
        <textarea id="f-notes" placeholder="What matters here, how it connects to your work…">${esc(working.notes)}</textarea>
        ${voicebarHTML({ field: 'f-notes' })}
      </div>
      <div class="field">
        <label>Key takeaways</label>
        <div id="takeaways"></div>
        <div class="section-toolbar" style="margin:8px 0 0">
          <div class="search-box"><input type="text" id="f-takeaway" placeholder="Add a takeaway and press +"></div>
          <button class="btn" id="btn-add-takeaway" type="button">+</button>
        </div>
        ${voicebarHTML({ field: 'f-takeaway', label: 'Dictate takeaway' })}
      </div>
    </div>

    <div class="card">
      <div class="field" style="margin-bottom:8px">
        <label>PDF</label>
        <div class="hint" id="pdf-status">${pdfStatus(working)}</div>
      </div>
      <div class="btn-row">
        <label class="btn btn--ghost"><input type="file" id="f-pdf" accept="application/pdf" hidden>Upload PDF…</label>
        <button class="btn btn--ghost" id="btn-fetch-pdf" type="button" ${working.oaUrl ? '' : 'disabled'}>Fetch OA PDF</button>
        ${working.oaUrl ? `<a class="btn btn--ghost" href="${esc(working.oaUrl)}" target="_blank" rel="noopener">Open OA link ↗</a>` : ''}
      </div>
    </div>

    <div class="btn-row" style="margin-bottom:30px">
      <button class="btn btn--primary btn--block" id="btn-save">${editing ? 'Save changes' : 'Add paper'}</button>
    </div>`;

  return {
    title: editing ? 'Edit paper' : 'New paper', subtitle: a.name, back: true,
    backTo: editing ? `/area/${area}/paper/${id}` : `/area/${area}/database`,
    titleText: editing ? 'Edit paper' : 'New paper',
    html,
    mount (root) {
      dictCleanup = attachDictation(root, { punctuation: state.settings.dictationPunctuation });

      // takeaways UI
      const takeaways = (working.takeaways || []).slice();
      const takeHost = qs('#takeaways', root);
      function renderTakeaways () {
        takeHost.innerHTML = takeaways.length
          ? `<div class="chips">${takeaways.map((t, i) => `<span class="chip chip--tap">${esc(t)} <button data-rm="${i}" aria-label="remove">✕</button></span>`).join('')}</div>`
          : '<p class="muted small" style="margin:4px 0 0">No takeaways yet.</p>';
      }
      renderTakeaways();
      function addTakeaway () {
        const input = qs('#f-takeaway', root);
        const v = input.value.trim();
        if (!v) return;
        takeaways.push(v); input.value = ''; renderTakeaways();
      }
      qs('#btn-add-takeaway', root).addEventListener('click', addTakeaway);
      qs('#f-takeaway', root).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTakeaway(); } });
      takeHost.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { takeaways.splice(+b.dataset.rm, 1); renderTakeaways(); } });

      // PDF upload
      qs('#f-pdf', root).addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        pendingPdfBlob = file;
        working.pdfName = file.name;
        qs('#pdf-status', root).textContent = `Ready to save: ${file.name} (${Math.round(file.size / 1024)} KB)`;
      });

      // Fetch OA PDF (CORS permitting)
      const fetchBtn = qs('#btn-fetch-pdf', root);
      if (fetchBtn) fetchBtn.addEventListener('click', async () => {
        fetchBtn.disabled = true; fetchBtn.innerHTML = '<span class="spinner-inline"></span> Fetching…';
        const blob = await oa.tryFetchPdf(working.oaUrl);
        fetchBtn.disabled = false; fetchBtn.textContent = 'Fetch OA PDF';
        if (blob) { pendingPdfBlob = blob; working.pdfName = 'openalex.pdf'; qs('#pdf-status', root).textContent = `Fetched OA PDF (${Math.round(blob.size / 1024)} KB) — will be saved.`; toast('Open-access PDF fetched.', 'ok'); }
        else toast('Could not fetch the PDF (the host blocked it). The OA link is kept instead.', 'info', 5000);
      });

      // OpenAlex lookup
      const lookupBtn = qs('#btn-lookup', root);
      if (lookupBtn) {
        const input = qs('#lookup', root);
        const results = qs('#lookup-results', root);
        async function runLookup () {
          const q = input.value.trim();
          if (!q) return;
          results.innerHTML = '<p class="muted small"><span class="spinner-inline"></span> Searching OpenAlex…</p>';
          try {
            let items = [];
            if (/10\.\d{4,}/.test(q)) { const one = await oa.getByDoi(q); if (one) items = [one]; }
            if (!items.length) items = await oa.searchWorks(q, { perPage: 8 });
            if (!items.length) { results.innerHTML = '<p class="muted small">No results. Fill the fields manually below.</p>'; return; }
            results.innerHTML = `<div class="list" style="margin-top:6px">${items.map((it, i) => `
              <button class="paper-item" data-pick="${i}" type="button" style="text-align:left">
                <div class="paper-item__title">${esc(it.title)}</div>
                <div class="paper-item__meta">${esc((it.authors[0] || 'Unknown'))}${it.year ? ' · ' + it.year : ''}${it.venue ? ' · ' + esc(it.venue) : ''} ${it.isOa ? '· <span class="oa-badge">OA</span>' : ''}</div>
              </button>`).join('')}</div>`;
            results.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => fill(items[+btn.dataset.pick], root)));
          } catch (e) { results.innerHTML = `<p class="muted small">${esc(e.message || 'Lookup failed.')}</p>`; }
        }
        lookupBtn.addEventListener('click', runLookup);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runLookup(); } });
      }

      function fill (m, root) {
        working.openalexId = m.openalexId || '';
        working.oaUrl = m.oaUrl || '';
        working.referencedWorks = m.referencedWorks || [];
        working.relatedWorks = m.relatedWorks || [];
        working.type = m.type || '';
        working.concepts = m.concepts || [];
        pendingAuthorMeta = m.authorMeta || null;
        qs('#f-title', root).value = m.title || '';
        qs('#f-year', root).value = m.year || '';
        qs('#f-doi', root).value = m.doi || '';
        qs('#f-authors', root).value = (m.authors || []).join(', ');
        qs('#f-venue', root).value = m.venue || '';
        qs('#f-keywords', root).value = (m.keywords || []).join(', ');
        qs('#f-abstract', root).value = m.abstract || '';
        const st = qs('#pdf-status', root); if (st) st.textContent = pdfStatus({ ...working });
        const fb = qs('#btn-fetch-pdf', root); if (fb) fb.disabled = !working.oaUrl;
        toast(`Loaded “${(m.title || '').slice(0, 40)}…” from OpenAlex.`, 'ok');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // Save
      qs('#btn-save', root).addEventListener('click', async () => {
        working.title = qs('#f-title', root).value.trim();
        working.year = qs('#f-year', root).value;
        working.doi = qs('#f-doi', root).value.trim();
        working.authors = qs('#f-authors', root).value.split(',').map(s => s.trim()).filter(Boolean);
        working.venue = qs('#f-venue', root).value.trim();
        working.keywords = qs('#f-keywords', root).value.split(',').map(s => s.trim()).filter(Boolean);
        working.abstract = qs('#f-abstract', root).value.trim();
        working.notes = qs('#f-notes', root).value.trim();
        working.summary = qs('#f-summary', root).value.trim();
        working.theme = qs('#f-theme', root).value.trim();
        working.projectLinks = qs('#f-projlinks', root).value.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
          const m = line.match(/^([A-Za-z0-9_\- ]{2,30}):\s*(.+)$/);
          return m ? { project: m[1].trim().toLowerCase(), text: m[2].trim() } : { project: '', text: line };
        });
        working.takeaways = takeaways.slice();
        const groupName = qs('#f-group', root).value.trim();

        if (!working.title) { toast('A title is required.', 'error'); return; }

        try {
          // authors → registry
          const refs = [];
          for (const name of working.authors) {
            const meta = (pendingAuthorMeta || []).find(x => x.name === name) || {};
            const rec = await ensureAuthor({ name, openalexId: meta.openalexId, orcid: meta.orcid, affiliation: meta.affiliation });
            refs.push(rec.id);
          }
          working.authorRefs = refs;

          // group → registry
          if (groupName) { const g = await ensureGroup({ name: groupName }); working.groupRefs = [g.id]; }
          else working.groupRefs = [];

          // PDF blob
          if (pendingPdfBlob) {
            const key = working.pdfKey || ('pdf_' + working.id);
            await putPdf(key, pendingPdfBlob, { name: working.pdfName, type: pendingPdfBlob.type });
            working.pdfKey = key;
          }
          delete working._authorMeta;
          await savePaper(working);
          toast('Paper saved.', 'ok');
          go(`/area/${area}/paper/${working.id}`);
        } catch (e) {
          console.error(e);
          toast(e instanceof ValidationError ? e.errors.join(' ') : (e.message || 'Could not save.'), 'error', 5000);
        }
      });

      return;
    },
    cleanup () { if (dictCleanup) try { dictCleanup(); } catch (_) {} }
  };
}

function groupName (p) {
  const gid = (p.groupRefs || [])[0];
  const g = gid && state.groups.find(x => x.id === gid);
  return g ? g.name : '';
}
function pdfStatus (p) {
  if (p.pdfKey) return 'A PDF is stored for this paper.';
  if (p.oaUrl) return 'Open-access link available — fetch the PDF or open it in a tab.';
  return 'No PDF yet. Upload one, or add via OpenAlex to get an OA link.';
}
