/* groups.js — the research-group registry. */
import { state, papersByGroup, saveGroup, ensureGroup } from '../store.js';
import { qs, toast, openSheet } from '../ui.js';
import { esc, normalize } from '../utils/text.js';

export default function groupsView () {
  function render (filter = '') {
    const f = normalize(filter);
    let groups = state.groups.slice();
    if (f) groups = groups.filter(g => normalize(g.name).includes(f) || normalize(g.institution).includes(f));
    groups.sort((a, b) => papersByGroup(b.id).length - papersByGroup(a.id).length || a.name.localeCompare(b.name));
    if (!groups.length) {
      return `<div class="empty"><div class="empty__ico">👥</div><h3>${filter ? 'No matching groups' : 'No groups yet'}</h3>
        <p>${filter ? 'Try another name.' : 'Groups are created when you tag a paper with a research group, or add one here.'}</p>
        ${filter ? '' : '<button class="btn btn--primary" data-new>+ Add a group</button>'}</div>`;
    }
    return `<div class="list">${groups.map(g => {
      const n = papersByGroup(g.id).length;
      return `<a class="paper-item" href="#/group/${esc(g.id)}">
        <div class="paper-item__title">${esc(g.name)}</div>
        <div class="paper-item__meta">${g.institution ? esc(g.institution) + ' · ' : ''}${n} paper${n === 1 ? '' : 's'}</div>
      </a>`;
    }).join('')}</div>`;
  }

  const html = `
    <div class="section-toolbar">
      <div class="search-box">
        <svg class="ico" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
        <input type="search" id="q" placeholder="Search groups…" autocomplete="off">
      </div>
      <button class="btn btn--primary" data-new>+</button>
    </div>
    <div id="host">${render('')}</div>`;

  return {
    title: 'Research Groups', titleText: 'Groups', html,
    mount (root) {
      const host = qs('#host', root), input = qs('#q', root);
      input.addEventListener('input', () => { host.innerHTML = render(input.value); });
      root.addEventListener('click', e => { if (e.target.closest('[data-new]')) newGroupSheet(() => { host.innerHTML = render(input.value); }); });
    }
  };
}

function newGroupSheet (onDone) {
  const { root, close } = openSheet({ title: 'New research group' });
  root.innerHTML = `
    <div class="field"><label>Name *</label><input type="text" id="g-name" placeholder="e.g. Onori Lab"></div>
    <div class="field"><label>Institution</label><input type="text" id="g-inst" placeholder="e.g. Stanford University"></div>
    <div class="field"><label>Lead / PI</label><input type="text" id="g-lead" placeholder="e.g. Simona Onori"></div>
    <button class="btn btn--primary btn--block" id="g-save">Create</button>`;
  root.querySelector('#g-save').addEventListener('click', async () => {
    const name = root.querySelector('#g-name').value.trim();
    if (!name) { toast('A name is required.', 'error'); return; }
    const g = await ensureGroup({ name, institution: root.querySelector('#g-inst').value.trim(), lead: root.querySelector('#g-lead').value.trim() });
    await saveGroup(g);
    close(); toast('Group created.', 'ok'); onDone();
  });
}
