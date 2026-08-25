/* explore.js — find new papers via OpenAlex, from what's already saved. */
import { area as findArea, papersInArea, state, savePaper, ensureAuthor, dismiss, isDismissed } from '../store.js';
import { newPaper } from '../models.js';
import { go } from '../router.js';
import { qs, qsa, toast } from '../ui.js';
import { esc, normalize, significantWords } from '../utils/text.js';
import * as oa from '../openalex.js';

export default function exploreView ({ area }) {
  const a = findArea(area);
  if (!a) { go('/areas', { replace: true }); return { title: '…', html: '' }; }
  const papers = papersInArea(area);

  const html = `
    <div class="section-toolbar">
      <div class="search-box">
        <svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
        <input type="search" id="ex-q" placeholder="Search OpenAlex (topic, author, keyword)…" autocomplete="off">
      </div>
      <button class="btn btn--primary" id="ex-search">Search</button>
    </div>
    <div class="btn-row" style="margin-bottom:14px">
      <button class="btn btn--small" id="ex-suggest">✨ Suggest from my papers</button>
    </div>
    <div id="ex-results">
      ${papers.length
        ? '<p class="muted small">Tap <b>Suggest from my papers</b> for recommendations based on your saved concepts, related works and authors — or search OpenAlex directly above.</p>'
        : '<div class="empty"><div class="empty__ico">🧭</div><h3>Nothing saved here yet</h3><p>Add a few papers in the Database first, then Explore can recommend related work. You can still search OpenAlex directly.</p></div>'}
    </div>`;

  return {
    title: a.name, subtitle: 'Explore', back: true, backTo: `/area/${area}`, titleText: a.name + ' · Explore',
    html,
    mount (root) {
      const out = qs('#ex-results', root);

      qs('#ex-search', root).addEventListener('click', doSearch);
      qs('#ex-q', root).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
      qs('#ex-suggest', root).addEventListener('click', doSuggest);

      async function doSearch () {
        const q = qs('#ex-q', root).value.trim();
        if (!q) return;
        out.innerHTML = loading('Searching OpenAlex…');
        try {
          const items = await oa.searchWorks(q, { perPage: 20 });
          renderList(filterKnown(items).map(it => ({ work: it, reason: `Matches your search “${esc(q)}”.` })));
        } catch (e) { out.innerHTML = errorBox(e); }
      }

      async function doSuggest () {
        if (!papers.length) { toast('Add some papers first.', 'info'); return; }
        out.innerHTML = loading('Reading your papers and asking OpenAlex…');
        try {
          const suggestions = await buildSuggestions(papers);
          if (!suggestions.length) { out.innerHTML = '<p class="muted small">No new suggestions right now. Try a direct search, or add more papers with abstracts/keywords.</p>'; return; }
          renderList(suggestions);
        } catch (e) { out.innerHTML = errorBox(e); }
      }

      function filterKnown (items) {
        const knownOa = new Set(papers.map(p => p.openalexId).filter(Boolean));
        const knownDoi = new Set(papers.map(p => p.doi).filter(Boolean));
        return items.filter(it => it && it.openalexId && !knownOa.has(it.openalexId) && !(it.doi && knownDoi.has(it.doi)) && !isDismissed(it.openalexId));
      }

      function renderList (suggestions) {
        if (!suggestions.length) { out.innerHTML = '<p class="muted small">Nothing new to suggest.</p>'; return; }
        out.innerHTML = `<div class="list">${suggestions.map((s, i) => card(s, i)).join('')}</div>`;
        suggestions.forEach((s, i) => {
          const node = qs(`#sg-${i}`, out);
          if (!node) return;
          qs('[data-add]', node).addEventListener('click', async () => {
            qs('[data-add]', node).disabled = true;
            await addFromWork(area, s.work);
            toast('Added to your Database.', 'ok');
            node.style.opacity = '.5';
            qs('[data-add]', node).textContent = 'Added ✓';
          });
          qs('[data-dismiss]', node).addEventListener('click', async () => { await dismiss(s.work.openalexId); node.remove(); });
        });
      }

      function card (s, i) {
        const w = s.work;
        const oaBadge = w.isOa ? ' · <span class="oa-badge">OA</span>' : '';
        const links = [
          w.doi ? `<a class="chip chip--tap" href="https://doi.org/${esc(w.doi)}" target="_blank" rel="noopener">DOI ↗</a>` : '',
          w.openalexId ? `<a class="chip chip--tap" href="https://openalex.org/${esc(w.openalexId)}" target="_blank" rel="noopener">OpenAlex ↗</a>` : '',
          w.oaUrl ? `<a class="chip chip--tap" href="${esc(w.oaUrl)}" target="_blank" rel="noopener">PDF ↗</a>` : ''
        ].join('');
        return `
          <div class="card suggestion" id="sg-${i}">
            <div class="paper-item__title">${esc(w.title)}</div>
            <div class="paper-item__meta">${esc(w.authors.slice(0, 3).join(', ') || 'Unknown')}${w.year ? ' · ' + w.year : ''}${w.venue ? ' · ' + esc(w.venue) : ''} · ${w.citedByCount} citations${oaBadge}</div>
            <div class="reason"><b>Why:</b> ${s.reason}</div>
            <div class="chips" style="margin-top:8px">${links}</div>
            <div class="btn-row" style="margin-top:10px">
              <button class="btn btn--small btn--primary" data-add>+ Add to Database</button>
              <button class="btn btn--small btn--ghost" data-dismiss>Dismiss</button>
            </div>
          </div>`;
      }
    }
  };
}

/* ---------------------------------------------------- suggestion engine -- */

async function buildSuggestions (papers) {
  // 1. rank the corpus concepts
  const conceptScore = new Map(); const conceptName = new Map();
  papers.forEach(p => (p.concepts || []).forEach(c => {
    conceptScore.set(c.id, (conceptScore.get(c.id) || 0) + (c.score || 0.5));
    conceptName.set(c.id, c.name);
  }));
  const topConcepts = [...conceptScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);

  // 2. collect related / referenced work ids
  const relatedIds = new Set();
  papers.forEach(p => { (p.relatedWorks || []).forEach(id => relatedIds.add(id)); (p.referencedWorks || []).forEach(id => relatedIds.add(id)); });

  const known = new Set(papers.map(p => p.openalexId).filter(Boolean));
  const knownDoi = new Set(papers.map(p => p.doi).filter(Boolean));
  const results = new Map();   // openalexId → { work, reasons:Set, score }

  const add = (w, reason, weight) => {
    if (!w || !w.openalexId) return;
    if (known.has(w.openalexId) || (w.doi && knownDoi.has(w.doi)) || isDismissed(w.openalexId)) return;
    let e = results.get(w.openalexId);
    if (!e) { e = { work: w, reasons: new Set(), score: 0 }; results.set(w.openalexId, e); }
    e.reasons.add(reason); e.score += weight + Math.log10((w.citedByCount || 0) + 1);
  };

  // 3. concept-based query (most cited in these concepts, recent-leaning)
  if (topConcepts.length) {
    const byConcept = await oa.worksByConcepts(topConcepts, { perPage: 30 }).catch(() => []);
    const names = topConcepts.map(id => conceptName.get(id)).filter(Boolean).slice(0, 3);
    byConcept.forEach(w => {
      const shared = (w.concepts || []).filter(c => topConcepts.includes(c.id)).map(c => c.name);
      const label = shared.length ? shared.slice(0, 2).join(', ') : names.join(', ');
      add(w, `shares your core topics (<b>${esc(label)}</b>).`, 2);
    });
  }

  // 4. related / cited works from your library
  if (relatedIds.size) {
    const many = await oa.getManyByIds([...relatedIds].slice(0, 50)).catch(() => []);
    many.forEach(w => add(w, 'related to / cited by papers you already saved.', 2.5));
  }

  // 5. rank
  return [...results.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map(e => ({ work: e.work, reason: [...e.reasons].join(' Also ') }));
}

/* ------------------------------------------------ add a suggestion ------- */

export async function addFromWork (area, w) {
  const p = newPaper(area);
  Object.assign(p, {
    title: w.title, authors: w.authors || [], year: w.year, venue: w.venue,
    doi: w.doi, openalexId: w.openalexId, type: w.type, abstract: w.abstract,
    keywords: w.keywords || [], concepts: w.concepts || [], oaUrl: w.oaUrl || '',
    referencedWorks: w.referencedWorks || [], relatedWorks: w.relatedWorks || []
  });
  const refs = [];
  for (const meta of (w.authorMeta || [])) {
    const rec = await ensureAuthor({ name: meta.name, openalexId: meta.openalexId, orcid: meta.orcid, affiliation: meta.affiliation });
    refs.push(rec.id);
  }
  if (!refs.length) for (const name of (w.authors || [])) { const rec = await ensureAuthor({ name }); refs.push(rec.id); }
  p.authorRefs = refs;
  return savePaper(p);
}

const loading = msg => `<p class="muted small"><span class="spinner-inline"></span> ${esc(msg)}</p>`;
const errorBox = e => `<div class="empty"><div class="empty__ico">📡</div><h3>OpenAlex unavailable</h3><p>${esc(e.message || 'Request failed.')}</p></div>`;
