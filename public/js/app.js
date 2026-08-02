// ===== app.js =====
// The application shell: DOM wiring, rendering, and event handling for index.html.
//
// This was a ~2,700-line inline <script type="module"> in index.html. Moving it out is what
// lets the CSP drop `script-src 'unsafe-inline'` — an inline script is indistinguishable to
// the browser from one an XSS payload injected. It also means the code is now reachable by
// `tsc` (see tsconfig.calc.json) instead of being checked by a bespoke regex script.
//
// Module-scope `let` bindings below are the app's mutable state. They stay in ONE module
// deliberately: an imported binding is read-only, so splitting these across files would
// require converting every assignment into a setter. calc.js (pure domain logic) and
// store.js (persistence) are already separate; this file is the impure DOM layer.

import {
  SKILLBRIDGE_LIMITS, getBasePay2026, VA_RATES, vaCompensation, STATE_TAX_DATA,
  parseStateFromLocation, interpolateAnnuityFactor, getLifeExpDistributionPeriod,
  subDays, addDays, daysBetween, firstOfNextMonth, clamp, getRankGrade, getSkillbridgeAuthorizedMax,
  computeRetirementPay, computeHigh3, applyVAWaiver, milestoneStatus, computeMilestones,
  classifyDayMeter, buildICS, isValidState,
  DATA_VINTAGE, FLAG_OFFICER_GRADES, getBAS, PAY_TABLE_YEAR,
  buildPhases, migrateChecks, compareScenarios,
  computeSBP, compareConcurrentReceipt, TRICARE_FEES_2026, estimateRetireeHealthcareCost,
  compareTricarePrimeSelect, compareStates, estimateStateTaxOnRetiredPay, estimatePPM, tspKeepVsRoll,
  compareLeaveSellBack, LEAVE_SELLBACK_CAREER_CAP, requiredCivilianSalary
} from '/js/calc.js';
import * as store from '/js/store.js';
import { createIcons } from '/js/icons.js';

const BRANCH_META = {
  'Army':        { color:'#2d6a4f', emoji:'⭐', terms:{ spec:'MOS', member:'Soldier', nco:'NCO' }},
  'Navy':        { color:'#1a2744', emoji:'⚓', terms:{ spec:'Rate/NEC', member:'Sailor', nco:'Petty Officer' }},
  'Air Force':   { color:'#3468b0', emoji:'✈️', terms:{ spec:'AFSC', member:'Airman', nco:'NCO' }},
  'Marine Corps':{ color:'#b91c1c', emoji:'🦅', terms:{ spec:'MOS', member:'Marine', nco:'NCO' }},
  'Space Force': { color:'#1e3f6e', emoji:'🛸', terms:{ spec:'AFSC', member:'Guardian', nco:'NCO' }},
  'Coast Guard': { color:'#c2410c', emoji:'🔱', terms:{ spec:'Rating', member:'Member', nco:'Petty Officer' }},
};

const RANKS = {
  E: {
    'Army':['E-1 Private','E-2 Private Second Class','E-3 Private First Class','E-4 Specialist/Corporal','E-5 Sergeant','E-6 Staff Sergeant','E-7 Sergeant First Class','E-8 Master Sergeant/First Sergeant','E-9 Sergeant Major'],
    'Navy':['E-1 Seaman Recruit','E-2 Seaman Apprentice','E-3 Seaman','E-4 Petty Officer 3rd Class','E-5 Petty Officer 2nd Class','E-6 Petty Officer 1st Class','E-7 Chief Petty Officer','E-8 Senior Chief Petty Officer','E-9 Master Chief Petty Officer'],
    'Air Force':['E-1 Airman Basic','E-2 Airman','E-3 Airman First Class','E-4 Senior Airman','E-5 Staff Sergeant','E-6 Technical Sergeant','E-7 Master Sergeant','E-8 Senior Master Sergeant','E-9 Chief Master Sergeant'],
    'Marine Corps':['E-1 Private','E-2 Private First Class','E-3 Lance Corporal','E-4 Corporal','E-5 Sergeant','E-6 Staff Sergeant','E-7 Gunnery Sergeant','E-8 Master Sergeant/First Sergeant','E-9 Master Gunnery Sergeant/Sergeant Major'],
    'Space Force':['E-1 Specialist 1','E-2 Specialist 2','E-3 Specialist 3','E-4 Specialist 4','E-5 Sergeant','E-6 Technical Sergeant','E-7 Master Sergeant','E-8 Senior Master Sergeant','E-9 Chief Master Sergeant'],
    'Coast Guard':['E-1 Seaman Recruit','E-2 Seaman Apprentice','E-3 Seaman','E-4 Petty Officer 3rd Class','E-5 Petty Officer 2nd Class','E-6 Petty Officer 1st Class','E-7 Chief Petty Officer','E-8 Senior Chief Petty Officer','E-9 Master Chief Petty Officer'],
  },
  W: {
    'Army':['W-1 Warrant Officer 1','W-2 Chief Warrant Officer 2','W-3 Chief Warrant Officer 3','W-4 Chief Warrant Officer 4','W-5 Chief Warrant Officer 5'],
    'Navy':['W-1 Warrant Officer 1','W-2 Chief Warrant Officer 2','W-3 Chief Warrant Officer 3','W-4 Chief Warrant Officer 4','W-5 Chief Warrant Officer 5'],
    'Marine Corps':['W-1 Warrant Officer 1','W-2 Chief Warrant Officer 2','W-3 Chief Warrant Officer 3','W-4 Chief Warrant Officer 4','W-5 Chief Warrant Officer 5'],
    'Coast Guard':['W-1 Warrant Officer 1','W-2 Chief Warrant Officer 2','W-3 Chief Warrant Officer 3','W-4 Chief Warrant Officer 4'],
    'Air Force':[], 'Space Force':[]
  },
  O: {
    '_all':['O-1 Second Lieutenant','O-2 First Lieutenant','O-3 Captain','O-4 Major','O-5 Lieutenant Colonel','O-6 Colonel','O-7 Brigadier General','O-8 Major General','O-9 Lieutenant General','O-10 General'],
    'Navy':['O-1 Ensign','O-2 Lieutenant Junior Grade','O-3 Lieutenant','O-4 Lieutenant Commander','O-5 Commander','O-6 Captain','O-7 Rear Admiral Lower Half','O-8 Rear Admiral','O-9 Vice Admiral','O-10 Admiral'],
    'Coast Guard':['O-1 Ensign','O-2 Lieutenant Junior Grade','O-3 Lieutenant','O-4 Lieutenant Commander','O-5 Commander','O-6 Captain','O-7 Rear Admiral Lower Half','O-8 Rear Admiral','O-9 Vice Admiral','O-10 Admiral'],
  }
};











// ===== UTILITIES =====
// Returns `any` deliberately. Every call site here is a lookup of an element this file also
// authored in index.html, used as whatever it actually is — .value on inputs, .checked on
// checkboxes, .classList on containers. Typing it as HTMLElement would mean ~200 casts that
// assert exactly what the id already tells you, which buys no safety. checkJs still catches
// the mistakes that matter in this file: misspelled function names, wrong arity, bad
// property access on typed values from calc.js.
/** @param {string} id @returns {any} */
function $(id) { return document.getElementById(id); }
// LOCAL calendar date as YYYY-MM-DD. toISOString() is UTC, which rolls a US evening to
// "tomorrow" — every date here is parsed as local midnight, so produce a local string.
function todayLocalStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function fmtDate(d) { return d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }); }
function fmtDateShort(d) { return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'2-digit' }); }
function fmtCurrency(val) { return val.toLocaleString('en-US', { style:'currency', currency:'USD' }); }
function fmtCurrencyWhole(val) { return val.toLocaleString('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }); }
// `parseFloat(x) || dflt` silently discards a deliberate, legitimate 0 (0 leave days,
// $0/mo TSP contribution, a 0% advisory fee) and replaces it with the fallback default.
// Use this wherever 0 is a valid answer; reserve `|| dflt` for fields where 0 never is.
function numOr(n, dflt) { return Number.isFinite(n) ? n : dflt; }
function scrollBehavior() { return (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth'; }
// Escape untrusted/plan-derived strings before they enter an innerHTML template.
// Plans can arrive from a shared /p/<id> link or an imported backup, so any free-text
// field (e.g. postLocation) must be escaped at the sink to prevent DOM XSS.
const ESC_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (ch) => ESC_MAP[ch]); }

// Same rationale as $ above: these return elements this file authored, used as what they
// actually are. Typing them as Element would mean a cast at every call site asserting what
// the selector already states.
/** @param {string} sel @param {any} [root] @returns {any[]} */
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
/** @param {string} sel @param {any} [root] @returns {any} */
function $1(sel, root = document) { return root.querySelector(sel); }

// ----- CSP-safe dynamic styling -----
// With `style-src 'self'` a style="..." attribute cannot be written into an HTML string —
// which is the point: an injected element could otherwise carry its own styling and, say,
// cover the read-only warning or fake a dialog. The CSSOM is NOT restricted by CSP, so
// templates emit data-css-* hints and this applies them afterwards.
//
// Call paintDynamicStyles(container) after any innerHTML assignment whose template used one.
const CSS_HINTS = [
  ['cssBg', 'background', 'data-css-bg'],
  ['cssColor', 'color', 'data-css-color'],
  ['cssWidth', 'width', 'data-css-width'],
  ['cssLeft', 'left', 'data-css-left'],
  ['cssOpacity', 'opacity', 'data-css-opacity'],
];
function paintDynamicStyles(root) {
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
function afterRender(root = document) {
  paintDynamicStyles(root);
  createIcons(root);
}

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// Announce to assistive tech. Debounced, because the pay estimator recomputes on every
// keystroke and an un-throttled live region is unusable — it interrupts itself constantly.
let announceTimer = null;
function announce(msg, delay = 900) {
  const el = $('a11yAnnounce');
  if (!el || !msg) return;
  if (announceTimer) clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    // Re-setting identical text doesn't re-announce in some readers; clear first.
    el.textContent = '';
    setTimeout(() => { el.textContent = msg; }, 30);
  }, delay);
}


let sbAutoMax = null;

// ===== PAY ESTIMATOR STATE =====
let payRetSystem = 'high3';
let selectedVARating = 0;
let hasDependents = false;

// ===== TSP STATE =====
let tspWithdrawalMethod = 'fixed';

// ===== SKILLBRIDGE AUTO-POPULATE =====
function updateSkillbridgeLimit() {
  const branch = $('branch').value;
  const rankVal = $('rank').value;
  const rg = getRankGrade(rankVal);
  const sbInput = $('sbDays');
  const policyNote = $('sbPolicyNote');
  const badge = $('sbBadge');
  const editFeedback = $('sbEditFeedback');
  const overMaxError = $('sbOverMaxError');

  sbInput.readOnly = false;
  sbInput.classList.remove('sb-readonly');
  editFeedback.classList.remove('show');
  editFeedback.innerHTML = '';
  overMaxError.classList.remove('show');
  overMaxError.innerHTML = '';

  if (!toggles.sb) {
    badge.style.display = 'none';
    sbAutoMax = null;
    policyNote.innerHTML = 'ℹ️ Select your branch and rank above to auto-populate your authorized SkillBridge days.';
    policyNote.className = 'sb-policy-note mt-1 text-sm text-navy-400';
    return;
  }

  if (!branch || !rg) {
    sbInput.value = 90;
    sbInput.max = 180;
    sbAutoMax = null;
    badge.style.display = 'none';
    policyNote.innerHTML = 'ℹ️ Select your branch and rank above to auto-populate your authorized SkillBridge days.';
    policyNote.className = 'sb-policy-note mt-1 text-sm text-navy-400';
    return;
  }

  const branchLimits = SKILLBRIDGE_LIMITS[branch] || {};
  const maxDays = branchLimits[rg];

  if (maxDays !== undefined) {
    sbInput.value = maxDays;
    sbInput.max = maxDays;
    sbAutoMax = maxDays;
    badge.textContent = '✦ Auto-calculated';
    badge.className = 'sb-badge sb-badge-auto';
    badge.style.display = 'inline-flex';
    policyNote.innerHTML = '✅ <strong>Auto-set to ' + maxDays + ' days</strong> — this is the authorized maximum for ' + rg + ' in the ' + branch + ' per current DoD SkillBridge policy. Your actual duration is subject to leadership approval and may be fewer days. You may edit this field.';
    policyNote.className = 'sb-policy-note mt-1 text-sm border rounded-lg px-3 py-2';
    policyNote.style.color = '#047857';
    policyNote.style.background = '#d1fae5';
    policyNote.style.borderColor = '#a7f3d0';
  } else if (branch === 'Coast Guard') {
    sbInput.value = 120;
    sbInput.max = 180;
    sbAutoMax = null;
    badge.textContent = '✎ Manual entry';
    badge.className = 'sb-badge sb-badge-manual';
    badge.style.display = 'inline-flex';
    policyNote.innerHTML = 'ℹ️ Coast Guard SkillBridge limits vary — please confirm with your command. Default set to 120 days. You may edit this field.';
    policyNote.className = 'sb-policy-note mt-1 text-sm border rounded-lg px-3 py-2';
    policyNote.style.color = '#1e40af';
    policyNote.style.background = '#dbeafe';
    policyNote.style.borderColor = '#93c5fd';
  } else if (rg === 'E-1') {
    sbInput.value = 0;
    sbAutoMax = 0;
    badge.textContent = '⚠ Not eligible';
    badge.className = 'sb-badge sb-badge-manual';
    badge.style.display = 'inline-flex';
    policyNote.innerHTML = '⚠️ E-1 members are generally not eligible for SkillBridge. Please verify eligibility with your command.';
    policyNote.className = 'sb-policy-note mt-1 text-sm border rounded-lg px-3 py-2';
    policyNote.style.color = '#b45309';
    policyNote.style.background = '#fef3c7';
    policyNote.style.borderColor = '#fcd34d';
  } else {
    sbAutoMax = null;
    const numPart = parseInt(rg.replace(/[^\d]/g, ''));
    if (numPart >= 6 && branch !== 'Marine Corps') {
      sbInput.value = 60;
      sbInput.max = 180;
    } else {
      sbInput.value = 90;
      sbInput.max = 180;
    }
    badge.textContent = '✎ Manual entry';
    badge.className = 'sb-badge sb-badge-manual';
    badge.style.display = 'inline-flex';
    policyNote.innerHTML = 'ℹ️ SkillBridge eligibility for ' + rg + ' in the ' + branch + ' — please confirm limits with your command. Field is editable.';
    policyNote.className = 'sb-policy-note mt-1 text-sm border rounded-lg px-3 py-2';
    policyNote.style.color = '#1e40af';
    policyNote.style.background = '#dbeafe';
    policyNote.style.borderColor = '#93c5fd';
  }
}

function updateSbEditFeedback() {
  const editFeedback = $('sbEditFeedback');
  const overMaxError = $('sbOverMaxError');
  const sbInput = $('sbDays');
  const enteredVal = parseInt(sbInput.value);

  editFeedback.classList.remove('show');
  editFeedback.innerHTML = '';
  overMaxError.classList.remove('show');
  overMaxError.innerHTML = '';

  if (!toggles.sb || sbAutoMax === null || sbAutoMax === 0 || isNaN(enteredVal)) return;

  const branch = $('branch').value;
  const rg = getRankGrade($('rank').value);

  if (enteredVal > sbAutoMax) {
    overMaxError.innerHTML = '⚠️ ' + enteredVal + ' days exceeds your authorized maximum of ' + sbAutoMax + ' days for ' + rg + ' in the ' + branch + '. Please enter ' + sbAutoMax + ' days or fewer.';
    overMaxError.classList.add('show');
    sbInput.classList.add('error');
  } else {
    sbInput.classList.remove('error');
    if (enteredVal < sbAutoMax) {
      const diff = sbAutoMax - enteredVal;
      editFeedback.innerHTML = 'ℹ️ You\'ve entered ' + enteredVal + ' days — ' + diff + ' days less than your authorized maximum of ' + sbAutoMax + ' days. This reflects your leadership-approved duration.';
      editFeedback.style.color = '#b45309';
      editFeedback.style.background = '#fef3c7';
      editFeedback.style.borderColor = '#fcd34d';
      editFeedback.className = 'sb-edit-feedback border rounded-lg px-3 py-2 text-sm show';
    }
  }
}


// ===== STATE =====
let state = {};
let rankCat = '';
let transType = '';
let lastMilestones = [];
let tspContribMode = 'fixed';
let toggles = { ptdy: true, sb: true, giBill: false, vaClaim: false, married: false, homeowner: false, clearance: false, federalJob: false, oconus: false };

// ===== TOGGLE LOGIC =====
function initToggle(id, key, label) {
  const el = $(id);
  el.setAttribute('role', 'switch');
  el.setAttribute('tabindex', '0');
  if (label) el.setAttribute('aria-label', label);
  el.setAttribute('aria-checked', String(!!toggles[key]));
  const fire = () => {
    toggles[key] = !toggles[key];
    el.classList.toggle('active', toggles[key]);
    el.setAttribute('aria-checked', String(toggles[key]));
    if (key === 'ptdy') $('ptdyFields').classList.toggle('hidden', !toggles[key]);
    if (key === 'sb') {
      $('sbFields').classList.toggle('hidden', !toggles[key]);
      if (toggles[key]) updateSkillbridgeLimit();
    }
  };
  el.addEventListener('click', fire);
  el.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fire(); } });
}

// ===== RADIO GROUP =====
// Implements the ARIA radio-group pattern's roving tabindex: only the checked option
// (or the first, if none is checked yet) is a Tab stop; Left/Right/Up/Down move
// between options the way a screen reader user expects from role="radio".
function initRadioGroup(containerId, cb, cardSelector = '.radio-card') {
  const container = $(containerId);
  container.setAttribute('role', 'radiogroup');
  // The validation error path calls .focus() on the CONTAINER (e.g. #rankCatGroup) to move
  // the user to the offending group. A plain <div> isn't focusable, so that was a silent
  // no-op and keyboard users were told a field needed attention with no way to get to it.
  if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
  const cards = $$(cardSelector, container);
  const syncTabIndex = () => {
    const checkedIdx = cards.findIndex(c => c.classList.contains('selected'));
    cards.forEach((c, i) => c.setAttribute('tabindex', i === (checkedIdx === -1 ? 0 : checkedIdx) ? '0' : '-1'));
  };
  const selectCard = card => {
    cards.forEach(c => { c.classList.remove('selected'); c.setAttribute('aria-checked', 'false'); });
    card.classList.add('selected');
    card.setAttribute('aria-checked', 'true');
    syncTabIndex();
    cb(card.dataset.value);
  };
  cards.forEach((card, i) => {
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', card.classList.contains('selected') ? 'true' : 'false');
    card.addEventListener('click', () => selectCard(card));
    card.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); selectCard(card); return; }
      let target = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') target = cards[(i + 1) % cards.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') target = cards[(i - 1 + cards.length) % cards.length];
      if (target) { e.preventDefault(); target.focus(); selectCard(target); }
    });
  });
  syncTabIndex();
}

// ===== RANK POPULATION =====
function populateRanks() {
  const sel = $('rank');
  const branch = $('branch').value;
  sel.innerHTML = '<option value="">Select rank…</option>';
  if (!rankCat || !branch) { updateSkillbridgeLimit(); return; }
  const warnNote = $('warrant-note');
  if (rankCat === 'W' && (branch === 'Air Force' || branch === 'Space Force')) {
    warnNote.classList.remove('hidden');
    updateSkillbridgeLimit();
    return;
  }
  warnNote.classList.add('hidden');
  let list;
  if (rankCat === 'O') {
    list = RANKS.O[branch] || RANKS.O['_all'];
  } else {
    list = (RANKS[rankCat] && RANKS[rankCat][branch]) || [];
  }
  list.forEach(r => {
    const o = document.createElement('option');
    o.value = r; o.textContent = r; sel.appendChild(o);
  });
  updateSkillbridgeLimit();
}

// ===== VALIDATION =====
function showErr(id, show) {
  const el = $(id);
  if (el) el.classList.toggle('show', show);
  // Mirror the visual error onto the associated control so AT announces invalid state.
  // ~= matches one token in a space-separated aria-describedby list (a control can
  // reference more than one error message, e.g. #yos references two distinct errors).
  const ctrl = $1('[aria-describedby~="' + id + '"]');
  if (ctrl) ctrl.setAttribute('aria-invalid', String(show));
}

function validate() {
  let ok = true;
  const fn = $('firstName').value.trim();
  if (!fn) { showErr('err-firstName', true); $('firstName').classList.add('error'); ok = false; } else { showErr('err-firstName', false); $('firstName').classList.remove('error'); }
  if (!$('branch').value) { showErr('err-branch', true); ok = false; } else { showErr('err-branch', false); }
  if (!rankCat) { showErr('err-rankCat', true); ok = false; } else { showErr('err-rankCat', false); }
  if (!$('rank').value) { showErr('err-rank', true); ok = false; } else { showErr('err-rank', false); }
  const yos = parseInt($('yos').value);
  const yosInRange = !!yos && yos >= 1 && yos <= 40;
  if (!yosInRange) { showErr('err-yos', true); $('yos').classList.add('error'); ok = false; } else { showErr('err-yos', false); $('yos').classList.remove('error'); }
  if (!transType) { showErr('err-transType', true); ok = false; } else { showErr('err-transType', false); }
  // A distinct message from the 1-40 range check above — "12" is a perfectly valid
  // answer to "years of service," it's just too few for Retirement specifically.
  const yosBelowRetirementFloor = yosInRange && transType === 'Retirement' && yos < 20;
  if (yosBelowRetirementFloor) { showErr('err-yos-retirement', true); $('yos').classList.add('error'); ok = false; } else { showErr('err-yos-retirement', false); }
  const sd = $('sepDate').value;
  let today = new Date(($('todayDate').value || todayLocalStr()) + 'T00:00:00');
  if (isNaN(today.getTime())) today = new Date();
  // A past date is almost certainly a typo when creating a brand-new plan, so keep
  // rejecting it there — but once a plan already exists, its date can legitimately
  // pass while the visitor is still editing other fields, and hard-blocking every
  // future save (this field is required, so there's no way to "leave it alone")
  // would permanently lock them out of their own plan. The results screen already
  // handles a past date gracefully ("Days Since Retirement"), so just allow it here.
  const isExistingPlan = !!(state && state.firstName && state.sepDate);
  const sepDateValid = !!sd && (isExistingPlan || new Date(sd + 'T00:00:00') > today);
  if (!sepDateValid) { showErr('err-sepDate', true); $('sepDate').classList.add('error'); ok = false; } else { showErr('err-sepDate', false); $('sepDate').classList.remove('error'); }
  // Date of Rank sanity: not in the future, not after separation.
  const dor = $('dateOfRank').value;
  if (dor) {
    const dorDate = new Date(dor + 'T00:00:00');
    if (dorDate > today || (sd && dorDate > new Date(sd + 'T00:00:00'))) {
      showErr('err-dateOfRank', true); $('dateOfRank').classList.add('error'); ok = false;
    } else { showErr('err-dateOfRank', false); $('dateOfRank').classList.remove('error'); }
  } else { showErr('err-dateOfRank', false); $('dateOfRank').classList.remove('error'); }
  if (toggles.sb && sbAutoMax !== null) {
    const sbVal = parseInt($('sbDays').value);
    if (!isNaN(sbVal) && sbVal > sbAutoMax) { ok = false; updateSbEditFeedback(); }
  }
  return ok;
}

// ===== BUILD STATE =====
// Starts from the CURRENT state rather than {} so fields the setup form doesn't own survive
// an Edit → Submit round trip. `tools` (every customized Decision-Tool input) and
// `payBasePay` (a flag officer's hand-entered pay, which cannot be auto-populated) are
// written directly onto `state` elsewhere; rebuilding from an empty object destroyed both
// on every edit and then pushed the defaults back to D1.
function buildState() {
  /** @type {any} */
  const s = state ? { ...state } : {};
  s.firstName = $('firstName').value.trim();
  s.branch = $('branch').value;
  s.rankCat = rankCat;
  s.rank = $('rank').value;
  s.yos = parseInt($('yos').value);
  s.dateOfRank = $('dateOfRank').value || '';
  s.transType = transType;
  s.sepDate = $('sepDate').value;
  s.todayDate = $('todayDate').value;
  s.leaveDays = clamp(numOr(parseInt($('leaveDays').value), 60), 0, 120);
  // Captured once here rather than re-typed into every tool that needs it.
  s.bah = clamp(numOr(parseFloat($('bah').value), 0), 0, 1e5);
  s.ptdy = toggles.ptdy;
  s.ptdyDays = toggles.ptdy ? clamp(parseInt($('ptdyDays').value) || 20, 1, 30) : 0;
  s.sb = toggles.sb;
  // Preserve a deliberate 0 (e.g. E-1 "not eligible"); only default to 90 on a blank/NaN field.
  const sbN = parseInt($('sbDays').value, 10);
  s.sbDays = toggles.sb ? clamp(Number.isFinite(sbN) ? sbN : 90, 0, 180) : 0;
  s.postLocation = $('postLocation').value.trim();
  s.careerInterest = $('careerInterest').value;
  s.giBill = toggles.giBill;
  s.vaClaim = toggles.vaClaim;
  s.married = toggles.married;
  s.homeowner = toggles.homeowner;
  s.clearance = toggles.clearance;
  s.federalJob = toggles.federalJob;
  s.oconus = toggles.oconus;
  s.payRetSystem = payRetSystem;
  s.selectedVARating = selectedVARating;
  s.hasDependents = hasDependents;
  // TSP state
  s.tspBalance = parseFloat($('tspBalance')?.value) || 0;
  // Left UNDEFINED (not 0) when blank, so the auto-populate in applyLoadedPlan can fill in
  // "years until your separation date". `parseFloat('') || 0` wrote a real 0, which numOr
  // then accepted as a deliberate answer — so every brand-new plan projected $0 of TSP
  // contributions and $0 of growth in the headline card until the user noticed the field.
  s.tspYearsToRet = numOr(parseFloat($('tspYearsToRet')?.value), undefined);
  s.tspRate = parseFloat($('tspRate')?.value) || 6;
  s.tspContribMode = tspContribMode;
  s.tspContribution = numOr(parseFloat($('tspContribution')?.value), 200);
  s.tspContribPct = parseFloat($('tspContribPct')?.value) || 5;
  // Clamped to the range isValidState accepts. Typing an out-of-range age (e.g. 30) used to
  // make every subsequent PUT fail validation with a permanent 400 and no explanation
  // beyond "Couldn't save".
  s.tspRetAge = clamp(numOr(parseInt($('tspRetAge')?.value), 45), 38, 70);
  s.tspWithdrawalMethod = tspWithdrawalMethod;
  s.tspFixedAmount = numOr(parseFloat($('tspFixedAmount')?.value), 500);
  return s;
}

// ===== SAVE / LOAD =====
// Persistence routes through store.js: a plan lives at /p/<id> in D1, cached in localStorage.
//
// `sampleMode` makes every write a no-op. Without it, browsing the demo plan would mirror it
// into localStorage under the same key as a real plan — overwriting a returning visitor's
// own plan AND the edit key that is their only way back to it.
let sampleMode = false;
function saveState(s) { if (sampleMode) return; store.savePlan(s); }

// Checklist state travels inside the plan (state.checks), persisted via saveState.
function loadChecks() { return (state && state.checks) || {}; }
function saveChecks(checks) { if (state) { state.checks = checks; saveState(state); } }

// Masks the secret key portion of an edit URL (everything from #k= on) so it isn't
// sitting in plain text by default — someone glancing at a shared screen, a recording,
// or a screenshot shouldn't be able to read the credential off it at a glance.
function maskEditUrl(url) {
  return url.replace(/(#k=)([^&]+)/, (_, prefix, key) => prefix + '•'.repeat(Math.min(key.length, 24)));
}

let planLinkVisible = false;

// Disable the controls a read-only viewer cannot use. Called after every render that can
// create checkboxes, since the checklist is rebuilt on each pass.
function applyReadOnlyControls() {
  const ro = store.isReadOnly();
  $$('#phaseList input[type="checkbox"]').forEach((cb) => {
    cb.disabled = ro;
    if (ro) cb.setAttribute('title', "You're viewing a shared plan — changes aren't saved.");
    else cb.removeAttribute('title');
  });
}

// Reflect the current plan's link/read-only state in the header + banners.
function renderPlanLink() {
  const banner = $('planLinkBanner');
  const ro = $('readOnlyBanner');
  const headerBtn = $('headerLinkBtn');
  const editUrl = store.getEditUrl();
  // Read-only viewers get a banner that follows them down the page and checklist boxes
  // that are actually disabled. Previously the warning sat at the top of a very long page
  // while every checkbox below stayed clickable and silently discarded the click.
  document.body.classList.toggle('readonly-plan', store.isReadOnly());
  ro.classList.toggle('is-sticky', store.isReadOnly());
  applyReadOnlyControls();
  if (store.isReadOnly()) {
    ro.classList.remove('hidden');
    banner.classList.add('hidden');
    headerBtn.classList.add('hidden');
  } else if (editUrl) {
    ro.classList.add('hidden');
    banner.classList.remove('hidden');
    $('planLinkInput').value = planLinkVisible ? editUrl : maskEditUrl(editUrl);
    headerBtn.classList.remove('hidden');
    headerBtn.classList.add('flex');
  } else {
    banner.classList.add('hidden');
    ro.classList.add('hidden');
    headerBtn.classList.add('hidden');
  }
  afterRender();
}

// Module-scoped so both the header Backup button and the first-save modal can call it —
// an offline copy of the plan is the only fallback if the link is ever lost.
function downloadBackup() {
  if (!state || !state.firstName) { showToast('Build your plan first'); return; }
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'transition-plan.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Backup downloaded');
}

// ----- Shared modal -----
// Returns the `value` of whichever action the user chose, or null if they dismissed it
// (Escape / backdrop). Callers MUST treat null as "no decision" rather than folding it into
// a destructive branch — the bug in the old confirm()-based conflict prompt was exactly that
// a falsy return silently meant "discard my edits".
function showModal({ title, bodyHtml, actions }) {
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

// The link IS the credential: no email, no password, no reset. Losing it loses the plan.
async function showFirstSaveModal() {
  const editUrl = store.getEditUrl() || '';
  const choice = await showModal({
    title: 'Your plan is saved — this link is the only way back',
    bodyHtml: `
      <p>There are no accounts here. This private link <strong>is</strong> your plan: bookmark it, or you will not be able to get back in. We cannot recover it for you.</p>
      <input id="firstSaveLinkInput" type="text" readonly class="input-field" value="${escapeHtml(editUrl)}" aria-label="Your private plan link" />
      <p class="text-xs text-navy-400">Anyone with this link can edit your plan. To show it to someone else, use the read-only link from the banner instead.</p>`,
    actions: [
      { value: 'copy', label: 'Copy my link', style: 'primary' },
      { value: 'download', label: 'Download a backup' },
      { value: 'ok', label: 'I saved it' },
    ],
  });
  if (choice === 'copy') {
    navigator.clipboard.writeText(editUrl)
      .then(() => showToast('Link copied — paste it somewhere safe'))
      .catch(() => showToast('Could not copy — select the link and copy it manually'));
    return showFirstSaveModal(); // keep the moment up until they acknowledge it
  }
  if (choice === 'download') {
    downloadBackup();
    return showFirstSaveModal();
  }
}

// ----- /p/<id> load feedback -----
// A fetch that takes a second on mobile used to look identical to "no plan here": the setup
// form just sat there empty. These give the load a visible state and, on failure, something
// persistent and actionable rather than a toast that vanishes in 2.5s.
function showPlanLoading(on) {
  const el = $('planLoadingState');
  if (!el) return;
  el.classList.toggle('hidden', !on);
  $('setup-form')?.classList.toggle('hidden', on);
  if (on) afterRender();
}

function showPlanLoadError({ title, body, tone = 'error', retry = false }) {
  const el = $('planLoadError');
  if (!el) return;
  const palette = tone === 'warn'
    ? { bg: '#fef3c7', border: '#fcd34d', fg: '#92400e', icon: 'alert-triangle' }
    : { bg: '#fee2e2', border: '#fca5a5', fg: '#991b1b', icon: 'cloud-off' };
  el.style.background = palette.bg;
  el.style.border = `1px solid ${palette.border}`;
  el.style.color = palette.fg;
  el.innerHTML = `
    <div class="flex items-start gap-3">
      <i data-lucide="${palette.icon}" class="w-5 h-5 mt-0.5 flex-shrink-0"></i>
      <div class="flex-1">
        <p class="text-sm font-semibold">${escapeHtml(title)}</p>
        <p class="text-xs mt-1 leading-relaxed">${escapeHtml(body)}</p>
        ${retry ? '<button type="button" id="planLoadRetryBtn" class="mt-3 text-sm font-semibold px-3 py-1.5 rounded-lg surface-scrim">Try again</button>' : ''}
      </div>
    </div>`;
  el.classList.remove('hidden');
  const btn = $('planLoadRetryBtn');
  if (btn) btn.addEventListener('click', () => location.reload());
  afterRender();
}

// ===== SHOW RESULTS =====
function showResults() {
  $('setup-screen').classList.add('hidden');
  $('results-screen').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
  renderResults();
  // Move focus (and the document title) to the new screen so a screen-reader user
  // hears that the form was replaced, instead of focus silently landing on <body>
  // when #submitBtn disappears underneath it.
  const title = $('resultTitle');
  if (title) { title.focus(); document.title = `${title.textContent} — Military Transition Calculator`; }
}

function showSetup() {
  $('results-screen').classList.add('hidden');
  $('setup-screen').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
  document.title = 'Military Transition & Retirement Calculator';
  const heading = $('setupTitle');
  if (heading) heading.focus();
}

// ===== RENDER =====
// Horizontal timeline: proportional markers from today → freedom day. Status
// colors come from the same milestoneStatus() the card grid uses.
function renderTimeline(milestones, today, sep) {
  const track = $('timelineTrack');
  if (!track || !milestones.length) return;
  // A full plan (retirement + VA claim + married + clearance, etc.) can produce 20+
  // milestones. A fixed 640px track packs most of them into the "today -> separation"
  // fraction of the axis (everything after separation — HHG/SBP/final-move deadlines
  // spanning up to 3 years out — stretches the axis while contributing few markers),
  // so give the track more room per marker instead of letting them pile on top of
  // each other; .timeline-scroll already scrolls horizontally.
  track.style.minWidth = Math.max(640, milestones.length * 90) + 'px';
  const times = milestones.map(m => m.date.getTime());
  const axisStart = Math.min(today.getTime(), ...times);
  const axisEnd = Math.max(sep.getTime(), ...times);
  const span = Math.max(1, axisEnd - axisStart);
  const todayPct = clamp(((today.getTime() - axisStart) / span) * 100, 0, 100);
  let html = '<div class="timeline-axis"></div><div class="timeline-fill" data-css-width="' + todayPct + '%"></div>';
  milestones.forEach((m, i) => {
    const pct = clamp(((m.date.getTime() - axisStart) / span) * 100, 0, 100);
    const st = milestoneStatus(daysBetween(today, m.date));
    const dotClass = st === 'past' ? 'status-red' : (st === 'future' ? 'status-green' : 'status-gold');
    const statusText = st === 'past' ? 'Past' : (st === 'today' ? 'Today' : (st === 'soon' ? 'Due soon' : 'Upcoming'));
    const pos = (i % 2 === 0) ? 'tl-above' : 'tl-below';
    const safeLabel = escapeHtml(m.label);
    html += '<div class="tl-marker" data-css-left="' + pct + '%">'
      // No aria-label here: the whole track is aria-hidden (the milestone grid above is the
      // accessible representation), so labelling the dots only produced a second reading.
      + '<span class="tl-dot ' + dotClass + '"></span>'
      + '<div class="tl-box ' + pos + '"><div class="tl-label">' + safeLabel + '</div><div class="tl-date">' + fmtDateShort(m.date) + '</div><div class="tl-status">' + statusText + '</div></div>'
      + '</div>';
  });
  track.innerHTML = html;
}

// ===== SCENARIO COMPARISON =====
// Everything the panel needs is derived from the plan plus one alternative date, so nothing
// is persisted — this is a what-if, and saving it would make the plan ambiguous.
function scenarioDefaultYos(altSep) {
  const s = state;
  if (!s) return 0;
  const base = new Date(s.sepDate + 'T00:00:00');
  const yearsShifted = daysBetween(base, altSep) / 365.25;
  // Whole years only: you don't cross a longevity step part-way.
  return clamp(Math.round((Number(s.yos) || 0) + yearsShifted), 1, 40);
}

function renderScenario() {
  const box = $('scenarioResult');
  if (!box || !state) return;
  const raw = $('scenarioDate').value;
  if (!raw) {
    box.innerHTML = '<p class="text-navy-400">Pick a date above to compare it against your current plan.</p>';
    return;
  }
  const altSep = new Date(raw + 'T00:00:00');
  if (isNaN(altSep.getTime())) { box.innerHTML = '<p class="text-navy-400">That date could not be read.</p>'; return; }

  const yosField = $('scenarioYos');
  const altYos = clamp(numOr(parseInt(yosField.value, 10), scenarioDefaultYos(altSep)), 1, 40);
  const today = new Date(state.todayDate + 'T00:00:00');
  const planB = { ...state, sepDate: raw, yos: altYos };
  const cmp = compareScenarios(state, planB, today, { monthlyAllowances: (state.bah || 0) + getBAS(state.rankCat) });
  if (!cmp) { box.innerHTML = '<p class="text-navy-400">That date could not be compared.</p>'; return; }

  const { a, b, deltas } = cmp;
  const later = deltas.days > 0;
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
  const abs = Math.abs;
  const row = (label, av, bv, delta) => `
    <tr class="border-t rule-soft">
      <th scope="row" class="py-2 pr-3 text-left font-medium text-navy-600">${escapeHtml(label)}</th>
      <td class="py-2 px-3 text-right tabular-nums text-navy-700">${av}</td>
      <td class="py-2 px-3 text-right tabular-nums text-navy-700">${bv}</td>
      <td class="py-2 pl-3 text-right tabular-nums font-semibold">${delta}</td>
    </tr>`;
  const money = (n) => `${sign(n)}${fmtCurrencyWhole(abs(n))}`;
  const tone = (n) => (n > 0 ? 't-success' : n < 0 ? 't-danger' : 'text-navy-400');

  box.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="sr-only">Your current plan compared with an alternative separation date</caption>
        <thead>
          <tr class="text-xs uppercase tracking-wide text-navy-400">
            <th scope="col" class="text-left py-2 pr-3">&nbsp;</th>
            <th scope="col" class="text-right py-2 px-3">Current plan</th>
            <th scope="col" class="text-right py-2 px-3">Alternative</th>
            <th scope="col" class="text-right py-2 pl-3">Difference</th>
          </tr>
        </thead>
        <tbody>
          ${row('Separation date', fmtDate(a.sepDate), fmtDate(b.sepDate),
              `<span class="text-navy-500">${sign(deltas.days)}${abs(deltas.days)} days</span>`)}
          ${row('Years of service', a.yos, b.yos, `<span class="${tone(deltas.yos)}">${sign(deltas.yos)}${abs(deltas.yos)}</span>`)}
          ${a.isRetirement ? row('Multiplier', a.multiplierPct + '%', b.multiplierPct + '%',
              `<span class="${tone(deltas.multiplierPct)}">${sign(deltas.multiplierPct)}${abs(deltas.multiplierPct)}%</span>`) : ''}
          ${a.isRetirement ? row('High-3 average', fmtCurrencyWhole(a.high3Monthly) + '/mo', fmtCurrencyWhole(b.high3Monthly) + '/mo',
              `<span class="${tone(deltas.high3Monthly)}">${money(deltas.high3Monthly)}</span>`) : ''}
          ${a.isRetirement ? row('Retired pay', fmtCurrencyWhole(a.retiredPayMonthly) + '/mo', fmtCurrencyWhole(b.retiredPayMonthly) + '/mo',
              `<span class="${tone(deltas.retiredPayMonthly)}">${money(deltas.retiredPayMonthly)}/mo</span>`) : ''}
          ${row('Terminal leave starts', fmtDate(a.terminalLeaveStart), fmtDate(b.terminalLeaveStart), '')}
          ${a.skillbridgeStart ? row('SkillBridge starts', fmtDate(a.skillbridgeStart), fmtDate(b.skillbridgeStart), '') : ''}
          ${a.firstRetirementPay && b.firstRetirementPay ? row('First retirement pay', fmtDate(a.firstRetirementPay), fmtDate(b.firstRetirementPay), '') : ''}
        </tbody>
      </table>
    </div>
    ${a.isRetirement && deltas.retiredPayMonthly !== 0 ? `
      <div class="mt-4 pt-4 border-t rule">
        <p class="text-sm text-navy-700 font-semibold mb-2">What ${later ? 'staying longer' : 'leaving earlier'} is worth</p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="rounded-xl p-3 surface-muted">
            <p class="text-xs text-navy-400">Retired pay, per year</p>
            <p class="text-lg font-bold tabular-nums ${tone(deltas.retiredPayAnnual)}">${money(deltas.retiredPayAnnual)}</p>
          </div>
          <div class="rounded-xl p-3 surface-muted">
            <p class="text-xs text-navy-400">Over 20 years of retirement</p>
            <p class="text-lg font-bold tabular-nums ${tone(deltas.retiredPayOver20Years)}">${money(deltas.retiredPayOver20Years)}</p>
          </div>
          <div class="rounded-xl p-3 surface-muted">
            <p class="text-xs text-navy-400">Active-duty pay ${later ? 'earned meanwhile' : 'given up'}</p>
            <p class="text-lg font-bold tabular-nums text-navy-700">${money(deltas.activeDutyBaseDelta)}</p>
            <p class="text-xs text-navy-400">plus ${money(deltas.activeDutyAllowanceDelta)} tax-free BAH/BAS</p>
          </div>
        </div>
        <p class="text-xs text-navy-400 mt-3 leading-relaxed">
          Retired pay is for life, so even a small monthly change outweighs a one-off difference in active-duty pay given enough years — that's why the 20-year column is here. It is an <em>illustration</em>, not a present-value calculation: no COLA, no discounting, no tax. It also can't price the things that usually decide this — a job offer with a start date, a school year, a spouse's career, your own readiness to go.
          ${a.high3Estimated || b.high3Estimated ? ' Both High-3 figures are estimated from the pay tables this app holds; a year outside them is approximated.' : ''}
        </p>
      </div>` : (a.isRetirement ? '<p class="text-xs text-navy-400 mt-3">This date doesn\'t change your years of service, so your retired pay is the same either way — the difference is purely schedule.</p>' : '')}
  `;
  afterRender(box);
}

// ===== 180-DAY METER =====
// There is no single DoD rule capping "SkillBridge + PTDY + terminal leave" combined
// at 180 days. The real constraints are separate: SkillBridge itself is capped at 180
// days AND may not start earlier than 180 days before separation (DoDI 1322.29); PTDY
// is a much smaller, separately-limited benefit; terminal leave is bounded by accrued
// leave, not by SkillBridge's policy. Because this app chains SkillBridge -> PTDY ->
// terminal leave immediately back-to-back into separation, the combined total IS a
// faithful proxy for "how many days before separation does SkillBridge start" — but
// only when SkillBridge is actually in use. With SkillBridge off, nothing here is
// capped at 180, so the meter shouldn't imply a limit that doesn't apply.
function renderDayMeter(segments, totalDays, sbActive) {
  const container = $('dayMeter');
  const fill = $('dayMeterFill');
  const msg = $('dayMeterMessage');
  const msgText = $('dayMeterMessageText');
  const msgIcon = $('dayMeterMessageIcon');
  const label = $('dayMeterLabel');

  $('dayMeterCurrent').textContent = totalDays;
  $('dayMeterBreakdown').innerHTML = segments.map(seg => `
    <div class="day-meter-item">
      <div class="day-meter-item-label">${escapeHtml(seg.label)}</div>
      <div class="day-meter-item-value">${seg.days}</div>
      <div class="day-meter-item-color" data-css-bg="${seg.color}"></div>
    </div>`).join('');

  // Classification (which threshold band, the message copy) lives in calc.js
  // (classifyDayMeter) so its 0/150/180 boundaries are unit-tested; this function
  // just applies the resulting classification to the DOM.
  const cls = classifyDayMeter(totalDays, sbActive);
  fill.style.width = cls.pct + '%';

  container.classList.remove('warning', 'danger');
  fill.classList.remove('warning', 'danger');
  msg.classList.remove('success', 'warning', 'danger');
  if (label) label.textContent = sbActive ? 'SkillBridge Start Window (180-Day Max)' : 'Pre-Transition Period';

  if (cls.level === 'danger' || cls.level === 'warning') {
    container.classList.add(cls.level);
    fill.classList.add(cls.level);
  }
  msg.classList.add(cls.level === 'none' ? 'success' : cls.level);
  msgIcon.setAttribute('data-lucide', cls.icon);
  msgText.innerHTML = `<strong>${escapeHtml(cls.title)}:</strong> ${escapeHtml(cls.detail)}`;
  msg.style.display = 'flex';
  afterRender();
}

// Presentation for each milestoneStatus() level, in one place so the card grid and the
// horizontal timeline cannot drift apart. `sr` is the screen-reader equivalent of the
// colored dot — WCAG 1.4.1, since colour alone carried the urgency before.
const MILESTONE_STATUS_STYLE = {
  past:   { statusClass: 'status-red',   color: '#ef4444', sr: 'overdue' },
  today:  { statusClass: 'status-gold',  color: '#f59e0b', sr: 'due today' },
  soon:   { statusClass: 'status-gold',  color: '#f59e0b', sr: 'due soon' },
  future: { statusClass: 'status-green', color: '#10b981', sr: 'on track' },
};

// Advisories are dated GUIDANCE, not deadlines, and are rendered deliberately outside the
// milestone grid so they are never painted red/overdue. See computeMilestones().
function renderAdvisories(advisories, today) {
  const wrap = $('advisoryPanel');
  if (!wrap) return;
  const list = advisories || [];
  wrap.classList.toggle('hidden', list.length === 0);
  if (!list.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <h2 class="text-lg font-semibold text-navy-700 mb-3 flex items-center gap-2"><i data-lucide="lightbulb" class="w-5 h-5 text-gold-500"></i> Get a head start</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    ${list.map(a => {
      const diff = daysBetween(today, a.date);
      const when = diff > 0 ? `Ideally by ${fmtDate(a.date)} (in ${diff} days)` : `Recommended from ${fmtDate(a.date)} — start now`;
      return `<div class="section-card note-plain">
        <p class="text-sm font-semibold text-navy-700 flex items-center gap-2"><i data-lucide="${a.icon}" class="w-4 h-4 text-gold-500"></i> ${escapeHtml(a.label)}</p>
        <p class="text-xs text-navy-400 mt-1">${escapeHtml(when)}</p>
        <p class="text-xs text-navy-500 leading-relaxed mt-2">${escapeHtml(a.detail)}</p>
      </div>`;
    }).join('')}
    </div>`;
}

// ===== TIMELINE CALENDAR (single month, paginated) =====
let calCtx = null; // { today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart, rangeStart, rangeEnd }
let calView = null; // { year, month } of the month currently on screen

function renderTimelineCalendar(today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart) {
  let rangeStart = new Date(s.sb ? (sbStart < today ? sbStart : today) : today);
  rangeStart.setDate(1);
  // firstOfNextMonth, not setMonth(+1). setMonth overflows on a month-end separation
  // (Jan 31 + 1 month = Mar 3), which appended a phantom empty month to the calendar view
  // and to the printed plan.
  const rangeEnd = firstOfNextMonth(sep);

  calCtx = { today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart, rangeStart, rangeEnd };

  // Keep the visitor's current page across live edits (e.g. adjusting leave days)
  // as long as it's still in range; otherwise default back to today's month.
  const viewDate = calView ? new Date(calView.year, calView.month, 1) : null;
  const inRange = viewDate && viewDate >= rangeStart && viewDate <= rangeEnd;
  if (!inRange) calView = { year: rangeStart.getFullYear(), month: rangeStart.getMonth() };

  renderCalendarPage();
}

function renderCalendarPage() {
  const container = $('calendarMonthsContainer');
  if (!container || !calCtx || !calView) return;
  const { today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart, rangeStart, rangeEnd } = calCtx;

  container.innerHTML = renderCalMonth(calView.year, calView.month, today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart);

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const label = $('calMonthLabel');
  if (label) label.textContent = `${monthNames[calView.month]} ${calView.year}`;

  const viewDate = new Date(calView.year, calView.month, 1);
  const prevBtn = $('calPrevBtn'), nextBtn = $('calNextBtn');
  if (prevBtn) prevBtn.disabled = viewDate <= rangeStart;
  if (nextBtn) nextBtn.disabled = viewDate >= rangeEnd;

  afterRender();
}

function calNavigate(delta) {
  if (!calView) return;
  const d = new Date(calView.year, calView.month + delta, 1);
  calView = { year: d.getFullYear(), month: d.getMonth() };
  renderCalendarPage();
}

function calJumpToToday() {
  if (!calCtx) return;
  const { today, rangeStart, rangeEnd } = calCtx;
  let d = new Date(today.getFullYear(), today.getMonth(), 1);
  if (d < rangeStart) d = new Date(rangeStart);
  if (d > rangeEnd) d = new Date(rangeEnd);
  calView = { year: d.getFullYear(), month: d.getMonth() };
  renderCalendarPage();
}

// Printing needs every month in range, not just the one page currently on screen —
// call this before window.print() and call renderCalendarPage() again afterward to
// restore the single-month view (see the printBtn handler).
function printAllCalendarMonths() {
  const container = $('calendarMonthsContainer');
  if (!container || !calCtx) return;
  const { today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart, rangeStart, rangeEnd } = calCtx;
  let html = '';
  let current = new Date(rangeStart);
  let guard = 0;
  while (current <= rangeEnd && guard < 36) {
    html += renderCalMonth(current.getFullYear(), current.getMonth(), today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart);
    current.setMonth(current.getMonth() + 1);
    guard++;
  }
  container.innerHTML = html;
  afterRender();
}

function renderCalMonth(year, month, today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart) {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const start = new Date(firstDay);
  start.setDate(start.getDate() - firstDay.getDay());

  // A real <table> with a <caption> and scoped column headers. This was a bare grid of
  // <div>s: a screen reader got a flat run of numbers with no row/column relationship and
  // no month context, and the "SB"/"PTDY" chips were unexpanded abbreviations found
  // nowhere in the DOM. Each chip now carries an sr-only expansion.
  const spanLabel = s.transType === 'Retirement' ? 'Retirement date' : 'Separation date';
  // The heading lives OUTSIDE the table so it survives the narrow-viewport rule that hides
  // the grid; the table's own caption is sr-only to avoid announcing the month twice.
  let html = `<div class="cal-month-card">`
    + `<h3 class="text-base font-bold text-navy-700 mb-3">${monthNames[month]} ${year}</h3>`
    + `<table class="cal-grid-table"><caption class="sr-only">${monthNames[month]} ${year} — transition calendar</caption>`
    + '<thead><tr>'
    + dow.map(d => `<th scope="col" class="cal-dow"><abbr title="${d}day">${d}</abbr></th>`).join('')
    + '</tr></thead><tbody><tr>';

  let current = new Date(start);
  let col = 0;
  while (current <= lastDay || current.getDay() !== 0) {
    if (col === 7) { html += '</tr><tr>'; col = 0; }
    const isOther = current.getMonth() !== month;
    const isToday = daysBetween(today, current) === 0;
    let events = '';

    if (!isOther) {
      const chip = (bg, short, long) =>
        `<span class="cal-event" data-css-bg="${bg}">${short}<span class="sr-only"> — ${long}</span></span>`;
      if (s.sb && daysBetween(sbStart, current) >= 0 && daysBetween(current, sbEnd) >= 0) events += chip('#3468b0', 'SB', 'SkillBridge');
      if (s.ptdy && daysBetween(ptdyStart, current) >= 0 && daysBetween(current, ptdyEnd) >= 0) events += chip('#836616', 'PTDY', 'Permissive TDY');
      if (daysBetween(termStart, current) >= 0 && daysBetween(current, sep) >= 0) events += chip('#2d6a4f', 'Leave', 'Terminal leave');
      if (daysBetween(sep, current) === 0) events += chip('#b91c1c', escapeHtml(s.transType === 'Retirement' ? 'RET' : 'SEP'), escapeHtml(spanLabel));
    }

    html += `<td class="cal-day${isOther ? ' other-month' : ''}${isToday ? ' is-today' : ''}"${isOther ? ' aria-hidden="true"' : ''}>`
      + `<span class="cal-day-num">${current.getDate()}</span>${isToday ? '<span class="sr-only"> (today)</span>' : ''}${events}</td>`;
    current.setDate(current.getDate() + 1);
    col++;
  }
  while (col < 7 && col > 0) { html += '<td class="cal-day other-month" aria-hidden="true"></td>'; col++; }

  html += '</tr></tbody></table>';
  // Below ~400px the 7-column grid renders day text at ~7px, which is not usable. Give
  // narrow viewports a plain-language summary of the same spans instead of a wall of dots.
  html += `<p class="cal-narrow-summary text-xs text-navy-500 leading-relaxed mt-2">${escapeHtml(calMonthSummary(year, month, today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart))}</p>`;
  html += '</div>';
  return html;
}

// Plain-language description of what happens in a given month. Used as the narrow-viewport
// fallback and as the calendar's accessible summary.
function calMonthSummary(year, month, today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const overlaps = (a, b) => a <= last && b >= first;
  const fmtRange = (a, b) => {
    const from = a < first ? first : a;
    const to = b > last ? last : b;
    return from.getDate() === to.getDate() ? `${fmtDateShort(from)}` : `${fmtDateShort(from)}–${fmtDateShort(to)}`;
  };
  const parts = [];
  if (s.sb && overlaps(sbStart, sbEnd)) parts.push(`SkillBridge ${fmtRange(sbStart, sbEnd)}`);
  if (s.ptdy && overlaps(ptdyStart, ptdyEnd)) parts.push(`Permissive TDY ${fmtRange(ptdyStart, ptdyEnd)}`);
  if (overlaps(termStart, sep)) parts.push(`Terminal leave ${fmtRange(termStart, sep)}`);
  if (sep >= first && sep <= last) parts.push(`${s.transType} date ${fmtDateShort(sep)}`);
  return parts.length ? parts.join(' · ') : 'Nothing scheduled this month.';
}

function renderResults() {
  const s = state;
  const bm = BRANCH_META[s.branch] || { color:'#1a2744', emoji:'🎖️', terms:{ spec:'Specialty', member:'Member', nco:'NCO' } };
  const today = new Date(s.todayDate + 'T00:00:00');
  const sep = new Date(s.sepDate + 'T00:00:00');
  const isRet = s.transType === 'Retirement';

  $('resultTitle').textContent = `${s.firstName}'s Transition Plan`;
  $('branchBadge').textContent = `${bm.emoji} ${s.branch}`;
  $('branchBadge').style.background = bm.color;
  $('rankBadge').textContent = `${s.rank} · ${s.yos} years`;
  $('rankBadge').classList.remove('hidden');

  const daysLeft = daysBetween(today, sep);
  const past = daysLeft < 0; // a saved/shared plan can have a sepDate that has since passed
  $('countdownNumber').textContent = past ? Math.abs(daysLeft) : daysLeft;
  $('countdownLabel').textContent = past ? `Days Since ${s.transType}` : `Days Until ${s.transType}`;
  $('countdownSub').textContent = `${fmtDate(sep)} · ${s.transType}`;

  const twoYearStart = subDays(sep, 730);
  let pct = 0;
  if (today >= twoYearStart) pct = clamp(Math.round((daysBetween(twoYearStart, today) / 730) * 100), 0, 100);
  $('progressPct').textContent = past ? '2-Year Window Closed'
    : (today < twoYearStart ? `2-Year Window Opens: ${fmtDateShort(twoYearStart)}` : `${pct}% through 2-year window`);
  setTimeout(() => { $('progressBar').style.width = pct + '%'; }, 200);

  // The full deadline engine lives in calc.js (computeMilestones) so it's covered by
  // unit tests instead of only ever being exercised by clicking through the UI.
  const { milestones, advisories, termStart, ptdyStart, ptdyEnd, sbStart, sbEnd, tapDeadline, firstRetPay } = computeMilestones(s, today, sep);

  // Relative-day label that reads sanely when the date is today or already past
  // (a near-term sepDate pushes SkillBridge/terminal-leave starts before "today").
  const relDays = (d) => { const n = daysBetween(today, d); return n < 0 ? `Started ${Math.abs(n)} days ago` : (n === 0 ? 'Today' : `${n} days`); };
  const subs = [];
  if (s.sb) subs.push({ label: 'SkillBridge Starts', val: relDays(sbStart), icon: 'briefcase' });
  subs.push({ label: 'Terminal Leave', val: relDays(termStart), icon: 'plane' });
  subs.push({ label: 'Freedom Day', val: fmtDateShort(sep), icon: 'flag' });

  $('subCounters').innerHTML = subs.map(c => `
    <div class="bg-white/10 rounded-xl px-4 py-3 text-center">
      <p class="text-xs text-white/50 uppercase tracking-wide mb-1">${c.label}</p>
      <p class="text-lg font-bold tabular-nums t-gold-light">${c.val}</p>
    </div>
  `).join('');

  $('milestoneGrid').innerHTML = milestones.map((m, i) => {
    const diff = daysBetween(today, m.date);
    // milestoneStatus() in calc.js is the single source of truth for this ladder, shared
    // with the horizontal timeline. The grid used to reimplement it inline, so tuning a
    // threshold in one place silently desynchronized the cards from the timeline.
    const { statusClass, color } = MILESTONE_STATUS_STYLE[milestoneStatus(diff)];
    const relText = diff === 0 ? 'Today' : (diff > 0 ? `In ${diff} days` : `${Math.abs(diff)} days ago`);
    return `
      <div class="milestone-card fade-in-up stagger-${Math.min(i+1,12)}">
        <div class="flex items-center gap-2">
          <div class="status-dot ${statusClass}"></div>
          <span class="text-xs font-medium text-navy-400 uppercase tracking-wide">${escapeHtml(m.label)}</span>
        </div>
        <p class="text-base font-semibold text-navy-700 flex items-center gap-2"><i data-lucide="${m.icon}" class="w-4 h-4 text-gold-500"></i> ${fmtDate(m.date)}</p>
        <p class="text-xs tabular-nums" data-css-color="${color}">${relText}<span class="sr-only">, ${MILESTONE_STATUS_STYLE[milestoneStatus(diff)].sr}</span></p>
        ${m.description ? `<p class="text-xs text-navy-500 leading-relaxed mt-1">${escapeHtml(m.description)}</p>` : ''}
      </div>`;
  }).join('');

  renderAdvisories(advisories, today);

  lastMilestones = milestones;
  renderTimeline(milestones, today, sep);

  const totalPre = s.sbDays + s.ptdyDays + s.leaveDays;
  const parts = [];
  if (s.sb) parts.push(`${s.sbDays} days SkillBridge`);
  if (s.ptdy) parts.push(`${s.ptdyDays} days Permissive TDY`);
  parts.push(`${s.leaveDays} days Terminal Leave`);
  $('preSummaryText').textContent = parts.join(' + ') + ` = ${totalPre} days total pre-transition period`;

  const sbAuthLine = $('sbAuthLine');
  if (s.sb) {
    const rg = getRankGrade(s.rank);
    const authMax = getSkillbridgeAuthorizedMax(s.branch, rg);
    if (authMax !== null) {
      const matchesMax = s.sbDays === authMax;
      const iconName = matchesMax ? 'check-circle' : 'info';
      const iconColor = matchesMax ? '#10b981' : '#f59e0b';
      const textColor = matchesMax ? '#047857' : '#b45309';
      const bgColor = matchesMax ? '#d1fae5' : '#fef3c7';
      sbAuthLine.innerHTML = `<div class="flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-2" data-css-bg="${bgColor}" data-css-color="${textColor}"><i data-lucide="${iconName}" class="w-4 h-4" data-css-color="${iconColor}"></i> SkillBridge authorized maximum: <strong>${authMax} days</strong> (${escapeHtml(rg)}, ${escapeHtml(s.branch)})${!matchesMax ? ' — you selected ' + s.sbDays + ' days' : ''}</div>`;
      sbAuthLine.classList.remove('hidden');
    } else if (s.branch === 'Coast Guard') {
      sbAuthLine.innerHTML = '<div class="flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-2 chip-info"><i data-lucide="info" class="w-4 h-4 t-info"></i> Coast Guard SkillBridge limit: confirm with your command (using ' + s.sbDays + ' days)</div>';
      sbAuthLine.classList.remove('hidden');
    } else {
      sbAuthLine.innerHTML = '<div class="flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-2 chip-info"><i data-lucide="info" class="w-4 h-4 t-info"></i> SkillBridge days for ' + escapeHtml(getRankGrade(s.rank)) + ' in the ' + escapeHtml(s.branch) + ': confirm with your command (using ' + s.sbDays + ' days)</div>';
      sbAuthLine.classList.remove('hidden');
    }
  } else {
    sbAuthLine.classList.add('hidden');
    sbAuthLine.innerHTML = '';
  }

  const segments = [];
  if (s.sb) segments.push({ days: s.sbDays, color: '#3468b0', label: 'SkillBridge' });
  if (s.ptdy) segments.push({ days: s.ptdyDays, color: '#836616', label: 'PTDY' });
  segments.push({ days: s.leaveDays, color: '#2d6a4f', label: 'Terminal Leave' });

  if (totalPre === 0) {
    $('preBar').innerHTML = '<div class="chip-neutral w-full" class="flex items-center justify-center text-xs font-medium py-1">No pre-transition leave planned</div>';
  } else {
    $('preBar').innerHTML = segments.map(seg => {
      const w = Math.max((seg.days / totalPre) * 100, 2);
      return `<div data-css-width="${w}%" data-css-bg="${seg.color}" class="flex items-center justify-center text-white text-xs font-medium">${seg.days}d</div>`;
    }).join('');
  }

  $('preBarLegend').innerHTML = segments.map(seg =>
    `<span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm inline-block" data-css-bg="${seg.color}"></span>${seg.label}</span>`
  ).join('');

  renderDayMeter(segments, totalPre, s.sb);
  renderTimelineCalendar(today, sep, s, sbStart, sbEnd, ptdyStart, ptdyEnd, termStart);

  renderPayEstimator(isRet);
  renderDecisionTools(isRet);
  renderPhases(today, sep, termStart, ptdyStart, ptdyEnd, sbStart, sbEnd, tapDeadline, isRet);
  // Re-run any open comparison against the edited plan, so it can't silently go stale
  // against dates the user just changed.
  renderScenario();
  renderThinkAbout();
  renderResources();

  afterRender();
}

// ===== PAY ESTIMATOR RENDERING =====
// persist=false on the initial display render so we don't write back data we just loaded;
// user-driven recalcs (input handlers) call recalcPayEstimator() directly and do persist.
function renderPayEstimator(isRet, persist = false) {
  const s = state;
  const rg = getRankGrade(s.rank);

  if (!isRet) {
    $('paySepNotice').classList.remove('hidden');
    $('payRetirementBlock').style.display = 'none';
    $('crdpNotice').style.display = 'none';
  } else {
    $('paySepNotice').classList.add('hidden');
    $('payRetirementBlock').style.display = '';
    $('crdpNotice').style.display = '';
  }

  // DOR: calculate time in grade (guard a malformed dateOfRank → Invalid Date → NaN)
  const dorDate0 = s.dateOfRank ? new Date(s.dateOfRank + 'T00:00:00') : null;
  if (dorDate0 && !isNaN(dorDate0.getTime())) {
    const dorDate = dorDate0;
    const today = new Date(s.todayDate + 'T00:00:00');
    const sep = new Date(s.sepDate + 'T00:00:00');
    const tigDays = daysBetween(dorDate, sep);
    const tigYears = (tigDays / 365.25).toFixed(1);
    const tigAtToday = Math.max(0, daysBetween(dorDate, today));
    const tigYearsToday = (tigAtToday / 365.25).toFixed(1);
    const dorBox = $('dorResultBox');
    if (dorBox) {
      dorBox.classList.remove('hidden');
      $('dorYearsDisplay').textContent = `${tigYearsToday} years at current grade (${rg})`;
      $('dorPayHint').textContent = `Time in grade at retirement: ${tigYears} years. DOR is used for pay table accuracy — your base pay is auto-set from 2026 DFAS tables.`;
    }
    // Use DOR to refine pay table lookup: time in grade as additional YOS context
    const basePay2026 = getBasePay2026(rg, s.yos);
    if (basePay2026 !== null) {
      $('payBasePay').value = basePay2026.toFixed(2);
      $('payBasePayHint').textContent = `2026 DFAS table: ${rg} at ${s.yos} YOS = ${fmtCurrency(basePay2026)}/mo · DOR: ${fmtDate(dorDate)} (${tigYearsToday} yrs in grade)`;
    } else {
      // No table value (e.g. flag officers O-8..O-10) — restore the user's saved manual entry.
      $('payBasePay').value = s.payBasePay ? Number(s.payBasePay).toFixed(2) : '';
      $('payBasePayHint').textContent = FLAG_OFFICER_GRADES.includes(rg)
        ? `General/flag officer pay (${rg}) is capped at the Executive Schedule limit — enter your exact monthly base pay from your LES.`
        : 'Could not auto-populate — enter your monthly base pay from your LES.';
    }
  } else {
    const dorBox = $('dorResultBox');
    if (dorBox) dorBox.classList.add('hidden');
    const basePay2026 = getBasePay2026(rg, s.yos);
    if (basePay2026 !== null) {
      $('payBasePay').value = basePay2026.toFixed(2);
      $('payBasePayHint').textContent = `2026 DFAS table: ${rg} at ${s.yos} YOS = ${fmtCurrency(basePay2026)}/mo`;
    } else {
      // No table value (e.g. flag officers O-8..O-10) — restore the user's saved manual entry.
      $('payBasePay').value = s.payBasePay ? Number(s.payBasePay).toFixed(2) : '';
      $('payBasePayHint').textContent = FLAG_OFFICER_GRADES.includes(rg)
        ? `General/flag officer pay (${rg}) is capped at the Executive Schedule limit — enter your exact monthly base pay from your LES.`
        : 'Could not auto-populate — enter your monthly base pay from your LES.';
    }
  }

  $('payYOS').value = s.yos;

  payRetSystem = s.payRetSystem || 'high3';
  const retCards = $$('.radio-card', $('payRetSystemGroup'));
  retCards.forEach(c => { const on = c.dataset.value === payRetSystem; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });

  selectedVARating = s.selectedVARating || 0;
  hasDependents = s.hasDependents || false;
  $('depToggle').classList.toggle('active', hasDependents);
  $('depNote').classList.toggle('hidden', !hasDependents);

  const ratingBtns = $('vaRatingBtns');
  ratingBtns.innerHTML = '';
  [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach(r => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `va-rating-btn${r === selectedVARating ? ' active' : ''}`;
    btn.textContent = r + '%';
    btn.dataset.rating = String(r);
    btn.setAttribute('aria-pressed', String(r === selectedVARating));
    ratingBtns.appendChild(btn);
  });

  // TSP: auto-populate years to retirement
  const today = new Date(s.todayDate + 'T00:00:00');
  const sep = new Date(s.sepDate + 'T00:00:00');
  const daysToRet = daysBetween(today, sep);
  const yearsToRet = Math.max(0, (daysToRet / 365.25)).toFixed(1);

  $('tspYearsToRet').value = numOr(s.tspYearsToRet, yearsToRet);
  if (s.tspBalance !== undefined) $('tspBalance').value = s.tspBalance;
  if (s.tspRate) { $('tspRate').value = s.tspRate; $('tspRateDisplay').textContent = s.tspRate + '%'; }
  if (s.tspContribution !== undefined) $('tspContribution').value = s.tspContribution;
  if (s.tspContribPct !== undefined) $('tspContribPct').value = s.tspContribPct;
  if (s.tspRetAge) $('tspRetAge').value = s.tspRetAge;
  if (s.tspFixedAmount !== undefined) $('tspFixedAmount').value = s.tspFixedAmount;

  // TSP contribution mode
  tspContribMode = s.tspContribMode || 'fixed';
  const cmCards = $$('.radio-card', $('tspContribModeGroup'));
  cmCards.forEach(c => { const on = c.dataset.value === tspContribMode; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
  $('tspContribFixedField').classList.toggle('hidden', tspContribMode !== 'fixed');
  $('tspContribPctField').classList.toggle('hidden', tspContribMode !== 'pct');

  tspWithdrawalMethod = s.tspWithdrawalMethod || 'fixed';

  // Set withdrawal method radio
  const wCards = $$('.tsp-withdrawal-card', $('tspWithdrawalGroup'));
  wCards.forEach(c => { const on = c.dataset.value === tspWithdrawalMethod; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
  $('tspFixedFields').style.display = tspWithdrawalMethod === 'fixed' ? '' : 'none';

  recalcPayEstimator(persist);
}

// The High-3 average and the current-pay figure it was derived from, recomputed on every
// pass and read by the decision tools so they all price the same base.
let currentHigh3 = null;

// Coalesced, memoized refresh of the Decision Tools panel. `signature` is every input the
// panel's prefills actually derive from; identical signature → nothing to do.
let dtSignature = null;
let dtFrame = null;
function scheduleDecisionToolsRefresh(isRet, signature) {
  if (signature === dtSignature) return;
  dtSignature = signature;
  if (dtFrame) cancelAnimationFrame(dtFrame);
  dtFrame = requestAnimationFrame(() => { dtFrame = null; renderDecisionTools(isRet); });
}

function recalcPayEstimator(persist = true) {
  const s = state;
  const isRet = s.transType === 'Retirement';
  const bp = parseFloat($('payBasePay').value) || 0;
  const yos = parseInt($('payYOS').value) || s.yos;
  const rg = getRankGrade(s.rank);

  // ----- High-3 -----
  // Retired pay is a percentage of the average of the highest 36 months of basic pay, not of
  // current pay. Using current pay overstated retired pay by 5-8% for anyone promoted or
  // crossing a longevity step inside the last three years — and that figure then seeded SBP,
  // CRDP/CRSC, the domicile comparison and the whole income table.
  const tableBase = getBasePay2026(rg, yos);
  const manualBasePay = tableBase === null || Math.abs(bp - tableBase) > 0.01;
  currentHigh3 = manualBasePay ? null : computeHigh3({ grade: rg, yos, sepDate: s.sepDate, dateOfRank: s.dateOfRank || null });
  const retBase = currentHigh3 ? currentHigh3.monthly : bp;

  const { monthly: monthlyRet0, mult, pct: pctMult } = computeRetirementPay({ basePay: retBase, yos, system: payRetSystem });
  const monthlyRet = isRet ? monthlyRet0 : 0;
  const annualRet = monthlyRet * 12;

  if (isRet && retBase > 0) {
    $('payRetResult').classList.remove('hidden');
    $('payRetMonthly').textContent = fmtCurrency(monthlyRet);
    $('payRetAnnual').textContent = fmtCurrency(annualRet);
    const multLabel = payRetSystem === 'redux'
      ? `REDUX 40% + 3.5%/yr past 20 (${Math.round(pctMult * 100)}%)`
      : `${yos} yrs × ${(mult * 100).toFixed(1)}% (${Math.round(pctMult * 100)}%)`;
    $('payRetFormula').textContent = `${multLabel} × ${fmtCurrency(retBase)} = ${fmtCurrency(monthlyRet)}/mo`;
    $('payBrsNote').classList.toggle('hidden', payRetSystem !== 'brs');
    const rx = $('payReduxNote');
    if (rx) rx.classList.toggle('hidden', payRetSystem !== 'redux');
    const h3 = $('payHigh3Note');
    if (h3) {
      if (currentHigh3) {
        const caveats = [];
        if (currentHigh3.promotionInWindow) caveats.push('your Date of Rank falls inside the 36-month window, so the pre-promotion months are estimated one grade lower');
        if (currentHigh3.estimatedFromSingleYear) caveats.push(`only the ${PAY_TABLE_YEAR} pay table is available, so earlier months reuse it and the average is slightly high`);
        h3.textContent = `High-3 average used: ${fmtCurrency(currentHigh3.monthly)}/mo (current base pay is ${fmtCurrency(bp)}/mo)`
          + (caveats.length ? ` — ${caveats.join('; ')}.` : '.');
        h3.classList.remove('hidden');
      } else {
        h3.textContent = 'Using the base pay you entered as your High-3 average. Retired pay is based on the average of your highest 36 months of basic pay, so enter that average rather than your current month if they differ.';
        h3.classList.remove('hidden');
      }
    }
  } else {
    $('payRetResult').classList.add('hidden');
  }

  // Routed through vaCompensation so a married member or one with children is not quoted the
  // veteran-alone rate (which understates a married 100% retiree by $219.59/mo).
  const vaComp = vaCompensation({ rating: selectedVARating, spouse: !!s.married, childrenU18: hasDependents ? 1 : 0 });
  $('vaCompResult').classList.remove('hidden');
  $('vaRatingLabel').textContent = selectedVARating + '%';
  $('vaCompAmount').textContent = fmtCurrency(vaComp);
  const vaDepNote = $('vaCompDepNote');
  if (vaDepNote) {
    const alone = VA_RATES[selectedVARating] || 0;
    if (selectedVARating === 0) {
      vaDepNote.textContent = 'Select a rating above to see the compensation it pays.';
    } else if (vaComp > alone) {
      vaDepNote.textContent = `Includes a dependent allowance (the veteran-alone rate is ${fmtCurrency(alone)}/mo). Actual amounts vary with the number and ages of dependents.`;
    } else if (selectedVARating < 30) {
      vaDepNote.textContent = 'VA pays no dependent allowance below a 30% rating, so this is the veteran-alone rate.';
    } else {
      vaDepNote.textContent = 'Veteran-alone rate — mark a spouse or dependents to include the dependent allowance.';
    }
  }

  renderIncomeTable(monthlyRet, isRet);
  renderIncomeBarChart(monthlyRet, isRet);

  // TSP calculations
  const tspMonthlyIncome = recalcTSP(monthlyRet, isRet, bp);

  renderInsightCards(monthlyRet, isRet);

  // Full income summary
  renderFullIncomeSummary(monthlyRet, vaComp, tspMonthlyIncome, isRet);

  // State tax panel
  renderStateTaxPanel(monthlyRet, isRet);

  // Decision Tools prefills (SBP base, CRDP gross pay, etc.) are derived from pay/VA
  // rating and otherwise only computed once from renderResults — without this, editing
  // base pay or VA rating here left those tools showing stale, pre-edit numbers.
  // renderDecisionTools defers to any value the visitor already customized there (via
  // state.tools), so this only refreshes fields nobody has touched yet.
  //
  // Do NOT delete the call — the comment above is load-bearing. But it does not need to run
  // on every keystroke: it performs ~18 innerHTML writes and a full-document icon scan, and
  // it only depends on the four inputs below. Re-run it when one of those actually changes,
  // coalesced into a frame so a fast typist gets one render instead of one per character.
  scheduleDecisionToolsRefresh(isRet, `${retBase}|${selectedVARating}|${yos}|${payRetSystem}|${s.married}|${hasDependents}`);

  state.payRetSystem = payRetSystem;
  state.selectedVARating = selectedVARating;
  state.hasDependents = hasDependents;
  state.tspBalance = parseFloat($('tspBalance').value) || 0;
  // undefined (not 0) on a blank field — see buildState. `|| 0` here defeated the
  // auto-populate just as surely as it did there.
  state.tspYearsToRet = numOr(parseFloat($('tspYearsToRet').value), undefined);
  state.tspRate = parseFloat($('tspRate').value) || 6;
  state.tspContribMode = tspContribMode;
  state.tspContribution = numOr(parseFloat($('tspContribution').value), 200);
  state.tspContribPct = parseFloat($('tspContribPct').value) || 5;
  // Clamped to isValidState's range so an out-of-range entry can't 400 every save.
  state.tspRetAge = clamp(numOr(parseInt($('tspRetAge').value), 45), 38, 70);
  state.tspWithdrawalMethod = tspWithdrawalMethod;
  state.tspFixedAmount = numOr(parseFloat($('tspFixedAmount').value), 500);
  // Persist the (possibly manually-entered) base pay so flag-officer entries survive reloads.
  state.payBasePay = parseFloat($('payBasePay').value) || 0;
  if (persist) saveState(state);

  // Announce the numbers this screen exists to produce. Every figure here previously
  // updated with no announcement at all, while the save indicator announced "Saving…"
  // once per keystroke — exactly backwards.
  const summaryInc = incomeAtRating(selectedVARating, monthlyRet, isRet);
  announce(
    (isRet ? `Estimated retired pay ${fmtCurrency(summaryInc.retiredPayAfterWaiver)} per month. ` : '') +
    (summaryInc.vaComp > 0 ? `VA compensation ${fmtCurrency(summaryInc.vaComp)} per month at ${selectedVARating} percent. ` : '') +
    `Total estimated monthly income ${fmtCurrency(summaryInc.total + (tspMonthlyIncome || 0))}.` +
    (summaryInc.waived > 0 ? ` Note: ${fmtCurrency(summaryInc.waived)} of retired pay is waived to receive VA compensation.` : '')
  );

  afterRender();
}

// ===== TSP CALCULATIONS =====
function recalcTSP(monthlyRet, isRet, basePay) {
  const currentBalance = parseFloat($('tspBalance').value) || 0;
  const yearsToRet = parseFloat($('tspYearsToRet').value) || 0;
  const annualRate = (parseFloat($('tspRate').value) || 6) / 100;
  const retAge = parseInt($('tspRetAge').value) || 45;
  const fixedAmount = numOr(parseFloat($('tspFixedAmount').value), 500);

  // Resolve monthly contribution based on mode
  let monthlyContrib = 0;
  if (tspContribMode === 'pct') {
    const pct = parseFloat($('tspContribPct').value) || 0;
    monthlyContrib = basePay > 0 ? (basePay * pct / 100) : 0;
    // Update the hint display
    const calcEl = $('tspContribPctCalc');
    if (calcEl) calcEl.textContent = basePay > 0 ? fmtCurrencyWhole(monthlyContrib) + '/mo' : '(enter base pay above)';
  } else {
    monthlyContrib = parseFloat($('tspContribution').value) || 0;
  }

  const monthlyRate = annualRate / 12;
  const months = Math.round(yearsToRet * 12);

  let fvBalance = 0;
  let fvContrib = 0;

  if (months > 0 && monthlyRate > 0) {
    fvBalance = currentBalance * Math.pow(1 + monthlyRate, months);
    fvContrib = monthlyContrib * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
  } else if (months > 0 && monthlyRate === 0) {
    fvBalance = currentBalance;
    fvContrib = monthlyContrib * months;
  } else {
    fvBalance = currentBalance;
    fvContrib = 0;
  }

  const projectedBalance = fvBalance + fvContrib;

  let tspMonthlyIncome = 0;

  if (currentBalance > 0 || monthlyContrib > 0) {
    $('tspProjectedResult').classList.remove('hidden');
    $('tspProjectedBalance').textContent = fmtCurrencyWhole(projectedBalance);
    $('tspGrowthCurrent').textContent = fmtCurrencyWhole(fvBalance);
    $('tspGrowthContrib').textContent = fmtCurrencyWhole(fvContrib);

    // Withdrawal result
    const wResult = $('tspWithdrawalResult');
    const wContent = $('tspWithdrawalContent');

    if (projectedBalance > 0) {
      wResult.classList.remove('hidden');

      if (tspWithdrawalMethod === 'fixed') {
        if (fixedAmount > 0) {
          const totalMonths = Math.floor(projectedBalance / fixedAmount);
          const years = Math.floor(totalMonths / 12);
          const remMonths = totalMonths % 12;
          const depletionAge = retAge + years + (remMonths / 12);
          const LIFE_EXP_AGE = 90; // longevity target for the depletion check

          let warningHtml = '';
          if (totalMonths === 0) {
            warningHtml = `<div class="mt-3 rounded-lg p-3 flex items-start gap-2 text-xs note-danger">
              <i data-lucide="alert-triangle" class="w-4 h-4 mt-0.5 flex-shrink-0"></i>
              <span>This withdrawal exceeds your projected balance — it wouldn't cover a single month. Choose a smaller monthly amount.</span>
            </div>`;
          } else if (depletionAge < LIFE_EXP_AGE) {
            warningHtml = `<div class="mt-3 rounded-lg p-3 flex items-start gap-2 text-xs note-danger">
              <i data-lucide="alert-triangle" class="w-4 h-4 mt-0.5 flex-shrink-0"></i>
              <span>At this withdrawal rate, your TSP may be depleted by age ${Math.round(depletionAge)} (before age ${LIFE_EXP_AGE}). Consider a lower withdrawal or annuity option.</span>
            </div>`;
          }

          wContent.innerHTML = `<div class="text-center">
            <p class="text-xs font-medium uppercase tracking-wide text-navy-400 mb-1">Fixed Monthly Withdrawal</p>
            <p class="text-2xl font-bold tabular-nums t-gold">${fmtCurrencyWhole(fixedAmount)}/mo</p>
            <p class="text-sm text-navy-500 mt-2">At ${fmtCurrencyWhole(fixedAmount)}/month, your TSP will last approximately <strong class="text-navy-700">${years} years ${remMonths} months</strong></p>
            ${warningHtml}
          </div>`;
          tspMonthlyIncome = fixedAmount;
        }
      } else if (tspWithdrawalMethod === 'life') {
        const distPeriod = getLifeExpDistributionPeriod(retAge);
        const firstYearAnnual = projectedBalance / distPeriod;
        const firstYearMonthly = firstYearAnnual / 12;

        wContent.innerHTML = `<div class="text-center">
          <p class="text-xs font-medium uppercase tracking-wide text-navy-400 mb-1">Life Expectancy Monthly Payment (First Year)</p>
          <p class="text-2xl font-bold tabular-nums t-gold">${fmtCurrencyWhole(firstYearMonthly)}/mo</p>
          <p class="text-sm text-navy-500 mt-2">Based on IRS distribution period of <strong class="text-navy-700">${distPeriod.toFixed(1)} years</strong> at age ${retAge}</p>
          <p class="text-xs text-navy-400 mt-1 italic">Amount recalculates each January based on remaining balance and updated life expectancy tables.</p>
        </div>`;
        tspMonthlyIncome = firstYearMonthly;
      } else if (tspWithdrawalMethod === 'annuity') {
        const factor = interpolateAnnuityFactor(retAge);
        const monthlyAnnuity = (projectedBalance / 1000) * factor;

        let annuityNote = '';
        if (projectedBalance < 3500) {
          annuityNote = `<div class="mt-3 rounded-lg p-3 flex items-start gap-2 text-xs note-warn note-warn-alt">
            <i data-lucide="info" class="w-4 h-4 mt-0.5 flex-shrink-0"></i>
            <span>Minimum TSP balance to purchase an annuity is $3,500. Your projected balance is below this threshold.</span>
          </div>`;
        }

        wContent.innerHTML = `<div class="text-center">
          <p class="text-xs font-medium uppercase tracking-wide text-navy-400 mb-1">Estimated Lifetime Monthly Annuity</p>
          <p class="text-2xl font-bold tabular-nums t-gold">${fmtCurrencyWhole(monthlyAnnuity)}/mo</p>
          <p class="text-sm text-navy-500 mt-2">Based on single-life annuity factor of <strong class="text-navy-700">$${factor.toFixed(2)}</strong> per $1,000 at age ${retAge}</p>
          <p class="text-xs text-navy-400 mt-1 italic">Once purchased, annuity payments are guaranteed for life but the balance is no longer yours to manage.</p>
          ${annuityNote}
        </div>`;
        tspMonthlyIncome = monthlyAnnuity;
      }
    } else {
      wResult.classList.add('hidden');
    }
  } else {
    $('tspProjectedResult').classList.add('hidden');
    $('tspWithdrawalResult').classList.add('hidden');
  }

  // BRS callout
  const brsCallout = $('tspBrsCallout');
  if (payRetSystem === 'brs' && basePay > 0) {
    const fivePercent = Math.round(basePay * 0.05);
    $('tspBrsCalloutText').innerHTML = `<strong>BRS Tip:</strong> As a BRS member, DoD matches up to 5% of your base pay in TSP contributions. If you're contributing at least 5% (<strong>${fmtCurrencyWhole(fivePercent)}/month</strong> based on your base pay), you're capturing your full match — a powerful wealth-building tool.`;
    brsCallout.classList.remove('hidden');
  } else {
    brsCallout.classList.add('hidden');
  }

  return tspMonthlyIncome;
}

function renderFullIncomeSummary(monthlyRet, vaComp, tspMonthlyIncome, isRet) {
  const summary = $('tspFullIncomeSummary');
  const hasAnyIncome = monthlyRet > 0 || vaComp > 0 || tspMonthlyIncome > 0;

  if (!hasAnyIncome) {
    summary.classList.add('hidden');
    return;
  }

  summary.classList.remove('hidden');

  // The biggest number on the page — so it is the last place that can afford to skip the
  // VA waiver. Derived from the same helper as the table and chart above.
  const inc = incomeAtRating(selectedVARating, monthlyRet, isRet);
  const total = inc.total + tspMonthlyIncome;
  const rows = [];

  if (isRet && inc.retiredPayAfterWaiver > 0) {
    rows.push({
      icon: 'medal',
      label: inc.waived > 0 ? 'Military Retirement Pay (after VA waiver)' : 'Military Retirement Pay',
      amount: inc.retiredPayAfterWaiver,
      color: '#c9a227',
    });
  }
  if (inc.vaComp > 0) {
    rows.push({ icon: 'shield-check', label: 'VA Disability Compensation (tax-free)', amount: inc.vaComp, color: '#10b981' });
  }
  if (tspMonthlyIncome > 0) {
    rows.push({ icon: 'trending-up', label: 'TSP Estimated Income', amount: tspMonthlyIncome, color: '#3468b0' });
  }

  $('tspFullIncomeRows').innerHTML = rows.map(r => `
    <div class="flex items-center justify-between">
      <span class="text-sm text-white/80 flex items-center gap-2"><i data-lucide="${r.icon}" class="w-4 h-4" data-css-color="${r.color}"></i> ${escapeHtml(r.label)}</span>
      <span class="text-lg font-semibold tabular-nums text-white">${fmtCurrencyWhole(r.amount)}</span>
    </div>
  `).join('');

  const waiverLine = $('tspFullWaiverNote');
  if (waiverLine) {
    waiverLine.classList.toggle('hidden', !(isRet && inc.waived > 0));
    if (isRet && inc.waived > 0) {
      waiverLine.textContent = `${fmtCurrencyWhole(inc.waived)}/mo of retired pay is waived to receive VA compensation. Your total is unchanged by the rating; that portion is simply tax-free.`;
    }
  }

  $('tspFullTotal').textContent = fmtCurrencyWhole(total);
  $('tspFullAnnual').textContent = `${fmtCurrencyWhole(total * 12)}/year`;
}

// SINGLE source for "what does this member actually take home at rating r".
//
// A retiree who accepts VA compensation waives an equal amount of retired pay; CRDP restores
// it only at 20+ years AND 50%+. Every income view below used to sum `monthlyRet + vaComp`
// inline with its own `r >= 50` CRDP test that omitted the 20-year condition — so for ratings
// 10-40% the app overstated monthly income by the entire VA amount, printing that figure
// directly beside its own red "Waiver" badge. Routing all four through calc.js means they
// cannot disagree with each other, or with the CRDP/CRSC decision tool, ever again.
function incomeAtRating(r, monthlyRet, isRet) {
  const va = vaCompensation({
    rating: r,
    spouse: !!(state && state.married),
    childrenU18: hasDependents ? 1 : 0,
  });
  return applyVAWaiver({
    grossRetiredPay: monthlyRet,
    vaComp: va,
    yos: (state && state.yos) || 0,
    rating: r,
    isRetirement: isRet,
  });
}

const VA_RATING_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function renderIncomeTable(monthlyRet, isRet) {
  const tbody = $('incomeTableBody');
  let html = '';
  let anyWaiver = false;
  VA_RATING_STEPS.forEach(r => {
    const inc = incomeAtRating(r, monthlyRet, isRet);
    const isHighlighted = r === selectedVARating;
    const isCrdp = inc.crdpEligible;
    if (isRet && inc.waived > 0) anyWaiver = true;
    let rowClass = 'income-table-row';
    if (isHighlighted) rowClass += ' highlighted';
    if (isRet) rowClass += isCrdp ? ' crdp-eligible' : ' va-waiver';
    const statusHtml = isRet ? (isCrdp
      ? '<span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full chip-success">CRDP</span>'
      : (inc.waived > 0
        ? `<span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full chip-danger" title="Retired pay reduced by ${fmtCurrency(inc.waived)}">Waiver</span>`
        : '<span class="text-xs text-navy-400">—</span>')
    ) : '<span class="text-xs text-navy-400">—</span>';
    html += `<tr class="${rowClass}">
      <td class="px-3 py-2 text-sm font-medium text-navy-700 tabular-nums">${r}%</td>
      <td class="px-3 py-2 text-sm text-right tabular-nums text-navy-600">${isRet ? fmtCurrency(inc.retiredPayAfterWaiver) : '—'}</td>
      <td class="px-3 py-2 text-sm text-right tabular-nums t-gold t-medium">${fmtCurrency(inc.vaComp)}</td>
      <td class="px-3 py-2 text-sm text-right tabular-nums font-semibold text-navy-700">${fmtCurrency(inc.total)}</td>
      <td class="px-3 py-2 text-sm text-right tabular-nums text-navy-500">${fmtCurrency(inc.total * 12)}</td>
      <td class="px-3 py-2 text-center">${statusHtml}</td>
    </tr>`;
  });
  tbody.innerHTML = html;
  const note = $('incomeTableWaiverNote');
  if (note) {
    note.classList.toggle('hidden', !anyWaiver);
    if (anyWaiver) {
      note.textContent = (state && state.yos < 20)
        ? 'Retired pay is reduced dollar-for-dollar by VA compensation (the "VA waiver"). CRDP would restore it, but it requires 20+ years of service — so at your years of service every rating below is a tax-free swap, not extra money. The gain is that the same total arrives untaxed.'
        : 'Below a 50% rating, retired pay is reduced dollar-for-dollar by VA compensation (the "VA waiver"), so your total does not rise — the benefit is that part of it becomes tax-free. At 50%+ CRDP restores the full amount.';
    }
  }
}

function renderIncomeBarChart(monthlyRet, isRet) {
  const container = $('incomeBarChart');
  const maxTotal = incomeAtRating(100, monthlyRet, isRet).total;
  if (maxTotal === 0) {
    container.innerHTML = '<p class="text-sm text-navy-400 italic">Enter base pay to see the chart.</p>';
    return;
  }
  let html = '';
  VA_RATING_STEPS.forEach(r => {
    const inc = incomeAtRating(r, monthlyRet, isRet);
    // Bars show retired pay AFTER the waiver, so the chart's length matches the total
    // beside it. Before this, every bar below 50% was drawn too long.
    const retW = (inc.retiredPayAfterWaiver / maxTotal) * 100;
    const vaW = (inc.vaComp / maxTotal) * 100;
    const isActive = r === selectedVARating;
    const opacity = isActive ? '1' : '0.65';
    html += `<div class="flex items-center gap-2 bar-row" data-css-opacity="${opacity}">
      <span class="text-xs font-medium text-navy-500 w-8 text-right tabular-nums">${r}%</span>
      <div class="flex-1 flex h-6 rounded-md overflow-hidden surface-muted">
        ${inc.retiredPayAfterWaiver > 0 ? `<div class="bar-segment bar-seg-ret h-full" data-css-width="${retW}%"></div>` : ''}
        ${inc.vaComp > 0 ? `<div class="bar-segment bar-seg-va h-full" data-css-width="${vaW}%"></div>` : ''}
      </div>
      <span class="text-xs font-semibold text-navy-600 tabular-nums w-20 text-right">${fmtCurrency(inc.total)}</span>
    </div>`;
  });
  container.innerHTML = html;
}

function renderInsightCards(monthlyRet, isRet) {
  const container = $('insightCards');
  const i0 = incomeAtRating(0, monthlyRet, isRet);
  const i50 = incomeAtRating(50, monthlyRet, isRet);
  const i100 = incomeAtRating(100, monthlyRet, isRet);
  const diff50 = i50.total - i0.total;
  const diffAnnual = diff50 * 12;
  const yos = (state && state.yos) || 0;
  const crdpBlocked = isRet && yos < 20;

  let cards = '';
  cards += `<div class="insight-card surface-muted">
    <div class="flex items-center gap-2 mb-2"><i data-lucide="target" class="w-4 h-4 text-gold-500"></i><h4 class="text-sm font-semibold text-navy-700">Break-Even Insight</h4></div>
    <p class="text-xs text-navy-500 leading-relaxed">At a 50% VA rating, your estimated total monthly income is <strong class="text-navy-700">${fmtCurrency(i50.total)}</strong> — <strong class="text-navy-700">${fmtCurrency(diff50)}</strong> more per month than with no VA rating. ${
      crdpBlocked
        ? `CRDP (full concurrent receipt) requires <strong class="text-navy-700">20+ years of service</strong>; at ${yos} years you would not qualify, so VA compensation offsets your retired pay rather than adding to it.`
        : (isRet ? 'At 50%+ with 20+ years of service you qualify for CRDP (full concurrent receipt), which is why the total jumps here.' : 'VA compensation is tax-free.')
    }</p>
  </div>`;
  cards += `<div class="insight-card surface-gold">
    <div class="flex items-center gap-2 mb-2"><i data-lucide="trophy" class="w-4 h-4 text-gold-500"></i><h4 class="text-sm font-semibold text-navy-700">100% Rating Scenario</h4></div>
    <p class="text-xs text-navy-500 leading-relaxed">If rated at 100%, your estimated combined monthly income would be <strong class="text-navy-700">${fmtCurrency(i100.total)}</strong> (<strong class="text-navy-700">${fmtCurrency(i100.total * 12)}</strong>/year). At 100% P&T, additional benefits include commissary access, full TRICARE, and potential property tax exemptions.</p>
  </div>`;
  cards += `<div class="insight-card surface-success">
    <div class="flex items-center gap-2 mb-2"><i data-lucide="calendar-check" class="w-4 h-4 t-success"></i><h4 class="text-sm font-semibold text-navy-700">Annual Impact</h4></div>
    <p class="text-xs text-navy-500 leading-relaxed">${
      diffAnnual > 0
        ? `Going from a 0% to a 50% VA rating is worth approximately <strong class="text-navy-700">${fmtCurrency(diffAnnual)}</strong> per year. VA compensation is not subject to federal or state income tax.`
        : `At your years of service a rating does not increase your <em>total</em> — VA compensation offsets retired pay dollar-for-dollar. It still helps: <strong class="text-navy-700">${fmtCurrency(i50.vaComp * 12)}</strong>/year of it becomes tax-free, and a rating unlocks VA healthcare and other benefits.`
    }</p>
  </div>`;
  container.innerHTML = cards;
}

// ===== STATE TAX PANEL =====
function renderStateTaxPanel(monthlyRet, isRet) {
  const s = state;
  let panel = $('stateTaxPanel');
  if (!panel) return; // panel doesn't exist yet in DOM — it's injected below the insight cards

  const stateCode = parseStateFromLocation(s.postLocation);
  if (!stateCode) {
    panel.innerHTML = `<div class="insight-card surface-muted span-full">
      <div class="flex items-center gap-2 mb-2"><i data-lucide="map-pin" class="w-4 h-4 text-gold-500"></i><h4 class="text-sm font-semibold text-navy-700">State Tax Impact</h4></div>
      <p class="text-xs text-navy-500">Enter a post-transition location (e.g., "San Antonio, TX") on the setup screen to see how your state's tax laws will affect your retirement income.</p>
    </div>`;
    afterRender();
    return;
  }

  const td = STATE_TAX_DATA[stateCode];
  // State tax applies to the retired pay actually RECEIVED — i.e. after the VA waiver.
  // Taxing the pre-waiver gross overstated the state-tax bill for every rating below the
  // CRDP threshold, on top of overstating the income it was computed from.
  const inc = incomeAtRating(selectedVARating, monthlyRet, isRet);
  const annualRet = isRet ? inc.retiredPayAfterWaiver * 12 : 0;
  const annualVA = inc.vaComp * 12;

  // Single source of truth for the state-tax estimate — shared with the "Best State of
  // Residence" comparison tool (calc.js estimateStateTaxOnRetiredPay) so the two never
  // show disagreeing numbers for the same state.
  const retTaxAnnual = estimateStateTaxOnRetiredPay(stateCode, annualRet).estAnnualTax;

  const afterTaxMonthly = isRet ? ((annualRet - retTaxAnnual) / 12) : 0;
  const noTaxLabel = td.topRate === 0 ? '🏖️ No state income tax' : '';

  let colorBg, colorText, icon;
  if (td.militaryRetirementTax === 'exempt' || td.topRate === 0) {
    colorBg = '#d1fae5'; colorText = '#047857'; icon = 'check-circle';
  } else if (td.militaryRetirementTax === 'partial') {
    colorBg = '#fef3c7'; colorText = '#b45309'; icon = 'alert-triangle';
  } else {
    colorBg = '#fee2e2'; colorText = '#b91c1c'; icon = 'alert-circle';
  }

  panel.innerHTML = `<div class="insight-card span-full" data-css-bg="${colorBg}">
    <div class="flex items-center gap-2 mb-2">
      <i data-lucide="${icon}" class="w-4 h-4" data-css-color="${colorText}"></i>
      <h4 class="text-sm font-semibold" data-css-color="${colorText}">${td.name} — Military Retirement Tax Status</h4>
      ${noTaxLabel ? `<span class="text-xs font-medium px-2 py-0.5 rounded-full chip-success-inverse">${noTaxLabel}</span>` : ''}
    </div>
    <p class="text-xs leading-relaxed mb-2" data-css-color="${colorText}">${td.note}</p>
    ${isRet && annualRet > 0 ? `
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
      <div class="bg-white/70 rounded-lg p-2 text-center">
        <p class="text-xs text-navy-400">Gross Ret. Pay</p>
        <p class="text-sm font-semibold text-navy-700">${fmtCurrencyWhole(monthlyRet)}/mo</p>
      </div>
      <div class="bg-white/70 rounded-lg p-2 text-center">
        <p class="text-xs text-navy-400">Est. State Tax</p>
        <p class="text-sm font-semibold" data-css-color="${colorText}">${retTaxAnnual > 0 ? '-' + fmtCurrencyWhole(retTaxAnnual / 12) + '/mo' : 'None'}</p>
      </div>
      <div class="bg-white/70 rounded-lg p-2 text-center">
        <p class="text-xs text-navy-400">After-State-Tax</p>
        <p class="text-sm font-semibold text-navy-700">${fmtCurrencyWhole(afterTaxMonthly)}/mo</p>
      </div>
    </div>` : ''}
    <p class="text-xs mt-2 op-80" data-css-color="${colorText}">Note: VA disability compensation is always federal and state tax-exempt. State tax estimates are approximations — consult a tax professional for your specific situation.</p>
  </div>`;
  afterRender();
}

// ===== PHASES =====
// Shared by renderPhases' wiring and the print-export open/restore flow.
function setPhaseOpen(header, open) {
  const content = $('content-' + header.dataset.phase);
  const chev = $1('.phase-chevron', header);
  if (!content) return;
  content.classList.toggle('open', open);
  header.setAttribute('aria-expanded', String(open));
  if (open) content.removeAttribute('inert'); else content.setAttribute('inert', '');
  if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
}

function renderPhases(today, sep, termStart, ptdyStart, ptdyEnd, sbStart, sbEnd, tapDeadline, isRet) {
  const s = state;
  const checks = loadChecks();
  // The 7-phase / ~110-task dataset now lives in calc.js (buildPhases) where it is
  // importable and unit-tested — id uniqueness and legacy-id resolution are asserted there,
  // which matters because checklist progress is keyed BY TASK ID: a duplicated or renamed
  // id silently loses a user's ticked boxes. This function is purely the renderer.
  const phases = buildPhases(s, { today, sep, termStart, ptdyStart, ptdyEnd, sbStart, sbEnd, tapDeadline })
    .map(ph => ({ ...ph, range: `${fmtDateShort(ph.from)} — ${fmtDateShort(ph.to)}` }));

  let html = '';
  phases.forEach((phase, pi) => {
    const taskChecks = phase.tasks.map(t => checks[t.id] || false);
    const done = taskChecks.filter(Boolean).length;
    const total = phase.tasks.length;
    const pctDone = Math.round((done / total) * 100);
    html += `
      <div class="section-card card-flush">
        <div class="phase-header" data-phase="${phase.id}" role="button" tabindex="0" aria-expanded="false" aria-controls="content-${phase.id}">
          <div class="flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-sm font-semibold text-navy-700">${phase.name}</h3>
              <span class="text-xs font-medium px-2 py-0.5 rounded-full tabular-nums phase-pct${pctDone === 100 ? ' is-complete' : ''}">${pctDone}%</span>
            </div>
            <p class="text-xs text-navy-400 mt-0.5">${phase.range}</p>
            <div class="w-full h-1.5 rounded-full mt-2 overflow-hidden surface-track">
              <div class="h-full rounded-full progress-animate phase-bar${pctDone === 100 ? ' is-complete' : ''}" data-css-width="${pctDone}%"></div>
            </div>
          </div>
          <i data-lucide="chevron-down" class="w-5 h-5 text-navy-400 flex-shrink-0 transition-transform phase-chevron"></i>
        </div>
        <div class="phase-content" id="content-${phase.id}" inert>
          <div class="px-4 pb-4 pt-1 space-y-1">
            ${phase.tasks.map((task, ti) => `
              <label class="check-item">
                <input type="checkbox" data-phase="${phase.id}" data-task-id="${task.id}" ${taskChecks[ti] ? 'checked' : ''} />
                <span class="text-sm text-navy-600 task-text${taskChecks[ti] ? ' is-done' : ''}">${escapeHtml(task.text)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      </div>`;
  });
  $('phaseList').innerHTML = html;

  $$('.phase-header').forEach(h => {
    const toggle = () => setPhaseOpen(h, !$('content-' + h.dataset.phase).classList.contains('open'));
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggle(); }
    });
  });

  // The checklist is rebuilt on every render, so read-only disabling has to be re-applied here.
  applyReadOnlyControls();

  $$('#phaseList input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (store.isReadOnly()) { cb.checked = !cb.checked; return; }
      const checks = loadChecks();
      checks[cb.dataset.taskId] = cb.checked;
      saveChecks(checks);
      const span = cb.nextElementSibling;
      if (span) { span.style.textDecoration = cb.checked ? 'line-through' : ''; span.style.opacity = cb.checked ? '0.5' : '1'; }
      const phaseId = cb.dataset.phase;
      const allInPhase = $$(`input[data-phase="${phaseId}"]`);
      const doneCount = [...allInPhase].filter(c => c.checked).length;
      const pctNew = Math.round((doneCount / allInPhase.length) * 100);
      const header = $1(`.phase-header[data-phase="${phaseId}"]`);
      if (header) {
        const badge = $1('.rounded-full:first-of-type', header);
        if (badge) { badge.textContent = pctNew + '%'; badge.style.background = pctNew === 100 ? '#d1fae5' : '#f0f2f6'; badge.style.color = pctNew === 100 ? '#047857' : '#67779e'; }
        const bar = $1('.progress-animate', header);
        if (bar) { bar.style.width = pctNew + '%'; bar.style.background = pctNew === 100 ? '#10b981' : '#c9a227'; }
      }
    });
  });
}

// ===== RESOURCES =====
function renderResources() {
  const s = state;
  const resources = [
    { title:'TAP / Transition', links:[['militaryonesource.mil','https://www.militaryonesource.mil'],['tapevents.mil','https://www.tapevents.mil']], icon:'book-open' },
    { title:'SkillBridge', links:[['skillbridge.osd.mil','https://skillbridge.osd.mil']], icon:'briefcase' },
    { title:'VA Benefits', links:[['va.gov','https://www.va.gov'],['benefits.va.gov','https://benefits.va.gov']], icon:'shield' },
    { title:'Resume Help', links:[['hireheroesusa.org','https://www.hireheroesusa.org'],['acp-usa.org','https://www.acp-usa.org']], icon:'file-text' },
    { title:'Federal Jobs', links:[['usajobs.gov — Veterans Preference','https://www.usajobs.gov']], icon:'building-2' },
    { title:'Financial', links:[['mypay.dfas.mil','https://mypay.dfas.mil'],['tsp.gov','https://www.tsp.gov']], icon:'dollar-sign' },
    { title:'TRICARE', links:[['tricare.mil','https://www.tricare.mil'],['TRICARE For Life','https://www.tricare.mil/tfl']], icon:'heart-pulse' },
    { title:'Dental & Vision (FEDVIP)', links:[['benefeds.gov','https://www.benefeds.gov']], icon:'smile' },
    { title:'Survivor Benefits & Life Insurance', links:[['DFAS — SBP','https://www.dfas.mil/RetiredMilitary/provide/sbp/'],['VA — VGLI','https://www.va.gov/life-insurance/options-eligibility/vgli/']], icon:'shield' },
    { title:'Retired Pay (DFAS)', links:[['VA Waiver / CRDP / CRSC','https://www.dfas.mil/RetiredMilitary/disability/'],['Arrears of Pay (DD 2894)','https://www.dfas.mil/RetiredMilitary/provide/aop/'],['State Tax Withholding','https://www.dfas.mil/RetiredMilitary/manage/taxes/sitw/']], icon:'landmark' },
    { title:'VA Health Care', links:[['Eligibility / PACT Act','https://www.va.gov/health-care/eligibility/']], icon:'stethoscope' },
    { title:'Mental Health & First Year', links:[['Veterans Crisis Line (988→1)','https://www.veteranscrisisline.net'],['Vet Centers','https://www.vetcenter.va.gov'],['VA Solid Start','https://benefits.va.gov/transition/solid-start.asp']], icon:'life-buoy' },
    { title:'Relocation', links:[['Move.mil — Retirees & Separatees','https://www.move.mil/moving-guide/retirees-separatees']], icon:'truck' },
    { title:'Credentialing', links:[['DoD COOL','https://www.cool.osd.mil']], icon:'award' },
    { title:'Financial Protection', links:[['FINRA BrokerCheck','https://brokercheck.finra.org']], icon:'search-check' },
    { title:'ID Cards & Lifetime Privileges', links:[['RAPIDS ID Office Locator','https://idco.dmdc.osd.mil'],['AMC Space-A Travel','https://www.amc.af.mil/Home/AMC-Travel-Site/']], icon:'id-card' },
    { title:'Records', links:[['National Archives / NPRC','https://www.archives.gov/personnel-records-center']], icon:'folder-archive' },
  ];
  if (s.giBill) resources.push({ title:'GI Bill', links:[['benefits.va.gov/gibill','https://benefits.va.gov/gibill']], icon:'graduation-cap' });
  if (s.vaClaim) resources.push({ title:'VA Disability', links:[['va.gov/disability','https://www.va.gov/disability'],['Find an accredited VSO','https://www.va.gov/get-help-from-accredited-representative/'],['VR&E (Chapter 31)','https://www.va.gov/careers-employment/vocational-rehabilitation/']], icon:'clipboard-list' });
  if (s.married) resources.push({ title:'Spouse Support', links:[['Military OneSource SECO / MyCAA','https://myseco.militaryonesource.mil']], icon:'users' });
  if (s.federalJob) resources.push({ title:'Federal Employment', links:[['OPM FedsHireVets','https://www.fedshirevets.gov']], icon:'building-2' });

  $('resourceGrid').innerHTML = resources.map(r => `
    <div class="resource-card">
      <h4 class="flex items-center gap-2"><i data-lucide="${r.icon}" class="w-4 h-4 text-gold-500"></i> ${r.title}</h4>
      ${r.links.map(l => `<a href="${l[1]}" target="_blank" rel="noopener">${l[0]}</a>`).join('')}
    </div>
  `).join('');
}

// ===== THINGS TO THINK ABOUT =====
// Non-checkbox, strategic/qualitative prompts — the decisions and personal
// realities the task list can't capture. Some are gated to the user's situation.
function renderThinkAbout() {
  const s = state;
  const isRet = s.transType === 'Retirement';
  const hasFamily = s.married || s.hasDependents;
  const items = [
    { icon:'compass', title:'Identity, purpose & routine', text:'You will no longer be addressed by rank, and the built-in structure, hierarchy, and community disappear overnight. Draft a written week-one-to-month-three daily routine and pick one or two "belonging" anchors before your date.' },
    { icon:'heart-pulse', title:'Mental-health continuity', text:'The first 12 months after separation are a documented high-risk window. Save the Veterans/Military Crisis Line (988 then 1) and your nearest Vet Center now, and line up a TRICARE-network or telehealth provider so therapy/medication doesn\'t lapse during the move.' },
    { icon:'wallet', title:'Money & lifestyle — a family conversation', text:'Retired pay is a fraction of active-duty take-home and is taxable, and the free on-base lifestyle changes. Talk through wants vs. needs and what "enough" looks like before lifestyle creep — or a let-down — sets in.' },
    s.married ? { icon:'users', title:'Bring your spouse into the transition', text:'Retirement reshapes your spouse\'s identity and routine too. Have them attend TAP and the VA Benefits course, and have a shared "what does month 3 look like for both of us?" conversation.' } : null,
    { icon:'map-pin', title:'State of domicile is a lifetime tax decision', text:'It controls the tax on your pension (and possibly TSP/IRA) for the rest of your life. Choose deliberately with the Best-State tool below — don\'t default to your last duty station.' },
    isRet ? { icon:'shield', title:'SBP is effectively irreversible', text:'Understand the full-spouse default, the notarized-concurrence requirement to decline, the 25–36 month withdrawal window, and that the SBP-DIC offset was repealed in 2023 — so old "SBP is wasted if DIC applies" advice is obsolete.' } : null,
    { icon:'file-signature', title:'A beneficiary form beats your will', text:'TSP-3, SGLV/VGLI, Arrears of Pay (DD 2894), DD-93 death gratuity, and bank/brokerage POD/TOD each pay the named person regardless of your will or divorce decree. Audit every one.' },
    s.vaClaim ? { icon:'minus-circle', title:'The VA-waiver offset shrinks your first check', text:'Retired pay is reduced dollar-for-dollar by tax-free VA compensation. Understand CRDP (auto at 50%+, taxable) vs. CRSC (combat-related, tax-free, must apply) before you budget — use the comparison tool below.' } : null,
    s.vaClaim ? { icon:'stethoscope', title:'VA health care ≠ your disability claim', text:'Filing a claim does NOT enroll you in VA health care, and vice-versa. Enroll within the PACT Act combat-veteran window for the strongest eligibility.' } : null,
    s.vaClaim ? { icon:'briefcase', title:'Screen for TDIU', text:'If service-connected conditions prevent gainful work (one at 60%, or 70% combined with one at 40%), TDIU pays at the 100% rate without a 100% schedular rating.' } : null,
    s.vaClaim ? { icon:'unlock', title:'Map what a rating unlocks', text:'A 100% Permanent & Total rating can trigger Chapter 35 (DEA) for dependents, CHAMPVA, and the largest state property-tax exemptions — none of which enroll automatically.' } : null,
    s.vaClaim ? { icon:'graduation-cap', title:'VR&E vs. the GI Bill', text:'Veteran Readiness & Employment (Chapter 31) can fund retraining and pay a subsistence allowance WITHOUT consuming your GI Bill — evaluate it first if you have a service-connected disability.' } : null,
    hasFamily ? { icon:'baby', title:'Minor children need a trust or custodian', text:'Name a guardian in your will AND route life insurance/TSP through a trust or UTMA custodian — insurers and TSP cannot pay a minor directly, which freezes the benefit pending a court-appointed conservator.' } : null,
    { icon:'search-check', title:'Vet any financial advisor before rolling out the TSP', text:'Confirm fiduciary status, request Form CRS/ADV, and check FINRA BrokerCheck. Advisory IRAs charging ~2% vs. the TSP\'s ~0.05% can cost six figures over a retirement.' },
    s.federalJob ? { icon:'landmark', title:'FERS buyback math + no salary offset', text:'If you take a FERS-covered federal job, run the military service buyback math early (the interest-free window is short); for most active-duty retirees, waiving an immediate pension does NOT pay off. And since 1999 there is NO salary offset — pension and GS pay are both paid in full.' } : null,
    s.federalJob ? { icon:'scale', title:'Post-government ethics (18 U.S.C. 207)', text:'Acquisition, contracting, and program-office retirees can face lifetime or 1–2 year cooling-off restrictions. Get an ethics opinion before signing with a contractor or launching a venture.' } : null,
    { icon:'calendar-clock', title:'Long-horizon: Medicare Part B at 65', text:'At 65 you MUST enroll in Medicare Part B to keep any TRICARE (TRICARE For Life). Skipping it means losing TRICARE plus a lifelong Part B late-enrollment penalty (10% per 12 months delayed).' },
    { icon:'piggy-bank', title:'Long-horizon: TSP RMDs', text:'Traditional TSP required minimum distributions begin at age 73 (75 if born 1960+); Roth TSP has no lifetime RMDs. This shapes today\'s keep-vs-roll and Roth-conversion decisions.' },
    isRet ? { icon:'flag', title:'Plan the retirement ceremony deliberately', text:'The 20+ year no-cost flag is a once-per-career statutory benefit. Coordinate the flag, spouse/retirement certificates, and shadow box about two months out — and verify every award is in your record before it hits the DD-214.' } : null,
  ].filter(Boolean);

  $('thinkAboutGrid').innerHTML = items.map(it => `
    <div class="rounded-xl p-4 note-quote">
      <h4 class="text-sm font-semibold text-navy-700 flex items-center gap-2 mb-1"><i data-lucide="${it.icon}" class="w-4 h-4 text-gold-500 flex-shrink-0"></i> ${it.title}</h4>
      <p class="text-sm text-navy-500 leading-relaxed">${it.text}</p>
    </div>
  `).join('');
  afterRender();
}

// ===== DECISION TOOLS & CALCULATORS =====
const _n = (id) => parseFloat($(id) && $(id).value) || 0;

// Prefill the calculator inputs from the plan (and any saved tool inputs), then
// compute. Saved overrides live in state.tools keyed by element id.
function renderDecisionTools(isRet) {
  const s = state;
  const t = s.tools || {};
  const rg = getRankGrade(s.rank);
  const basePayEl = $('payBasePay');
  const basePay = (basePayEl && parseFloat(basePayEl.value)) || getBasePay2026(rg, s.yos) || 0;
  const retMonthly = isRet ? computeRetirementPay({ basePay, yos: s.yos, system: s.payRetSystem || 'high3' }).monthly : 0;

  $('dtCrRating').innerHTML = [0,10,20,30,40,50,60,70,80,90,100].map(r => `<option value="${r}">${r}%</option>`).join('');

  const setv = (id, dflt) => { const el = $(id); if (el) el.value = (t[id] != null && t[id] !== '') ? t[id] : dflt; };
  const setc = (id, dflt) => { const el = $(id); if (el) el.checked = (t[id] != null) ? !!t[id] : dflt; };

  setv('dtSbpBase', Math.round(retMonthly));
  setv('dtSbpRetAge', s.tspRetAge || 45);
  setv('dtSbpSpouseAge', '');
  setv('dtCrGross', Math.round(retMonthly));
  setv('dtCrRating', String(s.selectedVARating || 0));
  setv('dtCrCombat', 0);
  setv('dtCrBracket', '0.22');
  setv('dtHcGroup', 'A');
  setv('dtHcCoverage', (s.hasDependents || s.married) ? 'family' : 'individual');
  setv('dtHcRx', 0);
  setv('dtHcFedvip', 0);
  setv('dtPsVisits', 'moderate');
  setc('dtPsLowCost', true);
  setc('dtPsFlex', false);
  setv('dtStPay', Math.round(retMonthly * 12));
  setv('dtStStates', parseStateFromLocation(s.postLocation) || '');
  setv('dtPpmGcc', '');
  setv('dtPpmExpenses', 0);
  setv('dtTspAge', s.tspRetAge || 45);
  setv('dtTspTrad', s.tspBalance || 0);
  setv('dtTspRoth', 0);
  setv('dtTspAdvFee', 1.0);
  setv('dtTspYears', 20);
  setv('dtLeaveDays', s.leaveDays || 60);
  setv('dtLeaveAlreadySold', 0);
  setv('dtLeaveBase', Math.round(basePay));
  // BAH now comes from the plan (captured once in setup) rather than defaulting to 0, which
  // silently priced terminal leave at base+BAS only — omitting its largest term.
  setv('dtLeaveBah', Math.round(s.bah || 0));
  setv('dtLeaveBas', getBAS(s.rankCat)); // BAS rates live in calc.js with the rest of the data

  recalcAllTools();
}

function persistTools() {
  if (!state || !state.firstName) return;
  const ids = ['dtSbpBase','dtSbpRetAge','dtSbpSpouseAge','dtCrGross','dtCrRating','dtCrCombat','dtCrBracket','dtHcGroup','dtHcCoverage','dtHcRx','dtHcFedvip','dtPsVisits','dtStPay','dtStStates','dtPpmGcc','dtPpmExpenses','dtTspAge','dtTspTrad','dtTspRoth','dtTspAdvFee','dtTspYears','dtLeaveDays','dtLeaveAlreadySold','dtLeaveBase','dtLeaveBah','dtLeaveBas',
    'dtSalFiling','dtSalHealth','dtSal401k'];
  const t = {};
  ids.forEach(id => { const el = $(id); if (el) t[id] = el.value; });
  t.dtPsLowCost = $('dtPsLowCost').checked;
  t.dtPsFlex = $('dtPsFlex').checked;
  state.tools = t;
  saveState(state);
}

function recalcAllTools() {
  recalcSBP(); recalcCRSC(); recalcHealthcare(); recalcPrimeSelect(); recalcBestState(); recalcPPM(); recalcTSPRoll(); recalcLeaveSellBack(); recalcSalaryBreakEven();
  afterRender();
}

function recalcLeaveSellBack() {
  const days = _n('dtLeaveDays');
  if (days <= 0) { $('dtLeaveResult').innerHTML = '<p class="text-navy-400">Enter days to compare terminal leave against selling them back.</p>'; return; }
  const r = compareLeaveSellBack({
    basePay: _n('dtLeaveBase'), bah: _n('dtLeaveBah'), bas: _n('dtLeaveBas'), days,
    daysAlreadySold: _n('dtLeaveAlreadySold'),
  });
  // Terminal leave is algebraically incapable of losing this comparison — it pays the same
  // base pay PLUS untaxed BAH/BAS for the same days — so "Terminal leave nets more" was a
  // foregone conclusion dressed up as a finding. The actionable number is the per-day
  // premium: what each extra day on active duty is actually worth.
  $('dtLeaveResult').innerHTML = `
    ${r.exceedsSellbackCap ? `<div class="rounded-lg p-3 mb-3 text-xs note-danger note-danger-deep">
      <strong>Only ${r.sellableDays} of these ${r.days} days can be sold.</strong> 37 U.S.C. 501 caps leave sell-back at ${r.sellbackCap} days over an entire career${_n('dtLeaveAlreadySold') > 0 ? `, and you've recorded ${_n('dtLeaveAlreadySold')} already used` : ''}. The remaining ${r.unsellableDays} day${r.unsellableDays === 1 ? '' : 's'} can only be taken as leave.
    </div>` : ''}
    <div class="grid grid-cols-2 gap-3">
      <div>
        <p class="text-xs text-navy-400 uppercase tracking-wide mb-1">Sell Leave Back${r.sellableDays !== r.days ? ` (${r.sellableDays} days)` : ''}</p>
        <p class="text-lg font-bold tabular-nums text-navy-700">${fmtCurrencyWhole(r.sellBackNet)}</p>
        <p class="text-xs text-navy-400">net of ${fmtCurrencyWhole(r.sellBackGross)} gross (base pay only)</p>
      </div>
      <div>
        <p class="text-xs text-navy-400 uppercase tracking-wide mb-1">Terminal Leave (${r.days} days)</p>
        <p class="text-lg font-bold tabular-nums text-navy-700">${fmtCurrencyWhole(r.terminalLeaveNet)}</p>
        <p class="text-xs text-navy-400">net of ${fmtCurrencyWhole(r.terminalLeaveGross)} gross (pay + BAH + BAS)</p>
      </div>
    </div>
    <div class="flex items-center justify-between mt-3 pt-3 border-t rule">
      <span class="font-semibold text-navy-700">Each day taken as leave instead of sold is worth</span>
      <span class="font-bold tabular-nums t-gold">${r.perDayAdvantage > 0 ? '+' : ''}${fmtCurrency(r.perDayAdvantage)}/day</span>
    </div>
    <p class="text-xs text-navy-400 mt-2">${r.perDayAdvantage > 0
      ? `That premium is your tax-free BAH + BAS — money sell-back does not pay at all. Over ${r.days} days it totals ${fmtCurrencyWhole(r.netDifference)}. Weigh it against starting a civilian salary sooner, which taking leave delays.`
      : 'With no BAH or BAS entered the two are equivalent on take-home. Enter your BAH to see the real difference.'}</p>`;
}

// "What civilian salary do I need to break even?" — the #1 TAP employment question. Every
// input already existed in the app; nothing joined them up until now.
function recalcSalaryBreakEven() {
  const box = $('dtSalResult');
  if (!box) return;
  const s = state;
  const isRet = s.transType === 'Retirement';
  const basePay = _n('dtLeaveBase') || _n('payBasePay');
  if (basePay <= 0) {
    box.innerHTML = '<p class="text-navy-400">Enter your base pay above to work out the salary you need.</p>';
    return;
  }
  const retiredPayMonthly = isRet ? incomeAtRating(selectedVARating, _n('dtCrGross'), true).retiredPayAfterWaiver : 0;
  const r = requiredCivilianSalary({
    basePay,
    bah: _n('dtLeaveBah'),
    bas: _n('dtLeaveBas'),
    retiredPayMonthly,
    filing: $('dtSalFiling').value === 'joint' ? 'joint' : 'single',
    stateCode: parseStateFromLocation(s.postLocation),
    civilianHealthcareMonthly: _n('dtSalHealth'),
    employer401kMatchPct: _n('dtSal401k'),
  });
  if (r.unreachable || r.requiredSalary === null) {
    box.innerHTML = '<p class="text-navy-400">Your current compensation is higher than this tool models. Treat your total military package as the bar to beat.</p>';
    return;
  }
  const noBah = _n('dtLeaveBah') <= 0;
  box.innerHTML = `
    <div class="text-center pb-3 mb-3 border-b rule">
      <p class="text-xs text-navy-400 uppercase tracking-wide mb-1">Civilian salary needed to match today</p>
      <p class="text-3xl font-bold tabular-nums t-gold">${fmtCurrencyWhole(r.requiredSalary)}</p>
      <p class="text-xs text-navy-400 mt-1">gross, per year</p>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><p class="text-xs text-navy-400">Your take-home today</p><p class="text-base font-semibold tabular-nums text-navy-700">${fmtCurrencyWhole(r.militaryMonthlyNet)}/mo</p></div>
      <div><p class="text-xs text-navy-400">Tax-free allowances</p><p class="text-base font-semibold tabular-nums text-navy-700">${fmtCurrencyWhole(r.taxFreeAllowancesAnnual)}/yr</p></div>
      ${r.retiredPayAnnual > 0 ? `<div><p class="text-xs text-navy-400">Retired pay (continues)</p><p class="text-base font-semibold tabular-nums t-success">${fmtCurrencyWhole(r.retiredPayAnnual)}/yr</p></div>` : ''}
      ${r.employer401kMatchAnnual > 0 ? `<div><p class="text-xs text-navy-400">401(k) match (on top)</p><p class="text-base font-semibold tabular-nums text-navy-700">${fmtCurrencyWhole(r.employer401kMatchAnnual)}/yr</p></div>` : ''}
    </div>
    <p class="text-xs text-navy-500 mt-3 pt-3 border-t leading-relaxed rule">
      That is <strong class="t-gold">${fmtCurrencyWhole(Math.abs(r.premiumOverBasePay))}</strong> ${r.premiumOverBasePay >= 0 ? 'more' : 'less'} than your annual base pay${r.retiredPayAnnual > 0 ? ', after crediting the retired pay you keep receiving' : ''}.
      ${r.employer401kMatchAnnual > 0 ? ' The 401(k) match is listed separately on purpose — it is deferred compensation, not money in next month\'s budget, so it does not lower the salary you need.' : ''}
    </p>
    ${noBah ? '<p class="text-xs mt-2 rounded-lg p-2 chip-warn">You have no BAH entered, so this is almost certainly too low. BAH is usually the largest tax-free part of military pay — add it in your plan settings for a real number.</p>' : ''}`;
}

function recalcSBP() {
  const r = computeSBP({ baseAmount: _n('dtSbpBase'), retireeAge: _n('dtSbpRetAge') || 45, spouseAge: $('dtSbpSpouseAge').value ? _n('dtSbpSpouseAge') : null });
  $('dtSbpResult').innerHTML = r.monthlyPremium > 0 ? `
    <div class="grid grid-cols-2 gap-3">
      <div><p class="text-xs text-navy-400">Premium</p><p class="text-lg font-bold tabular-nums t-gold">${fmtCurrencyWhole(r.monthlyPremium)}/mo</p><p class="text-xs text-navy-400">${fmtCurrencyWhole(r.annualPremium)}/yr (pre-tax)</p></div>
      <div><p class="text-xs text-navy-400">Survivor annuity</p><p class="text-lg font-bold tabular-nums text-navy-700">${fmtCurrencyWhole(r.survivorMonthly)}/mo</p><p class="text-xs text-navy-400">55% of base, for life</p></div>
    </div>
    <div class="mt-3 pt-3 border-t rule">
      <p class="text-xs text-navy-500">Premiums until paid-up (later of 360 payments or age 70): <strong>${r.paidUpPayments} payments ≈ ${fmtCurrencyWhole(r.totalPremiums)}</strong>.</p>
      <p class="text-xs text-navy-500 mt-1">A survivor would recoup total premiums in ≈ <strong>${r.breakEvenYears} years</strong> of annuity — and SBP then continues for life with COLA.</p>
    </div>` : '<p class="text-navy-400">Enter an SBP base amount to estimate cost and survivor value.</p>';
}

function recalcCRSC() {
  const r = compareConcurrentReceipt({ grossRetiredPay: _n('dtCrGross'), vaRating: _n('dtCrRating'), combatRelatedPct: _n('dtCrCombat'), marginalRate: parseFloat($('dtCrBracket').value) || 0.22, yos: state.yos || 20 });
  if (r.vaComp <= 0) { $('dtCrResult').innerHTML = '<p class="text-navy-400">Select a VA rating above 0% to compare.</p>'; return; }
  const label = { baseline:'No restoration (offset applies)', crdp:'CRDP', crsc:'CRSC' }[r.recommend];
  const row = (name, val, note) => `<div class="flex items-center justify-between"><span class="text-navy-500">${name}</span><span class="font-semibold tabular-nums text-navy-700">${fmtCurrencyWhole(val)}/mo${note?` <span class='text-xs text-navy-400'>${note}</span>`:''}</span></div>`;
  $('dtCrResult').innerHTML = `
    <p class="text-xs text-navy-500 mb-2">VA comp ${fmtCurrencyWhole(r.vaComp)}/mo offsets ${fmtCurrencyWhole(r.waived)}/mo of retired pay (residual ${fmtCurrencyWhole(r.residualRetired)}/mo, taxable).</p>
    <div class="space-y-1">
      ${row('Net w/o CRDP/CRSC (after tax)', r.baselineNet)}
      ${r.crdpEligible ? row('Net with CRDP (taxable)', r.crdpNet) : '<div class="flex items-center justify-between"><span class="text-navy-500">CRDP</span><span class="text-xs text-navy-400">Not eligible (needs 20yr + 50%+)</span></div>'}
      ${r.crscAmount > 0 ? row('Net with CRSC (tax-free)', r.crscNet, `+${fmtCurrencyWhole(r.crscAmount)} tax-free`) : ''}
    </div>
    <p class="text-xs mt-2 rounded-lg px-3 py-2 chip-success">Best net take-home: <strong>${label}</strong>. You may receive only one — choose the higher net pay, not the higher gross.</p>`;
}

function recalcHealthcare() {
  const r = estimateRetireeHealthcareCost({ group: $('dtHcGroup').value, coverage: $('dtHcCoverage').value, annualRx: _n('dtHcRx'), fedvipMonthly: _n('dtHcFedvip') });
  $('dtHcResult').innerHTML = `
    <div class="flex items-center justify-between"><span class="text-navy-500">TRICARE Select enrollment fee</span><span class="font-semibold tabular-nums text-navy-700">${fmtCurrencyWhole(r.enrollmentFee)}/yr</span></div>
    <div class="flex items-center justify-between"><span class="text-navy-500">Pharmacy (est.)</span><span class="font-semibold tabular-nums text-navy-700">${fmtCurrencyWhole(r.annualRx)}/yr</span></div>
    <div class="flex items-center justify-between"><span class="text-navy-500">FEDVIP dental/vision</span><span class="font-semibold tabular-nums text-navy-700">${fmtCurrencyWhole(r.annualFedvip)}/yr</span></div>
    <div class="flex items-center justify-between mt-2 pt-2 border-t rule"><span class="font-semibold text-navy-700">Estimated total</span><span class="font-bold tabular-nums t-gold">${fmtCurrencyWhole(r.totalAnnual)}/yr (${fmtCurrencyWhole(r.monthlyEquivalent)}/mo)</span></div>`;
}

function recalcPrimeSelect() {
  const r = compareTricarePrimeSelect({ expectedVisits: $('dtPsVisits').value, valuesLowCost: $('dtPsLowCost').checked, needsFlexibility: $('dtPsFlex').checked });
  const recLabel = r.recommendation === 'either' ? 'Either could fit' : (r.recommendation === 'prime' ? 'Leans TRICARE Prime' : 'Leans TRICARE Select');
  const list = (arr) => arr.map(x => `<li>${x}</li>`).join('');
  $('dtPsResult').innerHTML = `
    <p class="text-sm font-semibold mb-2 t-gold">${recLabel}</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-navy-500">
      <div><p class="font-semibold text-navy-600 mb-1">Prime</p><ul class="list-disc pl-4 space-y-0.5">${list(r.primePros)}${list(r.primeCons)}</ul></div>
      <div><p class="font-semibold text-navy-600 mb-1">Select</p><ul class="list-disc pl-4 space-y-0.5">${list(r.selectPros)}${list(r.selectCons)}</ul></div>
    </div>`;
}

function recalcBestState() {
  const raw = $('dtStStates').value || '';
  const codes = raw.split(',').map(x => parseStateFromLocation(x.trim())).filter(Boolean);
  if (!codes.length) { $('dtStResult').innerHTML = '<p class="text-navy-400">Enter candidate states (e.g., TX, CA, VA) to compare lifetime tax on your pension.</p>'; return; }
  const ranked = compareStates([...new Set(codes)], _n('dtStPay'));
  const statusLabel = { exempt:'No / exempt', partial:'Partial', taxed:'Taxed' };
  $('dtStResult').innerHTML = `
    <table class="w-full text-xs">
      <thead><tr class="text-navy-400 text-left"><th class="py-1">State</th><th>Treatment</th><th class="text-right">Est. tax/yr</th></tr></thead>
      <tbody>${ranked.map((st,i) => `<tr class="${i===0?'font-semibold text-navy-700':'text-navy-500'}"><td class="py-1">${st.name}${i===0?' 🏆':''}</td><td>${statusLabel[st.status]||st.status}</td><td class="text-right tabular-nums">${fmtCurrencyWhole(st.estAnnualTax)}</td></tr>`).join('')}</tbody>
    </table>
    <p class="text-xs text-navy-400 mt-2">${ranked[0].name}: ${ranked[0].note}</p>`;
}

function recalcPPM() {
  const r = estimatePPM({ gcc: _n('dtPpmGcc'), expenses: _n('dtPpmExpenses') });
  $('dtPpmResult').innerHTML = r.incentive > 0 ? `
    <div class="flex items-center justify-between"><span class="text-navy-500">Incentive (100% of GCC)</span><span class="font-semibold tabular-nums text-navy-700">${fmtCurrencyWhole(r.incentive)}</span></div>
    <div class="flex items-center justify-between"><span class="text-navy-500">Less your expenses</span><span class="font-semibold tabular-nums text-navy-700">−${fmtCurrencyWhole(r.expenses)}</span></div>
    <div class="flex items-center justify-between"><span class="text-navy-500">Taxable profit</span><span class="font-semibold tabular-nums text-navy-700">${fmtCurrencyWhole(r.profit)}</span></div>
    <div class="flex items-center justify-between"><span class="text-navy-500">Est. 22% withholding</span><span class="font-semibold tabular-nums text-navy-700">−${fmtCurrencyWhole(r.taxWithheld)}</span></div>
    <div class="flex items-center justify-between mt-2 pt-2 border-t rule"><span class="font-semibold text-navy-700">Estimated net to you</span><span class="font-bold tabular-nums t-gold">${fmtCurrencyWhole(r.netProfit)}</span></div>` : '<p class="text-navy-400">Enter your Government Constructed Cost (GCC) to estimate PPM profit.</p>';
}

function recalcTSPRoll() {
  // A 0% advisory fee is a legitimate, meaningful input (self-directed/no-fee) — going
  // through _n() here would collapse it to the same 0 as an empty field and silently
  // override it to 1.0%, which inverts the keep-vs-roll recommendation.
  const advFee = numOr(parseFloat($('dtTspAdvFee')?.value), 1.0);
  const r = tspKeepVsRoll({ ageAtSeparation: _n('dtTspAge') || 45, tradBalance: _n('dtTspTrad'), rothBalance: _n('dtTspRoth'), advisoryFeePct: advFee, years: _n('dtTspYears') || 20 });
  $('dtTspResult').innerHTML = `
    <ul class="list-disc pl-4 space-y-1 text-xs text-navy-500">${r.flags.map(f => `<li>${f}</li>`).join('')}</ul>
    ${r.total > 0 ? `<p class="text-xs mt-3 pt-2 border-t rule">${
      // feeDrag is SIGNED. When the rolled-out option is genuinely cheaper the old
      // Math.max(0, …) floor printed "could cost roughly $0", hiding a real win.
      r.feeDrag >= 0
        ? `Over ${r.years} years, a ~${advFee}%/yr advisory fee vs. the TSP's ~0.05% could cost roughly <strong class="t-gold">${fmtCurrencyWhole(r.feeDrag)}</strong> in foregone growth (assuming ~6% returns).`
        : `Over ${r.years} years, a ~${advFee}%/yr fee is <em>lower</em> than the TSP's ~0.05%, so rolling out would leave you roughly <strong class="t-success">${fmtCurrencyWhole(Math.abs(r.feeDrag))}</strong> ahead on fees alone (assuming ~6% returns). Fees are only one factor — weigh the withdrawal rules above too.`
    }</p>` : ''}`;
}

// ===== INIT =====
// Apply a loaded plan (from the account or localStorage) and show results.
const RESUME_BANNER_DISMISS_KEY = 'mtc-resume-banner-dismissed';

function showResumeBanner(id, key) {
  if (sessionStorage.getItem(RESUME_BANNER_DISMISS_KEY) === id) return;
  const banner = $('resumePlanBanner');
  if (!banner) return;
  $('resumePlanLink').href = `/p/${id}${key ? '#k=' + key : ''}`;
  banner.classList.remove('hidden');
  $('dismissResumeBannerBtn').addEventListener('click', () => {
    banner.classList.add('hidden');
    try { sessionStorage.setItem(RESUME_BANNER_DISMISS_KEY, id); } catch { /* ignore */ }
  }, { once: true });
  afterRender();
}

function applyLoadedPlan(plan) {
  // Plans loaded from a shared /p/<id> link or the local cache are untrusted input —
  // the server stores whatever JSON it's handed (see src/routes/plan.ts), so a shared
  // link is a viable XSS delivery path unless every field is allow-listed here before
  // it ever reaches a render function. Also escapeHtml at every innerHTML sink below
  // (defense-in-depth) — this check must not be the only thing standing in the way.
  if (!isValidState(plan)) { showToast('That plan link contains invalid data and was not loaded.'); return; }
  state = plan;
  // The countdown is relative to the viewer's actual "now", not a date frozen into a
  // plan saved on a prior day (or shared by someone else). Refresh it on every load;
  // also repairs a missing/malformed todayDate that would otherwise render NaN.
  state.todayDate = todayLocalStr();
  // Defense-in-depth: coerce day fields to safe integers so a malformed loaded plan
  // can never reach an innerHTML sink as a string (see escapeHtml + isValidState).
  const toInt = (v, dflt, lo, hi) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? clamp(n, lo, hi) : dflt; };
  state.sbDays = toInt(state.sbDays, 0, 0, 180);
  state.ptdyDays = toInt(state.ptdyDays, 0, 0, 30);
  state.leaveDays = toInt(state.leaveDays, 60, 0, 120);
  state.payBasePay = Number.isFinite(+state.payBasePay) ? Math.max(0, +state.payBasePay) : 0;
  toggles.ptdy = state.ptdy;
  toggles.sb = state.sb;
  toggles.giBill = state.giBill || false;
  toggles.vaClaim = state.vaClaim || false;
  toggles.married = state.married || false;
  toggles.homeowner = state.homeowner || false;
  toggles.clearance = state.clearance || false;
  toggles.federalJob = state.federalJob || false;
  toggles.oconus = state.oconus || false;
  rankCat = state.rankCat;
  transType = state.transType;
  payRetSystem = state.payRetSystem || 'high3';
  selectedVARating = state.selectedVARating || 0;
  hasDependents = state.hasDependents || false;
  tspWithdrawalMethod = state.tspWithdrawalMethod || 'fixed';
  tspContribMode = state.tspContribMode || 'fixed';
  state.checks = migrateChecks(state.checks, state);
  showResults();
  renderPlanLink();
}

async function init() {
  const todayStr = todayLocalStr();
  $('todayDate').value = todayStr;

  initToggle('ptdyToggle', 'ptdy', 'Taking Permissive TDY?');
  initToggle('sbToggle', 'sb', 'Taking SkillBridge?');
  initToggle('giBillToggle', 'giBill', 'Planning to use GI Bill?');
  initToggle('vaClaimToggle', 'vaClaim', 'Planning to file VA disability?');
  initToggle('marriedToggle', 'married', 'Married / have a spouse?');
  initToggle('homeownerToggle', 'homeowner', 'Own (or buying) a home?');
  initToggle('clearanceToggle', 'clearance', 'Hold a security clearance?');
  initToggle('federalJobToggle', 'federalJob', 'Pursuing federal employment?');
  initToggle('oconusToggle', 'oconus', 'Retiring from an OCONUS station?');

  initRadioGroup('rankCatGroup', val => { rankCat = val; populateRanks(); });
  initRadioGroup('transTypeGroup', val => { transType = val; });

  $('branch').addEventListener('change', () => { populateRanks(); });
  $('rank').addEventListener('change', () => { updateSkillbridgeLimit(); });
  $('sbDays').addEventListener('input', () => { updateSbEditFeedback(); });

  $('setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate()) {
      const invalid = $$('[aria-invalid="true"]');
      const fs = $('form-status');
      if (fs) fs.textContent = `${invalid.length} field${invalid.length === 1 ? '' : 's'} need attention — please review the highlighted fields.`;
      const first = invalid[0];
      if (first && typeof first.focus === 'function') first.focus();
      return;
    }
    if ($('form-status')) $('form-status').textContent = '';
    const prevChecks = (state && state.checks) || {};
    state = buildState();
    state.checks = prevChecks; // keep checklist progress across edits
    showResults();
    if (store.isReadOnly()) {
      renderPlanLink(); // viewing a shared plan — local edits only, can't save
    } else if (store.hasPlan()) {
      saveState(state); // editing an existing plan → update it
      renderPlanLink();
    } else if (sampleMode) {
      // Submitting the form is an explicit "this is mine now" — leave demo mode so the
      // plan is really created and cached.
      sampleMode = false;
      $('sampleModeBanner')?.classList.add('hidden');
      const created = await store.createPlan(state);
      history.replaceState(null, '', created ? `/p/${created.id}#k=${created.editKey}` : (location.pathname + location.search));
      renderPlanLink();
      if (created) showFirstSaveModal();
      else showToast('Saved in this browser — couldn\'t create an online link');
    } else {
      // Brand-new plan → create it server-side to mint the shareable link.
      const created = await store.createPlan(state);
      history.replaceState(null, '', created ? `/p/${created.id}#k=${created.editKey}` : (location.pathname + location.search));
      renderPlanLink();
      // The link IS the account: no email, no password, no recovery. Announcing that with a
      // 2.5-second toast — the same treatment as "Link copied!" — was badly mismatched to
      // the consequence of missing it. This is the one moment where an interruption is
      // warranted, and it offers copy + download before letting the user move on.
      if (created) showFirstSaveModal();
      else showToast('Saved in this browser — couldn\'t create an online link');
    }
  });

  $('editBtn').addEventListener('click', () => {
    showSetup();
    if (state.firstName) $('firstName').value = state.firstName;
    if (state.branch) $('branch').value = state.branch;
    if (state.rankCat) {
      rankCat = state.rankCat;
      $$('#rankCatGroup .radio-card').forEach(c => { const on = c.dataset.value === rankCat; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
      populateRanks();
      if (state.rank) setTimeout(() => {
        $('rank').value = state.rank;
        updateSkillbridgeLimit(); // resets sbDays to the rank's auto-max…
        // …so restore the user's saved value AFTER it, or the custom value is clobbered.
        if (state.sb && state.sbDays !== undefined) { $('sbDays').value = state.sbDays; updateSbEditFeedback(); }
      }, 50);
    }
    if (state.yos) $('yos').value = state.yos;
    if (state.dateOfRank) $('dateOfRank').value = state.dateOfRank;
    if (state.transType) {
      transType = state.transType;
      $$('#transTypeGroup .radio-card').forEach(c => { const on = c.dataset.value === transType; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
    }
    if (state.sepDate) $('sepDate').value = state.sepDate;
    // "Today's Date" is auto-set to the real current date; don't restore a stale saved value.
    $('todayDate').value = todayLocalStr();
    if (state.leaveDays !== undefined) $('leaveDays').value = state.leaveDays;
    if (state.bah !== undefined) $('bah').value = state.bah;
    toggles.ptdy = !!state.ptdy;
    $('ptdyToggle').classList.toggle('active', toggles.ptdy);
    $('ptdyToggle').setAttribute('aria-checked', String(toggles.ptdy));
    $('ptdyFields').classList.toggle('hidden', !toggles.ptdy);
    if (state.ptdyDays) $('ptdyDays').value = state.ptdyDays;
    toggles.sb = !!state.sb;
    $('sbToggle').classList.toggle('active', toggles.sb);
    $('sbToggle').setAttribute('aria-checked', String(toggles.sb));
    $('sbFields').classList.toggle('hidden', !toggles.sb);
    // Restore for the no-deferred path (no rank); when rank is set the deferred callback
    // above re-restores after updateSkillbridgeLimit(). Both guard on state.sb.
    if (state.sb && state.sbDays !== undefined) $('sbDays').value = state.sbDays;
    if (state.postLocation) $('postLocation').value = state.postLocation;
    if (state.careerInterest) $('careerInterest').value = state.careerInterest;
    toggles.giBill = !!state.giBill;
    $('giBillToggle').classList.toggle('active', toggles.giBill);
    $('giBillToggle').setAttribute('aria-checked', String(toggles.giBill));
    toggles.vaClaim = !!state.vaClaim;
    $('vaClaimToggle').classList.toggle('active', toggles.vaClaim);
    $('vaClaimToggle').setAttribute('aria-checked', String(toggles.vaClaim));
    [['married','marriedToggle'],['homeowner','homeownerToggle'],['clearance','clearanceToggle'],['federalJob','federalJobToggle'],['oconus','oconusToggle']].forEach(([key, id]) => {
      toggles[key] = state[key] || false;
      const el = $(id);
      if (el) { el.classList.toggle('active', toggles[key]); el.setAttribute('aria-checked', String(toggles[key])); }
    });
  });

  // Remember which collapsibles were actually open before printing forces them all
  // open, so `afterprint` can put the screen back the way the visitor left it instead
  // of just slamming everything shut. Goes through the same setCollapsibleOpen /
  // setPhaseOpen helpers as normal toggling so aria-expanded and inert stay correct.
  let printPrevOpen = null;
  $('printBtn').addEventListener('click', () => {
    const phaseHeaders = [...$$('.phase-header')];
    printPrevOpen = {
      top: TOP_COLLAPSIBLES.map(([, contentId]) => $(contentId).classList.contains('open')),
      phase: phaseHeaders.map(h => $('content-' + h.dataset.phase).classList.contains('open')),
    };
    TOP_COLLAPSIBLES.forEach(([hId, cId, chId]) => setCollapsibleOpen(hId, cId, chId, true));
    phaseHeaders.forEach(h => setPhaseOpen(h, true));
    printAllCalendarMonths();
    setTimeout(() => window.print(), 200);
  });

  window.addEventListener('afterprint', () => {
    if (printPrevOpen) {
      TOP_COLLAPSIBLES.forEach(([hId, cId, chId], i) => setCollapsibleOpen(hId, cId, chId, printPrevOpen.top[i]));
      [...$$('.phase-header')].forEach((h, i) => setPhaseOpen(h, printPrevOpen.phase[i]));
      printPrevOpen = null;
    }
    renderCalendarPage(); // restore the single-month view the print export bypassed
  });

  // Data provenance line in the footer.
  $('dataVintage').textContent = `Figures current as of ${DATA_VINTAGE.asOf}. ${DATA_VINTAGE.basePay}; ${DATA_VINTAGE.vaRates}; ${DATA_VINTAGE.stateTax}.`;

  function downloadBlob(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ----- plan links: edit (private) vs read-only (safe to share) -----
  function copyText(text, okMsg) {
    if (!text) { showToast('Build your plan first'); return; }
    navigator.clipboard.writeText(text).then(() => showToast(okMsg)).catch(() => showToast('Could not copy link'));
  }
  const copyEditLink = () => copyText(store.getEditUrl(), 'Edit link copied — keep it private');
  const copyViewLink = () => copyText(store.getViewUrl(), 'Read-only link copied');
  $('copyEditLinkBtn').addEventListener('click', copyEditLink);
  $('headerLinkBtn').addEventListener('click', copyEditLink);
  $('copyViewLinkBtn').addEventListener('click', copyViewLink);
  $('copyLinkBtn').addEventListener('click', copyViewLink); // footer button shares the read-only link
  $('toggleLinkVisibilityBtn').addEventListener('click', () => {
    planLinkVisible = !planLinkVisible;
    $('toggleLinkVisibilityBtn').textContent = planLinkVisible ? 'Hide' : 'Show';
    renderPlanLink();
  });

  // Demo mode: render a fully populated plan without creating or caching anything. Critically
  // it never calls saveState/cacheSave, so browsing the sample can't clobber a returning
  // visitor's own cached plan (or its edit key).
  $('samplePlanBtn').addEventListener('click', () => {
    const today = new Date();
    const sep = new Date(today.getFullYear() + 1, today.getMonth() + 4, 1);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    sampleMode = true;
    store.configure({ id: null, key: null }); // no plan, no writes
    applyLoadedPlan({
      firstName: 'Sam', branch: 'Army', rankCat: 'E', rank: 'E-7 Sergeant First Class',
      yos: 21, dateOfRank: iso(new Date(today.getFullYear() - 4, 5, 1)),
      transType: 'Retirement', sepDate: iso(sep), todayDate: todayLocalStr(),
      leaveDays: 60, bah: 2400, ptdy: true, ptdyDays: 20, sb: true, sbDays: 90,
      postLocation: 'San Antonio, TX 78205', careerInterest: 'Defense/Government Contracting',
      giBill: true, vaClaim: true, married: true, homeowner: true, clearance: true,
      federalJob: false, oconus: false, payRetSystem: 'high3', selectedVARating: 50,
      hasDependents: true, tspBalance: 320000, tspRate: 6, tspContribMode: 'fixed',
      tspContribution: 800, tspContribPct: 5, tspRetAge: 60, tspWithdrawalMethod: 'fixed',
      tspFixedAmount: 1500,
    });
    $('sampleModeBanner')?.classList.remove('hidden');
    announce('Showing a sample transition plan. Nothing has been saved.', 300);
  });
  $('exitSampleBtn')?.addEventListener('click', () => { location.href = '/'; });

  // Subscribable calendar feed — unlike the one-shot .ics download, this URL is re-fetched
  // by the calendar client, so a slipped separation date moves every deadline for them too.
  $('subscribeCalBtn').addEventListener('click', () => {
    const id = store.getStatus().planId;
    if (!id) { showToast('Build your plan first'); return; }
    const box = $('subscribeCalBox');
    const url = `${location.origin}/p/${id}/calendar.ics`;
    $('subscribeCalInput').value = url;
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) $('subscribeCalInput').focus();
  });
  $('copyCalUrlBtn').addEventListener('click', () => copyText($('subscribeCalInput').value, 'Calendar URL copied'));

  // Permanent deletion. Two-step by design: this is irreversible, there is no backup, and
  // no email to recover from — so the confirm names the plan and the button is destructive.
  $('deletePlanBtn').addEventListener('click', async () => {
    const ok = confirm(
      `Permanently delete this plan from the server?\n\n` +
      `• The link ${store.getViewUrl() || ''} will stop working for everyone, including anyone you shared it with.\n` +
      `• This cannot be undone — there is no backup and no account to recover from.\n` +
      `• Download a Backup first if you want to keep a copy.\n\n` +
      `Press OK to delete.`
    );
    if (!ok) return;
    const deleted = await store.deletePlan();
    if (deleted) {
      showToast('Plan deleted');
      setTimeout(() => { location.href = '/'; }, 800);
    } else {
      showToast("Couldn't delete — check your connection and try again");
    }
  });
  $('makeCopyBtn').addEventListener('click', async () => {
    if (!state.firstName) { showToast('Nothing to copy yet'); return; }
    const created = await store.createPlan(state);
    if (created) location.href = `/p/${created.id}#k=${created.editKey}`; // reload into your own editable copy
    else showToast('Could not create a copy — check your connection');
  });

  // Calendar (.ics) export of every milestone.
  $('icsBtn').addEventListener('click', () => {
    if (!lastMilestones.length) { showToast('Build your plan first'); return; }
    const ics = buildICS(lastMilestones, { calName: (state.firstName || 'My') + ' Transition Plan', now: new Date() });
    downloadBlob('transition-plan.ics', ics, 'text/calendar');
    showToast('Calendar file downloaded');
  });

  // JSON backup / restore.
  $('backupBtn').addEventListener('click', downloadBackup);
  $('importBtn').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    let obj = null;
    try { obj = JSON.parse(await file.text()); } catch { showToast('Could not read backup'); $('importInput').value = ''; return; }
    $('importInput').value = '';
    if (!isValidState(obj)) { showToast('Invalid backup file'); return; }
    applyLoadedPlan(obj);
    // Mirror the submit flow: overwrite the current plan, or mint a new link for a fresh one.
    if (store.isReadOnly()) {
      renderPlanLink();
    } else if (store.hasPlan()) {
      saveState(obj);
      renderPlanLink();
    } else {
      const created = await store.createPlan(obj);
      history.replaceState(null, '', created ? `/p/${created.id}#k=${created.editKey}` : (location.pathname + location.search));
      renderPlanLink();
    }
    showToast('Plan restored');
  });


  // Every collapsible section header (Pay Estimator, Calendar, Decision Tools, Things
  // to Think About) shares this behavior: click OR Enter/Space toggles it, aria-expanded
  // tracks the visible state for screen readers, and the content is marked `inert`
  // while collapsed so its buttons/inputs aren't reachable by Tab — `max-height:0`
  // alone hides it visually but leaves it fully focusable.
  const TOP_COLLAPSIBLES = [
    ['payEstimatorHeader', 'payEstimatorContent', 'payChevron'],
    ['calendarHeader', 'calendarContent', 'calendarChevron'],
    ['decisionToolsHeader', 'decisionToolsContent', 'decisionToolsChevron'],
    ['thinkAboutHeader', 'thinkAboutContent', 'thinkChevron'],
  ];
  function setCollapsibleOpen(headerId, contentId, chevronId, open) {
    const header = $(headerId), content = $(contentId), chevron = $(chevronId);
    if (!header || !content) return;
    content.classList.toggle('open', open);
    header.setAttribute('aria-expanded', String(open));
    if (open) content.removeAttribute('inert'); else content.setAttribute('inert', '');
    if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
  }
  function wireCollapsible(headerId, contentId, chevronId) {
    const header = $(headerId), content = $(contentId);
    if (!header || !content) return;
    setCollapsibleOpen(headerId, contentId, chevronId, content.classList.contains('open'));
    const toggle = () => setCollapsibleOpen(headerId, contentId, chevronId, !content.classList.contains('open'));
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggle(); }
    });
  }
  TOP_COLLAPSIBLES.forEach(([hId, cId, chId]) => wireCollapsible(hId, cId, chId));

  $('calPrevBtn').addEventListener('click', () => calNavigate(-1));
  $('calNextBtn').addEventListener('click', () => calNavigate(1));
  $('calTodayBtn').addEventListener('click', () => calJumpToToday());

  // Decision tools: live recompute on any input change
  // Scenario comparison. Deliberately NOT persisted: it is a what-if, and saving it would
  // make "the plan" ambiguous. Picking a date auto-fills the years of service that date
  // implies, but leaves the field editable for anyone whose service computation date differs.
  const scenarioDate = $('scenarioDate');
  const scenarioYos = $('scenarioYos');
  if (scenarioDate) {
    scenarioDate.addEventListener('change', () => {
      const d = new Date(scenarioDate.value + 'T00:00:00');
      if (!isNaN(d.getTime())) scenarioYos.value = String(scenarioDefaultYos(d));
      renderScenario();
    });
    scenarioYos.addEventListener('input', renderScenario);
    $('scenarioResetBtn').addEventListener('click', () => {
      scenarioDate.value = '';
      scenarioYos.value = '';
      renderScenario();
    });
  }

  const dtRecalc = () => { recalcAllTools(); persistTools(); };
  $('decisionToolsContent').addEventListener('input', dtRecalc);
  $('decisionToolsContent').addEventListener('change', dtRecalc);

  $('jumpToPayBtn').addEventListener('click', () => {
    $('payEstimatorSection').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    setCollapsibleOpen('payEstimatorHeader', 'payEstimatorContent', 'payChevron', true);
  });

  initRadioGroup('payRetSystemGroup', val => { payRetSystem = val; recalcPayEstimator(); });
  $('payBasePay').addEventListener('input', () => { recalcPayEstimator(); });
  $('payYOS').addEventListener('input', () => { recalcPayEstimator(); });

  $('vaRatingBtns').addEventListener('click', (e) => {
    const btn = e.target.closest('.va-rating-btn');
    if (!btn) return;
    selectedVARating = parseInt(btn.dataset.rating);
    $$('.va-rating-btn', $('vaRatingBtns')).forEach(b => { const on = parseInt(b.dataset.rating) === selectedVARating; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    recalcPayEstimator();
  });

  (() => {
    const dep = $('depToggle');
    dep.setAttribute('role', 'switch');
    dep.setAttribute('tabindex', '0');
    dep.setAttribute('aria-label', 'I have dependents');
    dep.setAttribute('aria-checked', String(hasDependents));
    const fire = () => {
      hasDependents = !hasDependents;
      dep.classList.toggle('active', hasDependents);
      dep.setAttribute('aria-checked', String(hasDependents));
      $('depNote').classList.toggle('hidden', !hasDependents);
      if (state.firstName) { state.hasDependents = hasDependents; saveState(state); }
    };
    dep.addEventListener('click', fire);
    dep.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fire(); } });
  })();

  // ===== TSP EVENTS =====
  $('tspBalance').addEventListener('input', () => { recalcPayEstimator(); });
  $('tspYearsToRet').addEventListener('input', () => { recalcPayEstimator(); });
  $('tspRate').addEventListener('input', () => {
    $('tspRateDisplay').textContent = $('tspRate').value + '%';
    recalcPayEstimator();
  });
  $('tspContribution').addEventListener('input', () => { recalcPayEstimator(); });
  $('tspContribPct').addEventListener('input', () => { recalcPayEstimator(); });
  $('tspRetAge').addEventListener('input', () => { recalcPayEstimator(); });
  $('tspFixedAmount').addEventListener('input', () => { recalcPayEstimator(); });

  // TSP contribution mode radio (keyboard-accessible via initRadioGroup)
  initRadioGroup('tspContribModeGroup', (val) => {
    tspContribMode = val;
    $('tspContribFixedField').classList.toggle('hidden', tspContribMode !== 'fixed');
    $('tspContribPctField').classList.toggle('hidden', tspContribMode !== 'pct');
    recalcPayEstimator();
  });

  // TSP withdrawal method radio (uses .tsp-withdrawal-card, also keyboard-accessible)
  initRadioGroup('tspWithdrawalGroup', (val) => {
    tspWithdrawalMethod = val;
    $('tspFixedFields').style.display = tspWithdrawalMethod === 'fixed' ? '' : 'none';
    recalcPayEstimator();
  }, '.tsp-withdrawal-card');

  // Date of Rank live update
  $('dateOfRank').addEventListener('change', () => {
    // Update dorResultBox on the setup form if data is available
    const dorVal = $('dateOfRank').value;
    const todayVal = $('todayDate').value;
    const sepVal = $('sepDate').value;
    const rankVal = $('rank').value;
    const rg = getRankGrade(rankVal);
    const dorBox = $('dorResultBox');
    if (dorVal && todayVal) {
      const dorDate = new Date(dorVal + 'T00:00:00');
      const todayDate = new Date(todayVal + 'T00:00:00');
      const tigDays = Math.max(0, daysBetween(dorDate, todayDate));
      const tigYears = (tigDays / 365.25).toFixed(1);
      if (dorBox) {
        dorBox.classList.remove('hidden');
        $('dorYearsDisplay').textContent = `${tigYears} years at ${rg || 'current grade'}`;
        if (sepVal) {
          const sepDate = new Date(sepVal + 'T00:00:00');
          const tigAtSep = (daysBetween(dorDate, sepDate) / 365.25).toFixed(1);
          $('dorPayHint').textContent = `Time in grade at retirement: ${tigAtSep} years.`;
        }
      }
    } else {
      if (dorBox) dorBox.classList.add('hidden');
    }
  });

  // Surfaces store.js's save state instead of leaving a failed save completely
  // silent — the plan is always safe in localStorage either way, but the visitor
  // should know when the SERVER copy (the one the shareable link points at) is stale.
  store.onChange((s) => {
    const el = $('saveStatus');
    if (!el || s.readOnly || !s.planId) { if (el) el.textContent = ''; return; }
    const labels = {
      pending: '<i data-lucide="loader-circle" class="w-3.5 h-3.5 animate-spin"></i> Saving…',
      saving: '<i data-lucide="loader-circle" class="w-3.5 h-3.5 animate-spin"></i> Saving…',
      saved: '<i data-lucide="check" class="w-3.5 h-3.5 t-success-bright"></i> Saved',
      conflict: '<i data-lucide="alert-triangle" class="w-3.5 h-3.5 t-warn"></i> Resolving conflict…',
    };
    if (s.saveState === 'error') {
      // A failed save is now RECOVERABLE rather than a red word the user can do nothing
      // about: store.js retries with backoff on its own, and this offers an explicit retry.
      el.innerHTML = s.retryScheduled
        ? '<i data-lucide="loader-circle" class="w-3.5 h-3.5 animate-spin t-warn"></i> Couldn\'t save — retrying…'
        : '<i data-lucide="cloud-off" class="w-3.5 h-3.5 t-danger-bright"></i> Couldn\'t save — kept in this browser <button type="button" id="saveRetryBtn" class="underline font-semibold ml-1 hover:no-underline">Retry</button>';
    } else {
      el.innerHTML = labels[s.saveState] || '';
    }
    el.classList.toggle('text-danger-500', s.saveState === 'error' && !s.retryScheduled);
    // Only TERMINAL states are announced — never the transient "Saving…" churn.
    if (s.saveState === 'saved') announce('Plan saved.', 1500);
    else if (s.saveState === 'error' && !s.retryScheduled) announce("Couldn't save your plan to the server. It is kept in this browser. A Retry button is available next to the plan title.", 400);
    const retryBtn = $('saveRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => { if (state) store.retryNow(state); });
    afterRender();
  });

  // Don't let the tab close over an edit that never reached the server. The plan is safe in
  // localStorage, but only in THIS browser — closing here and reopening the link elsewhere
  // would silently show the older version.
  window.addEventListener('beforeunload', (e) => {
    if (store.hasUnsavedWork()) { e.preventDefault(); e.returnValue = ''; }
  });

  // Concurrent-edit (multi-tab / multi-device) conflict resolution.
  store.onConflict(async (serverPlan, meta) => {
    // Two destructive branches used to hide behind OK/Cancel, with no information to decide
    // by — and dismissing the dialog (Escape, or a browser that suppresses confirm()) fell
    // through to "theirs", silently discarding the user's unsaved edits. Both options are
    // now named explicitly, dismissal is a no-op, and we show WHEN the other version was
    // saved so the choice is informed.
    const otherSaved = meta && meta.updated_at
      ? new Date(meta.updated_at * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
      : null;
    const choice = await showModal({
      title: 'This plan was changed somewhere else',
      bodyHtml: `
        <p>Your plan was edited in another tab or on another device${otherSaved ? `, saved <strong>${escapeHtml(otherSaved)}</strong>` : ''}. Only one version can be kept.</p>
        <p class="text-xs text-navy-400">Whichever you discard cannot be recovered. If you're unsure, cancel and download a backup first.</p>`,
      actions: [
        { value: 'mine', label: 'Keep this tab’s version', style: 'primary' },
        { value: 'theirs', label: 'Load the other version' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });
    if (choice === 'mine') return 'mine';
    if (choice === 'theirs') {
      if (serverPlan && serverPlan.firstName && serverPlan.sepDate) {
        applyLoadedPlan(serverPlan);
        showToast('Loaded the latest version of your plan');
      }
      return 'theirs';
    }
    // Dismissed / cancelled: change nothing. The edit stays in this tab and in localStorage,
    // and the save indicator keeps showing that it hasn't reached the server.
    return 'cancel';
  });

  // Resolve which plan to load. A direct /p/<id> link always loads that plan. At the root
  // path we deliberately do NOT auto-redirect a returning visitor into their saved plan —
  // we just surface a dismissible "Resume my plan" banner and let them choose.
  const pathMatch = location.pathname.match(/^\/p\/([A-Za-z0-9_-]+)\/?$/);
  if (pathMatch) {
    const id = pathMatch[1];
    const km = location.hash.match(/[#&]k=([A-Za-z0-9_-]+)/);
    const key = km ? km[1] : null;
    store.configure({ id, key });
    // A returning visitor used to stare at the blank setup form for the whole fetch, then
    // get a 2.5-second toast. Show that we're loading, and render the outcome as something
    // persistent they can act on.
    showPlanLoading(true);
    const res = await store.loadRemote();
    showPlanLoading(false);
    const usable = (p) => p && p.firstName && p.sepDate;
    if (res.status === 'ok' && usable(res.plan)) {
      applyLoadedPlan(res.plan);
      if (res.recoveredLocal) {
        showPlanLoadError({
          title: 'Recovered a newer version from this browser',
          body: 'An edit made here never reached the server — probably a dropped connection. The newer version is loaded. Make any change to push it back up.',
          tone: 'warn',
        });
      }
    } else {
      // Fall back to the cache only if it's the SAME plan.
      const cached = store.getCached();
      if (cached && cached.id === id && usable(cached.plan)) {
        applyLoadedPlan(cached.plan);
        if (res.status !== 'ok') {
          showPlanLoadError({
            title: res.status === 'offline' ? "You're offline — showing your saved copy" : 'Could not reach the server — showing your saved copy',
            body: 'This is the version stored in this browser. Reconnect and edit anything to sync it back up.',
            tone: 'warn',
          });
        }
      } else if (res.status === 'offline') {
        // Critically NOT "this plan doesn't exist" — the plan is probably fine; the network isn't.
        showPlanLoadError({
          title: "Couldn't load this plan — you appear to be offline",
          body: 'Your plan is still there. Check your connection and try again.',
          tone: 'error', retry: true,
        });
      } else if (res.status === 'not_found') {
        showPlanLoadError({
          title: 'That plan link could not be found',
          body: 'The link may be mistyped or incomplete, or the plan may have been deleted. Check the full link — the part after #k= matters. You can also start a new plan below.',
          tone: 'error',
        });
      } else {
        showPlanLoadError({
          title: "Couldn't load this plan",
          body: 'The server returned an error. Please try again in a moment.',
          tone: 'error', retry: true,
        });
      }
    }
  } else {
    const cached = store.getCached();
    if (cached && cached.id && cached.plan && cached.plan.firstName && cached.plan.sepDate) {
      showResumeBanner(cached.id, cached.editKey);
    } else if (cached && !cached.id && cached.plan && cached.plan.firstName && cached.plan.sepDate) {
      // Never made it to the server (e.g., create failed while offline) — no link to offer, so recover it directly.
      applyLoadedPlan(cached.plan);
    }
  }

  updateSkillbridgeLimit();
}

// Paint the icons already present in the static markup. No guard needed: the path data is
// imported, not fetched, so it is always available by the time this module runs.
afterRender();

init();
