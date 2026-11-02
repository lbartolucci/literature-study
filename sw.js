/* =========================================================================
   sw.js — service worker
   · app shell (HTML, CSS, JS, icons) → cache-first with silent background
     update: the app starts instantly, even offline;
   · OpenAlex API calls → never handled here (openalex.js keeps its own
     IndexedDB cache with a real expiry).
   All paths are relative so the app works from a GitHub Pages subfolder
   such as https://user.github.io/literature-study/.
   ========================================================================= */

const VERSION = 'v1.3.0';   // + spaced-repetition Study, post-study Quiz
const SHELL_CACHE = `shell-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/router.js',
  './js/db.js',
  './js/store.js',
  './js/models.js',
  './js/ui.js',
  './js/sync.js',
  './js/openalex.js',
  './js/dictation.js',
  './js/backup.js',
  './js/demo.js',
  './js/utils/text.js',
  './js/quiz/generator.js',
  './js/quiz/review.js',
  './js/quiz/runner.js',
  './js/quiz/export.js',
  './js/srs.js',
  './js/views/areas.js',
  './js/views/area-hub.js',
  './js/views/database.js',
  './js/views/paper.js',
  './js/views/paper-form.js',
  './js/views/study.js',
  './js/views/quiz.js',
  './js/views/explore.js',
  './js/views/authors.js',
  './js/views/author.js',
  './js/views/groups.js',
  './js/views/group.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(u => cache.add(u).catch(e => console.warn('Not cached:', u, e))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(n => n.startsWith('shell-') && n !== SHELL_CACHE)
      .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', ev => {
  if (ev.data === 'update-now') self.skipWaiting();
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // OpenAlex (and any other API): go to the network; cache lives in IndexedDB
  if (/openalex\.org|crossref\.org|doi\.org/.test(url.hostname)) return;

  // same origin: app shell
  if (url.origin === self.location.origin) {
    ev.respondWith(shellFirst(req));
  }
});

async function shellFirst (req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const fromNet = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  if (cached) { fromNet.catch(() => {}); return cached; }   // silent update

  const res = await fromNet;
  if (res) return res;

  if (req.mode === 'navigate') {
    const index = await cache.match('./index.html');
    if (index) return index;
  }
  return new Response('Content not available offline.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
