/* =========================================================================
   main.js — application bootstrap.
   Loads data, applies the theme, registers routes and the service worker.
   ========================================================================= */

import * as router from './router.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { qs, qsa, toast, el, closeAllSheets } from './ui.js';

let container = qs('#view');
const head = qs('#head');

function renewContainer () {
  const fresh = document.createElement('main');
  fresh.id = 'view'; fresh.tabIndex = -1;
  container.replaceWith(fresh);
  container = fresh;
  return fresh;
}

/* ------------------------------------------------------------- theme ---- */
export function applyTheme (theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', (theme === 'light' || theme === 'dark') ? theme : 'auto');
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  qsa('meta[name="theme-color"]').forEach(m => m.remove());
  document.head.appendChild(el(`<meta name="theme-color" content="${dark ? '#0e1626' : '#f5f7fb'}">`));
}

/* ---------------------------------------------------- view rendering ---- */
let cleanupCurrent = null;

async function show (loadModule, params, stillValid) {
  closeAllSheets();
  renewContainer();
  container.innerHTML = '<div class="loading"><span class="loading__spinner"></span>One moment…</div>';
  let module;
  try { module = await loadModule(); }
  catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty"><div class="empty__ico">⚠</div>
      <h3>Can't load this section</h3>
      <p>If you're offline and haven't opened the app online at least once, this part may not be saved on the device yet.</p></div>`;
    return;
  }
  if (stillValid && !stillValid()) return;
  if (cleanupCurrent) { try { cleanupCurrent(); } catch (_) {} cleanupCurrent = null; }

  const view = await module.default(params);
  if (stillValid && !stillValid()) return;

  head.innerHTML = `
    ${view.back ? '<button class="btn-icon" id="btn-back" aria-label="Back">‹</button>' : ''}
    <h1 id="view-title">${view.title}${view.subtitle ? `<span class="subtitle">${view.subtitle}</span>` : ''}</h1>
    ${view.actions ? `<div class="head-actions">${view.actions}</div>` : ''}`;
  document.title = `${view.pageTitle || view.titleText || 'LiteratureStudy'} · LiteratureStudy`;
  const back = qs('#btn-back', head);
  if (back) back.addEventListener('click', () => router.back(view.backTo || '/areas'));

  container.innerHTML = view.html;
  container.scrollTop = 0; window.scrollTo(0, 0);

  if (view.mount) await view.mount(container);
  cleanupCurrent = view.cleanup || null;
  updateTabs();
}

function updateTabs () {
  const path = router.currentPath();
  const map = [
    ['areas', ['/areas', '/area']],
    ['authors', ['/authors', '/author']],
    ['groups', ['/groups', '/group']],
    ['settings', ['/settings']]
  ];
  const active = map.find(([, prefixes]) => prefixes.some(p => path.startsWith(p)));
  qsa('.tabbar a').forEach(a => {
    if (active && a.dataset.tab === active[0]) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* -------------------------------------------------------------- routes -- */
const V = {
  areas:    () => import('./views/areas.js'),
  hub:      () => import('./views/area-hub.js'),
  database: () => import('./views/database.js'),
  paper:    () => import('./views/paper.js'),
  paperForm:() => import('./views/paper-form.js'),
  study:    () => import('./views/study.js'),
  explore:  () => import('./views/explore.js'),
  authors:  () => import('./views/authors.js'),
  author:   () => import('./views/author.js'),
  groups:   () => import('./views/groups.js'),
  group:    () => import('./views/group.js'),
  settings: () => import('./views/settings.js')
};

router.register('/areas',                       (p, ok) => show(V.areas, p, ok));
router.register('/area/:area',                  (p, ok) => show(V.hub, p, ok));
router.register('/area/:area/database',         (p, ok) => show(V.database, p, ok));
router.register('/area/:area/database/new',     (p, ok) => show(V.paperForm, p, ok));
router.register('/area/:area/paper/:id',        (p, ok) => show(V.paper, p, ok));
router.register('/area/:area/paper/:id/edit',   (p, ok) => show(V.paperForm, { ...p, edit: true }, ok));
router.register('/area/:area/study',            (p, ok) => show(V.study, p, ok));
router.register('/area/:area/explore',          (p, ok) => show(V.explore, p, ok));
router.register('/authors',                     (p, ok) => show(V.authors, p, ok));
router.register('/author/:id',                  (p, ok) => show(V.author, p, ok));
router.register('/groups',                      (p, ok) => show(V.groups, p, ok));
router.register('/group/:id',                   (p, ok) => show(V.group, p, ok));
router.register('/settings',                    (p, ok) => show(V.settings, p, ok));

/* -------------------------------------------------------------- startup - */
async function boot () {
  try { await store.load(); }
  catch (e) {
    console.error(e);
    container.innerHTML = `<div class="empty"><div class="empty__ico">⚠</div>
      <h3>Can't open the database</h3>
      <p>If you're browsing privately, the browser blocks local storage and the app can't save anything. Try a normal tab.</p></div>`;
    return;
  }
  applyTheme(store.state.settings.theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (store.state.settings.theme === 'auto') applyTheme('auto');
  });

  const onScroll = () => head.classList.toggle('is-detached', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  await router.start();
  registerServiceWorker();

  // optional cloud sync (Supabase) — safe no-op until configured & logged in
  try { await sync.loadPersisted(); sync.initAutoSync(); }
  catch (e) { console.warn('Sync init skipped:', e); }
}

function registerServiceWorker () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') { console.info('Opened from file://: service worker and install are unavailable.'); return; }
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const fresh = reg.installing;
      if (!fresh) return;
      fresh.addEventListener('statechange', () => {
        if (fresh.state === 'installed' && navigator.serviceWorker.controller) {
          const t = toast('New version ready. Tap to reload.', 'info', 8000);
          t.style.cursor = 'pointer';
          t.addEventListener('click', () => { fresh.postMessage('update-now'); location.reload(); });
        }
      });
    });
  }).catch(e => console.warn('Service worker not registered:', e));
}

store.subscribe(() => updateTabs());
boot();
