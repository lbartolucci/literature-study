/* area-hub.js — inside an area: the three sections. */
import { area as findArea, papersInArea, state, areaCounts } from '../store.js';
import { go } from '../router.js';
import { esc } from '../utils/text.js';

export default function hubView ({ area }) {
  const a = findArea(area);
  if (!a) { go('/areas', { replace: true }); return { title: '…', html: '' }; }
  const c = areaCounts(area);
  const recent = papersInArea(area).sort((x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || '')).slice(0, 3);

  const section = (href, icon, name, desc, badge) => `
    <a class="card section-card" href="${href}">
      <div class="section-card__ico">${icon}</div>
      <div>
        <h3>${name} ${badge != null ? `<span class="pill-count">${badge}</span>` : ''}</h3>
        <p>${desc}</p>
      </div>
      <span class="chev">›</span>
    </a>`;

  const ICONS = {
    db: '<svg class="ico" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>',
    study: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 4 3 8l9 4 9-4-9-4Z"/><path d="M7 10.5V15c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.5M21 8v5"/></svg>',
    explore: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1Z"/></svg>'
  };

  const recentHtml = recent.length ? `
    <div class="detail-section">
      <h3>Recently updated</h3>
      <div class="list">
        ${recent.map(p => `
          <a class="paper-item" href="#/area/${esc(area)}/paper/${esc(p.id)}">
            <div class="paper-item__title">${esc(p.title)}</div>
            <div class="paper-item__meta">${esc((p.authors[0] || 'Unknown'))}${p.year ? ' · ' + p.year : ''}</div>
          </a>`).join('')}
      </div>
    </div>` : '';

  const html = `
    ${section(`#/area/${esc(area)}/database`, ICONS.db, 'Database', 'Add papers, notes, takeaways and links.', c.papers)}
    ${section(`#/area/${esc(area)}/study`, ICONS.study, 'Study', 'Quizzes from your papers and notes. Export to verify in chat.', c.sessions || null)}
    ${section(`#/area/${esc(area)}/explore`, ICONS.explore, 'Explore', 'Find new papers via OpenAlex, based on what you saved.', null)}
    ${recentHtml}`;

  return {
    title: a.name, subtitle: `${c.papers} paper${c.papers === 1 ? '' : 's'}`,
    titleText: a.name, back: true, backTo: '/areas', html
  };
}
