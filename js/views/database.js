/* database.js — the paper list for one area. */
import { area as findArea, papersInArea, state, linksOf } from '../store.js';
import { go } from '../router.js';
import { qs, qsa } from '../ui.js';
import { esc, normalize, authorsShort, fmtDate } from '../utils/text.js';

export default function databaseView ({ area }) {
  const a = findArea(area);
  if (!a) { go('/areas', { replace: true }); return { title: '…', html: '' }; }

  function render (filter = '') {
    const f = normalize(filter);
    let papers = papersInArea(area);
    if (f) papers = papers.filter(p =>
      normalize(p.title).includes(f) ||
      (p.authors || []).some(au => normalize(au).includes(f)) ||
      (p.keywords || []).some(k => normalize(k).includes(f)) ||
      normalize(p.notes).includes(f));
    papers.sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''));

    if (!papers.length) {
      return `<div class="empty"><div class="empty__ico">📄</div>
        <h3>${filter ? 'No matching papers' : 'No papers yet'}</h3>
        <p>${filter ? 'Try a different search.' : 'Add a paper by DOI or title (metadata comes from OpenAlex), or upload a PDF and fill it in yourself.'}</p>
        ${filter ? '' : `<button class="btn btn--primary" data-add>+ Add your first paper</button>`}</div>`;
    }
    return `<div class="list">${papers.map(card).join('')}</div>`;
  }

  function card (p) {
    const nLinks = linksOf(p.id).length;
    const badges = [];
    if (p.pdfKey) badges.push('<span class="chip">PDF</span>');
    else if (p.oaUrl) badges.push('<span class="chip oa-badge">OA</span>');
    if ((p.takeaways || []).length) badges.push(`<span class="chip chip--accent">${p.takeaways.length} takeaway${p.takeaways.length === 1 ? '' : 's'}</span>`);
    if (nLinks) badges.push(`<span class="chip">${nLinks} link${nLinks === 1 ? '' : 's'}</span>`);
    if (p.demo) badges.push('<span class="chip">demo</span>');
    return `
      <a class="paper-item" href="#/area/${esc(area)}/paper/${esc(p.id)}">
        <div class="paper-item__title">${esc(p.title)}</div>
        <div class="paper-item__meta">${esc(authorsShort(p.authors))}${p.year ? ' · ' + p.year : ''}${p.venue ? ' · ' + esc(p.venue) : ''}</div>
        <div class="paper-item__foot">${badges.join('')}</div>
      </a>`;
  }

  const html = `
    <div class="section-toolbar">
      <div class="search-box">
        <svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
        <input type="search" id="q" placeholder="Search title, author, keyword, notes…" autocomplete="off">
      </div>
    </div>
    <div id="list-host">${render('')}</div>
    <button class="fab" data-add aria-label="Add paper">+</button>`;

  return {
    title: a.name, subtitle: 'Database', back: true, backTo: `/area/${area}`, titleText: a.name + ' · Database',
    html,
    mount (root) {
      const host = qs('#list-host', root);
      const input = qs('#q', root);
      input.addEventListener('input', () => { host.innerHTML = render(input.value); });
      root.addEventListener('click', e => { if (e.target.closest('[data-add]')) go(`/area/${area}/database/new`); });
    }
  };
}
