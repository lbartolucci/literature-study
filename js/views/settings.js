/* settings.js — theme, thematic areas, dictation, backup, storage, reset. */
import { state, updateSettings, saveAreas } from '../store.js';
import { go } from '../router.js';
import { qs, qsa, toast, openSheet, confirmDialog } from '../ui.js';
import { esc, slug, uid } from '../utils/text.js';
import { applyTheme } from '../main.js';
import { exportBackup, importBackup } from '../backup.js';
import { loadDemo, removeDemo, hasDemo } from '../demo.js';
import * as db from '../db.js';
import * as sync from '../sync.js';
import { dictationSupported } from '../dictation.js';

export default function settingsView () {
  const s = state.settings;
  let syncStatusUnsub = null;

  const html = `
    <div class="card">
      <h3 style="margin:0 0 10px">Appearance</h3>
      <div class="segmented" id="theme">
        ${['auto', 'light', 'dark'].map(t => `<button data-theme="${t}" class="${s.theme === t ? 'is-active' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">Thematic areas</h3>
      <p class="muted small" style="margin:0 0 10px">Rename, recolour, add or remove areas. Removing an area does not delete its papers, but they become hidden until the area exists again.</p>
      <div id="areas-list"></div>
      <button class="btn btn--small btn--ghost" id="area-add" style="margin-top:10px">+ Add area</button>
    </div>

    <div class="card">
      <h3 style="margin:0 0 10px">Voice input</h3>
      <p class="muted small" style="margin:0 0 10px">${dictationSupported() ? 'Available in this browser. Recognition runs on the browser’s servers, so it needs a connection.' : 'Not available in this browser — the system keyboard’s microphone still works.'}</p>
      <label class="chip chip--tap"><input type="checkbox" id="dict-punct" ${s.dictationPunctuation ? 'checked' : ''} style="margin-right:6px">Convert spoken punctuation by default</label>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">OpenAlex contact</h3>
      <p class="muted small" style="margin:0 0 10px">Sent with API calls to join the faster “polite pool”. Only your email; never your data.</p>
      <input type="text" id="mailto" value="${esc(s.mailto || '')}" placeholder="you@example.org">
    </div>

    <div class="card" id="sync-card">
      <h3 style="margin:0 0 6px">Cloud sync <span class="chip" id="sync-badge">off</span></h3>
      <p class="muted small" style="margin:0 0 10px">Optional. Sign in with the same account on any device to keep your library in sync. All data stays local too — sync is additive and offline-friendly. Merge is per-record, last-write-wins; nothing is bulk-overwritten. Set it up with <code class="inline">SUPABASE_SETUP.md</code>.</p>
      <div id="sync-body"></div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 10px">Backup</h3>
      <p class="muted small" style="margin:0 0 10px">All data lives only in this browser. Export a JSON backup regularly, or move it to another device.</p>
      <div class="btn-row">
        <button class="btn btn--primary btn--small" id="exp">Export backup</button>
        <label class="btn btn--ghost btn--small"><input type="file" id="imp" accept="application/json" hidden>Import backup…</label>
      </div>
      <label class="chip chip--tap" style="margin-top:10px"><input type="checkbox" id="exp-pdfs" style="margin-right:6px">Include stored PDFs (large)</label>
    </div>

    <div class="card">
      <h3 style="margin:0 0 10px">Sample data</h3>
      <div class="btn-row">
        <button class="btn btn--ghost btn--small" id="demo-load">Load demo papers</button>
        <button class="btn btn--ghost btn--small" id="demo-remove">Remove demo</button>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 6px">Storage</h3>
      <p class="muted small" id="storage">Estimating…</p>
      <button class="btn btn--danger btn--small" id="reset" style="margin-top:8px">Erase all data</button>
    </div>

    <p class="muted small" style="text-align:center;margin:14px 0 40px">LiteratureStudy · v1.0.0 · offline-first PWA</p>`;

  return {
    title: 'Settings', titleText: 'Settings', html,
    mount (root) {
      // theme
      qs('#theme', root).addEventListener('click', async e => {
        const b = e.target.closest('[data-theme]'); if (!b) return;
        qsa('#theme button', root).forEach(x => x.classList.remove('is-active'));
        b.classList.add('is-active');
        const t = b.dataset.theme;
        await updateSettings({ theme: t }); applyTheme(t);
      });

      // areas editor
      const areasHost = qs('#areas-list', root);
      function renderAreas () {
        areasHost.innerHTML = state.areas.map((a, i) => `
          <div class="link-row" data-i="${i}" style="gap:10px">
            <input type="text" value="${esc(a.emoji || '')}" data-emoji style="width:44px;text-align:center;padding:8px">
            <input type="text" value="${esc(a.name)}" data-name style="flex:1">
            <input type="color" value="${esc(a.color || '#3b62f6')}" data-color style="width:38px;height:38px;padding:2px;border-radius:10px">
            <button class="btn-icon" data-del-area aria-label="Remove">✕</button>
          </div>`).join('');
      }
      renderAreas();
      areasHost.addEventListener('input', () => saveAreasFromDom(root, areasHost, false));
      areasHost.addEventListener('click', async e => {
        const del = e.target.closest('[data-del-area]');
        if (del) {
          const i = +del.closest('[data-i]').dataset.i;
          const ok = await confirmDialog({ title: 'Remove this area?', message: 'Papers stay in the database but are hidden until an area with the same id exists again.', okLabel: 'Remove', danger: true });
          if (ok) { const list = state.areas.slice(); list.splice(i, 1); await saveAreas(list); renderAreas(); }
        }
      });
      qs('#area-add', root).addEventListener('click', async () => {
        const name = 'New Area';
        const list = state.areas.concat([{ id: 'area-' + uid('').slice(3), name, emoji: '📚', color: '#3b62f6' }]);
        await saveAreas(list); renderAreas();
      });

      // dictation + mailto
      qs('#dict-punct', root).addEventListener('change', e => updateSettings({ dictationPunctuation: e.target.checked }));
      qs('#mailto', root).addEventListener('change', e => updateSettings({ mailto: e.target.value.trim() }));

      // backup
      qs('#exp', root).addEventListener('click', async () => {
        const includePdfs = qs('#exp-pdfs', root).checked;
        try { const name = await exportBackup({ includePdfs }); toast('Backup exported: ' + name, 'ok', 4000); }
        catch (e) { toast('Export failed: ' + e.message, 'error'); }
      });
      qs('#imp', root).addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        try { const c = await importBackup(file, { merge: true }); toast(`Imported ${c.papers} papers, ${c.authors} authors, ${c.groups} groups.`, 'ok', 4000); go('/areas'); }
        catch (err) { toast('Import failed: ' + err.message, 'error', 5000); }
      });

      // demo
      qs('#demo-load', root).addEventListener('click', async () => { const n = await loadDemo(); toast(`Loaded ${n} demo papers.`, 'ok'); });
      qs('#demo-remove', root).addEventListener('click', async () => { const n = await removeDemo(); toast(n ? `Removed ${n} demo papers.` : 'No demo data found.'); });

      // storage estimate
      (async () => {
        try {
          if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            const used = (est.usage / 1048576).toFixed(1), quota = (est.quota / 1048576).toFixed(0);
            qs('#storage', root).textContent = `About ${used} MB used of ~${quota} MB available in this browser.`;
          } else qs('#storage', root).textContent = 'Storage estimate not available in this browser.';
        } catch (_) { qs('#storage', root).textContent = 'Storage estimate not available.'; }
      })();

      // reset
      qs('#reset', root).addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Erase everything?', message: 'All papers, notes, authors, groups, quizzes and PDFs in this browser will be permanently deleted. Settings and areas are kept. Export a backup first!', okLabel: 'Erase all', danger: true });
        if (!ok) return;
        await db.resetData({ keepSettings: true });
        await import('../store.js').then(m => m.load());
        toast('All data erased.'); go('/areas');
      });

      // ---- cloud sync ----
      const syncBody = qs('#sync-body', root);
      const badge = qs('#sync-badge', root);
      const STATE_LABEL = { idle: 'ready', syncing: 'syncing…', synced: 'synced', offline: 'offline', error: 'error', 'logged-out': 'logged out', 'not-configured': 'not set up' };
      function renderSync () {
        const cfg = sync.getConfig();
        const user = sync.currentUser();
        const configured = sync.isConfigured();
        if (!configured) {
          syncBody.innerHTML = `
            <div class="field"><label>Supabase Project URL</label><input type="url" id="sy-url" placeholder="https://xxxx.supabase.co" value="${esc(cfg.url)}"></div>
            <div class="field"><label>Supabase anon public key <span class="hint">(public — safe to store; protected by RLS)</span></label><input type="text" id="sy-key" placeholder="eyJ… (anon public)" value="${esc(cfg.anonKey)}"></div>
            <button class="btn btn--primary btn--small" id="sy-save-cfg">Save connection</button>`;
        } else if (!user) {
          syncBody.innerHTML = `
            <p class="small muted" style="margin:0 0 8px">Connected to <code class="inline">${esc(cfg.url)}</code>. <button class="voicebar__toggle" id="sy-edit-cfg">change</button></p>
            <div class="field"><label>Email</label><input type="text" id="sy-email" placeholder="you@example.org" autocomplete="username"></div>
            <div class="field"><label>Password</label><input type="password" id="sy-pass" placeholder="••••••••" autocomplete="current-password"></div>
            <div class="btn-row"><button class="btn btn--primary btn--small" id="sy-login">Log in</button><button class="btn btn--ghost btn--small" id="sy-signup">Create account</button></div>`;
        } else {
          syncBody.innerHTML = `
            <p class="small muted" style="margin:0 0 8px">Signed in as <b>${esc(user.email || 'user')}</b>.</p>
            <div class="btn-row"><button class="btn btn--primary btn--small" id="sy-now">Sync now</button><button class="btn btn--ghost btn--small" id="sy-logout">Log out</button></div>`;
        }
      }
      renderSync();

      syncStatusUnsub = sync.onStatus(st => {
        badge.textContent = STATE_LABEL[st.state] || st.state;
        badge.className = 'chip' + (st.state === 'synced' ? ' chip--teal' : st.state === 'error' ? '' : '');
        const now = qs('#sy-now', root);
        if (now) now.textContent = st.state === 'syncing' ? 'Syncing…' : (st.lastSync ? 'Sync now · ' + new Date(st.lastSync).toLocaleTimeString() : 'Sync now');
        if (st.state === 'error' && st.error) { const e = qs('#sy-err', root); if (!e) syncBody.insertAdjacentHTML('beforeend', `<p class="small" id="sy-err" style="color:var(--rose);margin-top:8px">${esc(st.error)}</p>`); else e.textContent = st.error; }
      });

      syncBody.addEventListener('click', async e => {
        const id = e.target.id;
        if (id === 'sy-save-cfg') {
          await sync.setConfig({ url: qs('#sy-url', root).value, anonKey: qs('#sy-key', root).value });
          toast('Connection saved.', 'ok'); renderSync();
        } else if (id === 'sy-edit-cfg') {
          await sync.setConfig({ url: '', anonKey: '' }); renderSync();
        } else if (id === 'sy-login' || id === 'sy-signup') {
          const email = qs('#sy-email', root).value.trim(); const pass = qs('#sy-pass', root).value;
          if (!email || !pass) { toast('Enter email and password.', 'error'); return; }
          e.target.disabled = true; e.target.textContent = '…';
          try {
            if (id === 'sy-signup') await sync.signUp(email, pass); else await sync.signIn(email, pass);
            toast('Signed in. Syncing…', 'ok'); renderSync();
            await sync.syncNow();
          } catch (err) { toast(err.message || 'Auth failed.', 'error', 6000); e.target.disabled = false; e.target.textContent = id === 'sy-signup' ? 'Create account' : 'Log in'; }
        } else if (id === 'sy-now') {
          const r = await sync.syncNow();
          if (r.ok) toast(`Synced. ${r.pushed || 0} pushed${r.pulledChanged ? ', changes pulled' : ''}.`, 'ok');
          else if (r.reason === 'offline') toast('Offline — will sync when back online.', 'info');
          else if (r.error) toast('Sync error: ' + r.error, 'error', 6000);
        } else if (id === 'sy-logout') {
          await sync.signOut(); renderSync(); toast('Logged out.');
        }
      });

    },
    cleanup () { if (syncStatusUnsub) try { syncStatusUnsub(); } catch (_) {} }
  };
}

async function saveAreasFromDom (root, host, notify) {
  const rows = qsa('[data-i]', host);
  const list = rows.map(r => {
    const name = r.querySelector('[data-name]').value.trim() || 'Untitled';
    const emoji = r.querySelector('[data-emoji]').value.trim();
    const color = r.querySelector('[data-color]').value;
    const existing = state.areas[+r.dataset.i] || {};
    return { id: existing.id || 'area-' + slug(name), name, emoji, color };
  });
  await saveAreas(list);
  if (notify) toast('Areas updated.', 'ok');
}
