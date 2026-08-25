/* paper.js — a single paper: metadata, notes, takeaways, links, PDF. */
import { area as findArea, paper as findPaper, papersInArea, author as findAuthor, group as findGroup,
         linksOf, addLink, removeLink, deletePaper, state } from '../store.js';
import { go } from '../router.js';
import { qs, qsa, toast, openSheet, confirmDialog } from '../ui.js';
import { esc, fmtDate } from '../utils/text.js';
import { LINK_KINDS } from '../models.js';
import { getPdf } from '../db.js';

export default function paperView ({ area, id }) {
  const a = findArea(area);
  const p = findPaper(id);
  if (!a || !p) { go(`/area/${area}/database`, { replace: true }); return { title: '…', html: '' }; }

  function render () {
    const authorsHtml = (p.authorRefs || []).length
      ? (p.authorRefs.map(rid => { const au = findAuthor(rid); return au ? `<a class="chip chip--tap" href="#/author/${esc(au.id)}">${esc(au.name)}</a>` : ''; }).join(''))
      : (p.authors || []).map(n => `<span class="chip">${esc(n)}</span>`).join('');

    const groupsHtml = (p.groupRefs || []).map(gid => { const g = findGroup(gid); return g ? `<a class="chip chip--teal chip--tap" href="#/group/${esc(g.id)}">${esc(g.name)}</a>` : ''; }).join('');

    const keywords = (p.keywords || []).map(k => `<span class="chip">${esc(k)}</span>`).join('')
      || (p.concepts || []).map(c => `<span class="chip">${esc(c.name)}</span>`).join('');

    const takeaways = (p.takeaways || []).length
      ? `<div>${p.takeaways.map(t => `<div class="takeaway-item">${esc(t)}</div>`).join('')}</div>`
      : '<p class="muted small">No takeaways yet.</p>';

    const links = linksOf(p.id);
    const linksHtml = links.length ? links.map(l => {
      const otherId = l.aId === p.id ? l.bId : l.aId;
      const other = findPaper(otherId);
      const kind = (LINK_KINDS.find(k => k.id === l.kind) || {}).label || l.kind;
      if (!other) return '';
      return `<div class="link-row">
        <span class="kind">${esc(kind)}</span>
        <a href="#/area/${esc(other.area)}/paper/${esc(other.id)}" style="flex:1">${esc(other.title)}</a>
        <button class="btn-icon" data-unlink="${esc(l.id)}" aria-label="Remove link">✕</button>
      </div>`;
    }).join('') : '<p class="muted small">No links yet. Connect this paper to another by theme, group, author or citation.</p>';

    const pdfBtn = p.pdfKey
      ? '<button class="btn btn--ghost" data-open-pdf>Open stored PDF</button>'
      : (p.oaUrl ? `<a class="btn btn--ghost" href="${esc(p.oaUrl)}" target="_blank" rel="noopener">Open OA link ↗</a>` : '');
    const oaLink = p.openalexId ? `<a class="btn btn--ghost" href="https://openalex.org/${esc(p.openalexId)}" target="_blank" rel="noopener">OpenAlex ↗</a>` : '';
    const doiLink = p.doi ? `<a class="btn btn--ghost" href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">DOI ↗</a>` : '';

    return `
      <div class="detail-title">${esc(p.title)}</div>
      <div class="detail-meta">${p.year ? p.year + ' · ' : ''}${p.venue ? esc(p.venue) : ''}${p.type ? ' · ' + esc(p.type) : ''}</div>
      <div class="chips" style="margin:10px 0">${authorsHtml}${groupsHtml}</div>

      <div class="btn-row" style="margin:12px 0">
        ${pdfBtn} ${doiLink} ${oaLink}
      </div>

      ${p.abstract ? `<div class="detail-section"><h3>Abstract</h3><p class="abstract">${esc(p.abstract)}</p></div>` : ''}

      <div class="detail-section"><h3>Your notes</h3>
        ${p.notes ? `<p class="prose">${esc(p.notes)}</p>` : '<p class="muted small">No notes yet.</p>'}</div>

      <div class="detail-section"><h3>Key takeaways</h3>${takeaways}</div>

      ${keywords ? `<div class="detail-section"><h3>Keywords</h3><div class="chips">${keywords}</div></div>` : ''}

      <div class="detail-section">
        <h3>Linked papers</h3>${linksHtml}
        <button class="btn btn--small btn--ghost" data-add-link style="margin-top:10px">+ Add link</button>
      </div>

      <hr class="divider">
      <div class="btn-row" style="margin-bottom:30px">
        <button class="btn" data-edit>Edit</button>
        <button class="btn btn--danger" data-delete>Delete</button>
      </div>`;
  }

  const html = `<div id="paper-host">${render()}</div>`;

  return {
    title: 'Paper', subtitle: a.name, back: true, backTo: `/area/${area}/database`, titleText: p.title,
    html,
    mount (root) {
      root.addEventListener('click', async e => {
        if (e.target.closest('[data-edit]')) return go(`/area/${area}/paper/${id}/edit`);
        if (e.target.closest('[data-open-pdf]')) return openStoredPdf(p);
        if (e.target.closest('[data-add-link]')) return addLinkSheet(area, p, () => { qs('#paper-host', root).innerHTML = render(); });
        const un = e.target.closest('[data-unlink]');
        if (un) { await removeLink(un.dataset.unlink); qs('#paper-host', root).innerHTML = render(); toast('Link removed.'); return; }
        if (e.target.closest('[data-delete]')) {
          const ok = await confirmDialog({ title: 'Delete this paper?', message: 'The paper, its notes/takeaways, its links and any stored PDF will be removed. Authors and groups stay.', okLabel: 'Delete', danger: true });
          if (ok) { await deletePaper(id); toast('Paper deleted.'); go(`/area/${area}/database`); }
        }
      });
    }
  };
}

async function openStoredPdf (p) {
  try {
    const rec = await getPdf(p.pdfKey);
    if (!rec || !rec.blob) { toast('Stored PDF not found.', 'error'); return; }
    const url = URL.createObjectURL(rec.blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (_) { toast('Could not open the PDF.', 'error'); }
}

function addLinkSheet (area, p, onDone) {
  const candidates = papersInArea(area).filter(x => x.id !== p.id);
  if (!candidates.length) { toast('Add another paper to this area first.', 'info'); return; }
  const { root, close } = openSheet({ title: 'Add a link' });
  root.innerHTML = `
    <div class="field">
      <label>Link type</label>
      <select id="link-kind">${LINK_KINDS.map(k => `<option value="${k.id}">${k.label}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>To paper</label>
      <select id="link-target">${candidates.map(c => `<option value="${esc(c.id)}">${esc(c.title.slice(0, 70))}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>Note (optional)</label>
      <input type="text" id="link-note" placeholder="Why they connect">
    </div>
    <button class="btn btn--primary btn--block" id="link-save">Add link</button>`;
  root.querySelector('#link-save').addEventListener('click', async () => {
    const kind = root.querySelector('#link-kind').value;
    const target = root.querySelector('#link-target').value;
    const note = root.querySelector('#link-note').value.trim();
    await addLink(area, p.id, target, kind, note);
    close(); toast('Link added.', 'ok'); onDone();
  });
}
