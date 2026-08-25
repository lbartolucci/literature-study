/* =========================================================================
   dictation.js — voice input for text fields (Web Speech API).
   Speak instead of typing on the phone. Two honest caveats, surfaced in the
   UI: recognition happens on the browser's servers (Apple on Safari, Google
   on Chrome), so it needs a connection; and where the API is missing the
   button simply doesn't appear — the system keyboard's own mic still works.
   ========================================================================= */

import { qs, qsa, toast, vibrate } from './ui.js';
import { esc } from './utils/text.js';

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const dictationSupported = () => !!Recognition;

/* Order matters: multi-word phrases before single words. */
const PUNCTUATION = [
  [/\bnew paragraph\b/gi, '\n\n'],
  [/\bnew line\b/gi, '\n'],
  [/\bnext line\b/gi, '\n'],
  [/\bfull stop\b/gi, '.'],
  [/\bquestion mark\b/gi, '?'],
  [/\bexclamation (?:mark|point)\b/gi, '!'],
  [/\bsemicolon\b/gi, ';'],
  [/\bcolon\b/gi, ':'],
  [/\bellipsis\b/gi, '…'],
  [/\bopen (?:paren|parenthesis|bracket)\b/gi, '('],
  [/\bclose (?:paren|parenthesis|bracket)\b/gi, ')'],
  [/\bopen quote(?:s)?\b/gi, '“'],
  [/\bclose quote(?:s)?\b/gi, '”'],
  [/\bquote unquote\b/gi, ''],
  [/\bdash\b/gi, '—'],
  [/\bhyphen\b/gi, '-'],
  [/\bcomma\b/gi, ','],
  [/\bperiod\b/gi, '.']
];

export function applyPunctuation (text) {
  let t = ' ' + String(text) + ' ';
  PUNCTUATION.forEach(([re, sign]) => { t = t.replace(re, sign); });
  return fixSpacing(t);
}

function fixSpacing (t) {
  return t
    .replace(/\s+([,.;:!?…”)])/g, '$1')
    .replace(/([“(])\s+/g, '$1')
    .replace(/([,.;:!?…])(?=[^\s\d])/g, '$1 ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/([.!?…]\s+|^\s*)([a-z])/g, (_, pre, c) => pre + c.toUpperCase())
    .trim();
}

/* -------------------------------------------------------------- markup --- */

/** A voice bar to place right after a text field.
 *  `field` is the id of the input/textarea. */
export function voicebarHTML ({ field, lang = 'en-US', punctuation = true, label = 'Dictate' }) {
  if (!dictationSupported()) return '';
  return `
    <div class="voicebar" data-voice="${esc(field)}" data-lang="${esc(lang)}">
      <button type="button" class="voicebar__btn" aria-pressed="false">
        <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3"/>
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>
        </svg>
        <span class="voicebar__label">${esc(label)}</span>
      </button>
      <button type="button" class="voicebar__toggle ${punctuation ? 'is-on' : ''}" aria-pressed="${punctuation}"
              title="Convert spoken 'comma', 'period', 'new line' into punctuation">punctuation</button>
      <span class="voicebar__status" role="status" aria-live="polite"></span>
      <span class="voicebar__preview" hidden></span>
    </div>`;
}

/* --------------------------------------------------------- behaviour ----- */

/** Wire every voice bar inside `root`. Returns a cleanup function that frees
 *  the microphone (call it when the view is destroyed). */
export function attachDictation (root, { punctuation = true } = {}) {
  if (!dictationSupported()) return () => {};
  const sessions = qsa('[data-voice]', root).map(bar => session(bar, { punctuation }));
  return () => sessions.forEach(s => s.stop());
}

function session (bar, opts) {
  const field = document.getElementById(bar.dataset.voice);
  const button = qs('.voicebar__btn', bar);
  const label = qs('.voicebar__label', bar);
  const status = qs('.voicebar__status', bar);
  const preview = qs('.voicebar__preview', bar);
  const toggle = qs('.voicebar__toggle', bar);

  let rec = null, active = false, stoppedByUs = false, emptyRestarts = 0;
  let lang = bar.dataset.lang || 'en-US';
  let signs = !!opts.punctuation;

  /* --- transcript state (the fix) ------------------------------------------
     The Web Speech API delivers a *cumulative* results list on every onresult
     event. Re-reading only the newest entry (or appending per event) makes the
     text grow word by word. Instead we hold the text that was in the field
     BEFORE dictation (basePrefix/baseSuffix, around the caret) and, on every
     event, recompute the whole spoken segment from scratch:
       committed     = finals carried over across engine auto-restarts
       sessionFinal  = finals of the CURRENT recognition session (recomputed)
       interimText   = live, non-final text (REPLACES, never accumulates)
     The field is always rebuilt as base + processed(spoken) — idempotent, so
     repeated events can never duplicate. */
  let basePrefix = '', baseSuffix = '';
  let committed = '', sessionFinal = '', interimText = '';

  function setStatus (t) { status.textContent = t; }
  function showPreview (t) { preview.textContent = t; preview.hidden = !t; }

  /** Rebuild the field from base + the spoken transcript. */
  function applyField (includeInterim) {
    if (!field) return;
    const raw = [committed, sessionFinal, includeInterim ? interimText : '']
      .map(s => s.trim()).filter(Boolean).join(' ');
    const processed = raw ? (signs ? applyPunctuation(raw) : fixSpacing(raw)) : '';
    let mid = processed;
    if (mid) {
      if (!basePrefix.trim() || /[.!?…]\s*$/.test(basePrefix) || /\n\s*$/.test(basePrefix)) mid = mid.replace(/^([a-z])/, c => c.toUpperCase());
      if (basePrefix && !/[\s(“]$/.test(basePrefix) && !/^[,.;:!?…”)]/.test(mid)) mid = ' ' + mid;
    }
    field.value = basePrefix + mid + baseSuffix;
    const pos = (basePrefix + mid).length;
    try { field.setSelectionRange(pos, pos); } catch (_) {}
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function build () {
    const r = new Recognition();
    r.lang = lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => { setStatus('listening…'); bar.classList.add('is-listening'); button.setAttribute('aria-pressed', 'true'); label.textContent = 'Stop'; };
    r.onresult = ev => {
      // Recompute finals and interim from the ENTIRE current results list each
      // time. resultIndex/isFinal quirks across engines then can't duplicate.
      let f = '', it = '';
      for (let i = 0; i < ev.results.length; i++) {
        const chunk = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) f += chunk + ' ';
        else it += chunk;
      }
      if (f.trim()) emptyRestarts = 0;
      sessionFinal = f.trim();
      interimText = it.trim();
      applyField(true);
      showPreview(interimText);
    };
    r.onerror = ev => {
      const code = ev.error;
      if (code === 'aborted') return;
      if (code === 'no-speech') { setStatus("didn't catch that…"); return; }
      active = false;
      const msgs = {
        'not-allowed': 'Microphone blocked: allow access to this site in your browser settings.',
        'service-not-allowed': 'The browser will not grant speech recognition to this page.',
        'audio-capture': 'No microphone found on this device.',
        'network': 'Dictation needs a connection: recognition runs on the browser’s servers.',
        'language-not-supported': `Recognition does not support this language (${lang}).`
      };
      toast(msgs[code] || 'Dictation stopped. Try again.', 'error', 5000);
      off();
    };
    r.onend = () => {
      // Commit this session's finals before the engine may auto-restart, so the
      // next (fresh) session starts from an empty results list without loss.
      if (sessionFinal) { committed = (committed ? committed + ' ' : '') + sessionFinal; sessionFinal = ''; }
      interimText = '';
      if (active && !stoppedByUs) {
        if (++emptyRestarts > 6) { toast('Stopped listening: no more audio.', 'info'); applyField(false); off(); return; }
        try { r.start(); return; } catch (_) {}
      }
      applyField(false);   // drop any lingering interim, keep committed text
      off();
    };
    return r;
  }

  function off () {
    active = false; bar.classList.remove('is-listening');
    button.setAttribute('aria-pressed', 'false'); label.textContent = 'Dictate';
    setStatus(''); showPreview('');
  }

  function start () {
    if (active) return;
    if (navigator.onLine === false) { toast('Dictation needs a connection: recognition does not run on the phone.', 'error', 5000); return; }
    // Capture the text around the caret NOW; dictation inserts here and the
    // field is rebuilt from this base — never from the previous transcript.
    const selStart = field.selectionStart ?? field.value.length;
    const selEnd = field.selectionEnd ?? field.value.length;
    basePrefix = field.value.slice(0, selStart);
    baseSuffix = field.value.slice(selEnd);
    committed = ''; sessionFinal = ''; interimText = '';
    active = true; stoppedByUs = false; emptyRestarts = 0; rec = build();
    try { rec.start(); vibrate(10); field.focus(); }
    catch (_) { active = false; toast('Could not start dictation in this browser.', 'error'); }
  }

  function stop () {
    if (!rec) { off(); return; }
    stoppedByUs = true; active = false;
    try { rec.stop(); } catch (_) {}
    try { rec.abort(); } catch (_) {}
    rec = null;
    applyField(false);   // finalise text without interim, even if onend is skipped
    off(); vibrate(6);
  }

  button.addEventListener('click', () => (active ? stop() : start()));
  if (toggle) toggle.addEventListener('click', () => {
    signs = !signs; toggle.classList.toggle('is-on', signs); toggle.setAttribute('aria-pressed', String(signs));
    toast(signs ? 'Spoken punctuation on: “comma”, “period”, “new line” become signs.' : 'Spoken punctuation off: words stay words.');
  });

  return { stop };
}
