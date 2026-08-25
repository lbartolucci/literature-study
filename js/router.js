/* =========================================================================
   router.js — hash-based routing.
   The hash (#/area/xyz/database) is the only form that works well both on
   GitHub Pages inside a subfolder and as an installed PWA, where there is no
   server to rewrite paths.
   ========================================================================= */

const routes = [];
let inFlight = null;

/** Register a route: '/area/:id/paper/:pid' → handler({ id, pid, query, path }). */
export function register (schema, handler) {
  const names = [];
  const regex = new RegExp('^' + schema
    .replace(/\/:([A-Za-z0-9_]+)/g, (_, n) => { names.push(n); return '/([^/]+)'; })
    .replace(/\*/g, '.*') + '$');
  routes.push({ regex, names, handler, schema });
}

export function go (path, { replace = false } = {}) {
  const next = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === next) { resolve(); return; }
  if (replace) history.replaceState(null, '', next);
  else location.hash = next;
}

export function back (fallback = '/areas') {
  if (history.length > 1) history.back();
  else go(fallback);
}

export function currentPath () {
  const h = location.hash.replace(/^#/, '');
  return h || '/areas';
}

export async function resolve () {
  const path = currentPath();
  const [base, queryStr] = path.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr || ''));

  for (const r of routes) {
    const m = base.match(r.regex);
    if (!m) continue;
    const params = { query, path: base };
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    const mine = Symbol('nav');
    inFlight = mine;
    try {
      await r.handler(params, () => inFlight === mine);
    } catch (e) {
      console.error('Route error', base, e);
      throw e;
    }
    return;
  }
  go('/areas', { replace: true });
}

export function start () {
  window.addEventListener('hashchange', () => resolve());
  if (!location.hash) history.replaceState(null, '', '#/areas');
  return resolve();
}
