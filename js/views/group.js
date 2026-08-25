/* group.js — one research group: details, notes, member authors, papers. */
import { group as findGroup, papersByGroup, area as findArea, author as findAuthor, saveGroup, deleteGroup, state } from '../store.js';
import { go } from '../router.js';
import { qs, toast, confirmDialog } from '../ui.js';
import { esc } from '../utils/text.js';
import { voicebarHTML, attachDictation } from '../dictation.js';

export default function groupView ({ id }) {
  const g = findGroup(id);
  if (!g) { go('/groups', { replace: true }); return { title: '…', html: '' }; }
  let dictCleanup = null;

  const papers = papersByGroup(id);
  const memberIds = new Set();
  papers.forEach(p => (p.authorRefs || []).forEach(rid => memberIds.add(rid)));
  const members = [...memberIds].map(findAuthor).filter(Boolean);

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
    <div class="detail-title">${esc(g.name)}</div>
    <div class="detail-meta">${[g.institution, g.lead].filter(Boolean).map(esc).join(' · ') || '<span class="muted">No details on file</span>'}</div>

    ${members.length ? `<div class="detail-section"><h3>Authors seen in your library</h3><div class="chips">
      ${members.map(m => `<a class="chip chip--tap" href="#/author/${esc(m.id)}">${esc(m.name)}</a>`).join('')}</div></div>` : ''}

    <div class="card">
      <div class="field"><label for="g-notes">Notes on this group</label>
        <textarea id="g-notes" placeholder="Their focus, key results, how they relate to your work…">${esc(g.notes)}</textarea>
        ${voicebarHTML({ field: 'g-notes' })}
      </div>
      <div class="grid cols-2">
        <div class="field"><label for="g-inst">Institution</label><input type="text" id="g-inst" value="${esc(g.institution)}"></div>
        <div class="field"><label for="g-lead">Lead / PI</label><input type="text" id="g-lead" value="${esc(g.lead)}"></div>
      </div>
      <button class="btn btn--primary btn--small" id="g-save">Save</button>
    </div>

    ${papersHtml}

    <hr class="divider">
    <button class="btn btn--danger btn--small" id="g-del" style="margin-bottom:30px">Delete group</button>`;

  return {
    title: 'Research group', back: true, backTo: '/groups', titleText: g.name, html,
    mount (root) {
      dictCleanup = attachDictation(root, { punctuation: state.settings.dictationPunctuation });
      qs('#g-save', root).addEventListener('click', async () => {
        g.notes = qs('#g-notes', root).value.trim();
        g.institution = qs('#g-inst', root).value.trim();
        g.lead = qs('#g-lead', root).value.trim();
        await saveGroup(g); toast('Saved.', 'ok');
      });
      qs('#g-del', root).addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Delete this group?', message: 'The group is removed and detached from papers. The papers stay.', okLabel: 'Delete', danger: true });
        if (ok) { await deleteGroup(id); toast('Group deleted.'); go('/groups'); }
      });
    },
    cleanup () { if (dictCleanup) try { dictCleanup(); } catch (_) {} }
  };
}
