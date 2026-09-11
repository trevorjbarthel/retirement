// ===== tabs.js =====
// The results-screen tab strip (WAI-ARIA tabs) and its per-plan sessionStorage memory.

import * as store from '/js/store.js';
import { ui } from '/js/ui-state.js';
import { $, scrollBehavior } from '/js/dom.js';
import { RESUME_BANNER_DISMISS_KEY } from '/js/plan-io.js';

// ===== RESULTS TABS =====
// WAI-ARIA tabs: roving tabindex, arrow keys activate automatically. The panels are `hidden`
// siblings under the results column (index.html #panel-*), so nothing here depends on layout.
export const TAB_IDS = ['overview', 'pay', 'tools', 'checklist', 'resources'];
// sessionStorage, NOT location.hash — the hash carries the plan's secret edit key (#k=).
// The value is "<planId|local>:<tabId>" and is only honoured for the same plan, so a shared
// link opened fresh (empty sessionStorage) always starts on Overview. Same shape as
// RESUME_BANNER_DISMISS_KEY.
export const TAB_STORAGE_KEY = 'mtc-results-tab';

export function tabPlanKey() { return store.getStatus().planId || 'local'; }

export function rememberedTab() {
  if (ui.sampleMode) return null;
  try {
    const v = sessionStorage.getItem(TAB_STORAGE_KEY) || '';
    const i = v.lastIndexOf(':');
    if (i < 0 || v.slice(0, i) !== tabPlanKey()) return null;
    const id = v.slice(i + 1);
    return TAB_IDS.includes(id) ? id : null;
  } catch { return null; }
}

export function rememberTab(id) {
  if (ui.sampleMode) return;
  try { sessionStorage.setItem(TAB_STORAGE_KEY, `${tabPlanKey()}:${id}`); } catch { /* ignore */ }
}

export function stickyStackHeight() {
  return ($('resultsHeader')?.offsetHeight || 0) + ($('resultsSubnav')?.offsetHeight || 0);
}

// The header and the tab strip are both sticky, so a plain scrollIntoView() lands the target
// underneath them. Offsets are read live: the header wraps on phones.
/** @param {HTMLElement} el @param {ScrollBehavior} [behavior] */
export function scrollToUnderSticky(el, behavior = scrollBehavior()) {
  if (!el) return;
  const top = window.scrollY + el.getBoundingClientRect().top - stickyStackHeight() - 12;
  window.scrollTo({ top: Math.max(0, top), behavior });
}

export function setActiveTab(id, { focus = false, scroll = false } = {}) {
  if (!TAB_IDS.includes(id)) id = 'overview';
  for (const t of TAB_IDS) {
    const on = t === id;
    const tab = $('tab-' + t), panel = $('panel-' + t);
    if (!tab || !panel) continue;
    tab.setAttribute('aria-selected', String(on));
    tab.setAttribute('tabindex', on ? '0' : '-1');
    panel.hidden = !on;
  }
  ui.activeTab = id;
  rememberTab(id);
  const tab = $('tab-' + id), panel = $('panel-' + id);
  if (!tab || !panel) return;
  if (focus) tab.focus();
  if (focus || scroll) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // the strip scrolls horizontally on phones
  // Switching while scrolled deep into a long panel would otherwise leave the viewport at an
  // arbitrary point of the new one (or past its end). Only move if the panel's top is hidden
  // under the stuck header/strip.
  if (scroll && panel.getBoundingClientRect().top < stickyStackHeight()) scrollToUnderSticky(panel, 'auto');
}

export function wireTabs() {
  // ----- results tabs -----
  // Enter/Space on the native <button>s already fire click, so only the arrow keys need
  // wiring. Arrow keys activate as they move (automatic activation), wrapping at the ends.
  const tablist = $('resultsTablist');
  tablist.addEventListener('click', (e) => {
    const btn = e.target.closest('[role="tab"]');
    if (btn) setActiveTab(btn.id.slice('tab-'.length), { scroll: true });
  });
  tablist.addEventListener('keydown', (e) => {
    const cur = e.target.closest('[role="tab"]');
    if (!cur) return;
    const i = TAB_IDS.indexOf(cur.id.slice('tab-'.length));
    let next = null;
    if (e.key === 'ArrowRight') next = TAB_IDS[(i + 1) % TAB_IDS.length];
    else if (e.key === 'ArrowLeft') next = TAB_IDS[(i - 1 + TAB_IDS.length) % TAB_IDS.length];
    else if (e.key === 'Home') next = TAB_IDS[0];
    else if (e.key === 'End') next = TAB_IDS[TAB_IDS.length - 1];
    if (!next) return;
    e.preventDefault();
    setActiveTab(next, { focus: true, scroll: true });
  });

  // Publish the sticky header's real height for .results-subnav { top: var(--header-h) }.
  // It wraps to 2-3 rows on narrow phones, so a hard-coded offset slid the strip (and the
  // read-only banner inside it) underneath. CSSOM, so unaffected by style-src 'self'.
  const resultsHeader = $('resultsHeader');
  if (resultsHeader && 'ResizeObserver' in window) {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--header-h', resultsHeader.offsetHeight + 'px');
    }).observe(resultsHeader);
  }

}
