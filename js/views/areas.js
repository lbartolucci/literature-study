/* areas.js — the home screen: a grid of thematic areas. */
import { state, areaCounts } from '../store.js';
import { esc } from '../utils/text.js';

export default function areasView () {
  const areas = state.areas;
  const totalPapers = state.papers.length;

  const cards = areas.map(a => {
    const c = areaCounts(a.id);
    return `
      <a class="area-card" href="#/area/${esc(a.id)}"
         style="--area-color:${esc(a.color)};--area-tint:${esc(a.color)}">
        <div class="area-card__emoji" style="--area-tint:${esc(a.color)}">${a.emoji || '📚'}</div>
        <div class="area-card__name">${esc(a.name)}</div>
        <div class="area-card__meta">${c.papers} paper${c.papers === 1 ? '' : 's'} · ${c.sessions} quiz${c.sessions === 1 ? '' : 'zes'}</div>
      </a>`;
  }).join('');

  const html = `
    <p class="muted small" style="margin:2px 0 14px">
      Your private literature database. Pick a thematic area — each has its own
      <b>Database</b>, <b>Study</b> and <b>Explore</b>.
    </p>
    <div class="area-grid">${cards}</div>
    <div class="stat-row" style="margin-top:20px">
      <div class="stat"><b>${totalPapers}</b><span>papers</span></div>
      <div class="stat"><b>${state.authors.length}</b><span>authors</span></div>
      <div class="stat"><b>${state.groups.length}</b><span>groups</span></div>
      <div class="stat"><b>${state.sessions.length}</b><span>quizzes</span></div>
    </div>`;

  return { title: 'Thematic Areas', titleText: 'Areas', html };
}
