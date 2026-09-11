// ===== dom.js =====
// DOM utilities shared by every feature module: element lookup, formatting, CSP-safe dynamic
// styling, the post-render hook, toasts, the live-region announcer, and the shared <dialog>.

import { createIcons } from '/js/icons.js';

// ===== UTILITIES =====
// Returns `any` deliberately. Every call site here is a lookup of an element this file also
// authored in index.html, used as whatever it actually is — .value on inputs, .checked on
// checkboxes, .classList on containers. Typing it as HTMLElement would mean ~200 casts that
// assert exactly what the id already tells you, which buys no safety. checkJs still catches
// the mistakes that matter in this file: misspelled function names, wrong arity, bad
// property access on typed values from calc.js.
/** @param {string} id @returns {any} */
export function $(id) { return document.getElementById(id); }
// LOCAL calendar date as YYYY-MM-DD. toISOString() is UTC, which rolls a US evening to
// "tomorrow" — every date here is parsed as local midnight, so produce a local string.
export function todayLocalStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
export function fmtDate(d) { return d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }); }
export function fmtDateShort(d) { return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' }); }
export function fmtCurrency(val) { return val.toLocaleString('en-US', { style:'currency', currency:'USD' }); }
export function fmtCurrencyWhole(val) { return val.toLocaleString('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }); }
// `parseFloat(x) || dflt` silently discards a deliberate, legitimate 0 (0 leave days,
// $0/mo TSP contribution, a 0% advisory fee) and replaces it with the fallback default.
// Use this wherever 0 is a valid answer; reserve `|| dflt` for fields where 0 never is.
export function numOr(n, dflt) { return Number.isFinite(n) ? n : dflt; }
export function scrollBehavior() { return (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth'; }
// Escape untrusted/plan-derived strings before they enter an innerHTML template.
// Plans can arrive from a shared /p/<id> link or an imported backup, so any free-text
// field (e.g. postLocation) must be escaped at the sink to prevent DOM XSS.
export const ESC_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (ch) => ESC_MAP[ch]); }

// Same rationale as $ above: these return elements this file authored, used as what they
// actually are. Typing them as Element would mean a cast at every call site asserting what
// the selector already states.
/** @param {string} sel @param {any} [root] @returns {any[]} */
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
/** @param {string} sel @param {any} [root] @returns {any} */
export function $1(sel, root = document) { return root.querySelector(sel); }

// ----- CSP-safe dynamic styling -----
// With `style-src 'self'` a style="..." attribute cannot be written into an HTML string —
// which is the point: an injected element could otherwise carry its own styling and, say,
// cover the read-only warning or fake a dialog. The CSSOM is NOT restricted by CSP, so
// templates emit data-css-* hints and this applies them afterwards.
//
// Call paintDynamicStyles(container) after any innerHTML assignment whose template used one.
export const CSS_HINTS = [
  ['cssBg', 'background', 'data-css-bg'],
  ['cssColor', 'color', 'data-css-color'],
  ['cssWidth', 'width', 'data-css-width'],
  ['cssLeft', 'left', 'data-css-left'],
  ['cssOpacity', 'opacity', 'data-css-opacity'],
];
export function paintDynamicStyles(root) {
  if (!root) return;
  for (const [key, prop, attr] of CSS_HINTS) {
    $$(`[${attr}]`, root).forEach((/** @type {any} */ el) => {
      const v = el.dataset[key];
      if (v) el.style.setProperty(prop, v);
      el.removeAttribute(attr);
    });
  }
  // The root element itself can carry a hint too (querySelectorAll only sees descendants).
  if (root instanceof Element) {
    const el = /** @type {any} */ (root);
    for (const [key, prop, attr] of CSS_HINTS) {
      if (el.hasAttribute(attr)) {
        const v = el.dataset[key];
        if (v) el.style.setProperty(prop, v);
        el.removeAttribute(attr);
      }
    }
  }
}

// Single post-render hook. Both passes must run after ANY innerHTML assignment: one applies
// the computed styles the templates couldn't inline, the other swaps <i data-lucide> for SVG.
export function afterRender(root = document) {
  paintDynamicStyles(root);
  createIcons(root);
}

export function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// Announce to assistive tech. Debounced, because the pay estimator recomputes on every
// keystroke and an un-throttled live region is unusable — it interrupts itself constantly.
export let announceTimer = null;
export function announce(msg, delay = 900) {
  const el = $('a11yAnnounce');
  if (!el || !msg) return;
  if (announceTimer) clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    // Re-setting identical text doesn't re-announce in some readers; clear first.
    el.textContent = '';
    setTimeout(() => { el.textContent = msg; }, 30);
  }, delay);
}


// ----- Shared modal -----
// Returns the `value` of whichever action the user chose, or null if they dismissed it
// (Escape / backdrop). Callers MUST treat null as "no decision" rather than folding it into
// a destructive branch — the bug in the old confirm()-based conflict prompt was exactly that
// a falsy return silently meant "discard my edits".
export function showModal({ title, bodyHtml, actions }) {
  const dlg = $('appModal');
  if (!dlg || typeof dlg.showModal !== 'function') return Promise.resolve(null); // no <dialog> support
  $('appModalTitle').textContent = title;
  $('appModalBody').innerHTML = bodyHtml;
  const actionsWrap = $('appModalActions');
  actionsWrap.innerHTML = actions.map((a, i) =>
    `<button type="submit" value="${escapeHtml(a.value)}" class="modal-btn modal-btn-${a.style || 'secondary'}"${i === 0 ? ' data-autofocus' : ''}>${escapeHtml(a.label)}</button>`
  ).join('');
  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener('close', onClose);
      resolve(dlg.returnValue || null);
    };
    dlg.addEventListener('close', onClose);
    dlg.returnValue = '';
    dlg.showModal();
    $1('[data-autofocus]', actionsWrap)?.focus();
    afterRender();
  });
}
