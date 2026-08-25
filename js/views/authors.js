/* authors.js — the author registry. */
import { state, papersByAuthor } from '../store.js';
import { qs } from '../ui.js';
import { esc, normalize } from '../utils/text.js';

export default function authorsView () {
  function render (filter = '') {
    const f = normalize(filter);
    let authors = state.authors.slice();
    if (f) authors = authors.filter(a => normalize(a.name).includes(f) || normalize(a.affiliation).includes(f));
    authors.sort((a, b) => papersByAuthor(b.id).length - papersByAuthor(a.id).length || a.name.localeCompare(b.name));
    if (!authors.length) {
      return `<div class="empty"><div class="empty__ico">👤</div><h3>${filter ? 'No matching authors' : 'No authors yet'}</h3>
        <p>${filter ? 'Try another name.' : 'Authors are added automatically when you save papers (via OpenAlex or manually).'}</p></div>`;
    }
    return `<div class="list">${authors.map(a => {
      const n = papersByAuthor(a.id).length;
      return `<a class="paper-item" href="#/author/${esc(a.id)}">
        <div class="paper-item__title">${esc(a.name)}</div>
        <div class="paper-item__meta">${a.affiliation ? esc(a.affiliation) + ' · ' : ''}${n} paper${n === 1 ? '' : 's'}</div>
      </a>`;
    }).join('')}</div>`;
  }

  const html = `
    <div class="section-toolbar">
      <div class="search-box">
        <svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
        <input type="search" id="q" placeholder="Search authors…" autocomplete="off">
      </div>
    </div>
    <div id="host">${render('')}</div>`;

  return {
    title: 'Authors', titleText: 'Authors', html,
    mount (root) {
      const host = qs('#host', root), input = qs('#q', root);
      input.addEventListener('input', () => { host.innerHTML = render(input.value); });
    }
  };
}
