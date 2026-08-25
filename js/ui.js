/* =========================================================================
   ui.js — DOM helpers, toasts, bottom sheets.
   ========================================================================= */

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build a DOM node from an HTML string. */
export function el (html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function vibrate (ms = 8) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (_) {} }
}

/* --------------------------------------------------------------- toasts -- */

let toastHost = null;
function ensureToastHost () {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.id = 'toasts';
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

/** Show a toast; returns the element so callers can make it clickable. */
export function toast (message, kind = 'info', ms = 3200) {
  const host = ensureToastHost();
  const node = el(`<div class="toast toast--${kind}">${message}</div>`);
  host.appendChild(node);
  if (ms) setTimeout(() => { node.style.opacity = '0'; setTimeout(() => node.remove(), 250); }, ms);
  return node;
}

/* ---------------------------------------------------------------- sheets - */

const openSheets = new Set();

/** Open a bottom sheet. `content` is an HTMLElement or html string.
 *  Returns { close, root } where root is the sheet body element. */
export function openSheet ({ title = '', content = '', onClose = null } = {}) {
  const backdrop = el(`
    <div class="sheet-backdrop" role="dialog" aria-modal="true">
      <div class="sheet">
        <div class="sheet__grab"></div>
        <div class="sheet__head">
          <h2>${title}</h2>
          <button class="btn-icon sheet__close" aria-label="Close">✕</button>
        </div>
        <div class="sheet__body"></div>
      </div>
    </div>`);
  const body = qs('.sheet__body', backdrop);
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.appendChild(content);

  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('is-open'));

  function close () {
    if (!openSheets.has(backdrop)) return;
    openSheets.delete(backdrop);
    backdrop.classList.remove('is-open');
    if (onClose) try { onClose(); } catch (_) {}
    setTimeout(() => backdrop.remove(), 220);
  }
  openSheets.add(backdrop);
  qs('.sheet__close', backdrop).addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  return { close, root: body, backdrop };
}

export function closeAllSheets () {
  openSheets.forEach(b => {
    b.classList.remove('is-open');
    setTimeout(() => b.remove(), 220);
  });
  openSheets.clear();
}

/** Simple confirm dialog resolving to a boolean. */
export function confirmDialog ({ title = 'Are you sure?', message = '', okLabel = 'Confirm', danger = false } = {}) {
  return new Promise(resolve => {
    const { root, close } = openSheet({ title, onClose: () => resolve(false) });
    root.innerHTML = `
      <p class="muted" style="margin-top:0">${message}</p>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn--ghost" data-x>Cancel</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-ok>${okLabel}</button>
      </div>`;
    root.querySelector('[data-ok]').addEventListener('click', () => { resolve(true); close(); });
    root.querySelector('[data-x]').addEventListener('click', () => { resolve(false); close(); });
  });
}

/** Trigger a client-side file download. */
export function download (filename, text, mime = 'text/plain') {
  const blob = text instanceof Blob ? text : new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Copy text to clipboard, best-effort. */
export async function copyText (text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_) { return false; }
}
