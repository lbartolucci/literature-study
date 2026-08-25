/* author.js — one author: details, notes, papers across areas. */
import { author as findAuthor, papersByAuthor, area as findArea, saveAuthor, deleteAuthor, state } from '../store.js';
import { go } from '../router.js';
import { qs, toast, confirmDialog } from '../ui.js';
import { esc } from '../utils/text.js';
import { voicebarHTML, attachDictation } from '../dictation.js';

export default function authorView ({ id }) {
  const a = findAuthor(id);
  if (!a) { go('/authors', { replace: true }); return { title: '…', html: '' }; }
  let dictCleanup = null;

  const papers = papersByAuthor(id);
  const byArea = {};
  papers.forEach(p => { (byArea[p.area] = byArea[p.area] || []).push(p); });

  const papersHtml = papers.length ? Object.entries(byArea).map(([areaId, ps]) => {
    const ar = findArea(areaId);
    return `<div class="detail-section"><h3>${esc(ar ? ar.name : areaId)}</h3><div class="list">${ps.map(p => `
      <a class="paper-item" href="#/area/${esc(p.area)}/paper/${esc(p.id)}">
        <div class="paper-item__title">${esc(p.title)}</div>
        <div class="paper-item__meta">${p.year || ''}${p.venue ? ' · ' + esc(p.venue) : ''}</div>
      </a>`).join('')}</div></div>`;
  }).join('') : '<p class="muted small">No papers linked yet.</p>';

  const html = `
    <div class="detail-title">${esc(a.name)}</div>
    <div class="detail-meta">${a.affiliation ? esc(a.affiliation) : '<span class="muted">No affiliation on file</span>'}</div>
    <div class="chips" style="margin:8px 0">
      ${a.orcid ? `<a class="chip chip--tap" href="${esc(a.orcid)}" target="_blank" rel="noopener">ORCID ↗</a>` : ''}
      ${a.openalexId ? `<a class="chip chip--tap" href="https://openalex.org/${esc(a.openalexId)}" target="_blank" rel="noopener">OpenAlex ↗</a>` : ''}
    </div>

    <div class="card">
      <div class="field" style="margin-bottom:0">
        <label for="a-notes">Notes on this author / group</label>
        <textarea id="a-notes" placeholder="Their line of work, why they matter to you…">${esc(a.notes)}</textarea>
        ${voicebarHTML({ field: 'a-notes' })}
      </div>
      <div class="field" style="margin-top:10px">
        <label for="a-aff">Affiliation</label>
        <input type="text" id="a-aff" value="${esc(a.affiliation)}">
      </div>
      <button class="btn btn--primary btn--small" id="a-save">Save</button>
    </div>

    ${papersHtml}

    <hr class="divider">
    <button class="btn btn--danger btn--small" id="a-del" style="margin-bottom:30px">Delete author</button>`;

  return {
    title: 'Author', back: true, backTo: '/authors', titleText: a.name, html,
    mount (root) {
      dictCleanup = attachDictation(root, { punctuation: state.settings.dictationPunctuation });
      qs('#a-save', root).addEventListener('click', async () => {
        a.notes = qs('#a-notes', root).value.trim();
        a.affiliation = qs('#a-aff', root).value.trim();
        await saveAuthor(a); toast('Saved.', 'ok');
      });
      qs('#a-del', root).addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Delete this author?', message: 'The author is removed and detached from papers. The papers stay.', okLabel: 'Delete', danger: true });
        if (ok) { await deleteAuthor(id); toast('Author deleted.'); go('/authors'); }
      });
    },
    cleanup () { if (dictCleanup) try { dictCleanup(); } catch (_) {} }
  };
}
