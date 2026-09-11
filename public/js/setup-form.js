// ===== setup-form.js =====
// The setup screen: branch/rank data, toggles and radio groups, SkillBridge auto-population,
// validation, and the form <-> plan state round trip (buildState / restoreFormFromState).

import {
  SKILLBRIDGE_LIMITS, daysBetween, clamp, getRankGrade, isValidState
} from '/js/calc.js';
import { ui } from '/js/ui-state.js';
import { $, todayLocalStr, numOr, $$, $1, scrollBehavior } from '/js/dom.js';
import { applyLoadedPlan } from '/js/plan-io.js';
import { showSetup } from '/js/results.js';

export const BRANCH_META = {
  'Army':        { color:'#2d6a4f', emoji:'⭐', terms:{ spec:'MOS', member:'Soldier', nco:'NCO' }},
  'Navy':        { color:'#1a2744', emoji:'⚓', terms:{ spec:'Rate/NEC', member:'Sailor', nco:'Petty Officer' }},
  'Air Force':   { color:'#3468b0', emoji:'✈️', terms:{ spec:'AFSC', member:'Airman', nco:'NCO' }},
  'Marine Corps':{ color:'#b91c1c', emoji:'🦅', terms:{ spec:'MOS', member:'Marine', nco:'NCO' }},
  'Space Force': { color:'#1e3f6e', emoji:'🛸', terms:{ spec:'AFSC', member:'Guardian', nco:'NCO' }},
  'Coast Guard': { color:'#c2410c', emoji:'🔱', terms:{ spec:'Rating', member:'Member', nco:'Petty Officer' }},
};

export const RANKS = {
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











export let sbAutoMax = null;

// ===== SKILLBRIDGE AUTO-POPULATE =====
export function updateSkillbridgeLimit() {
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

  if (!ui.toggles.sb) {
    badge.classList.add('is-hidden');
    sbAutoMax = null;
    policyNote.innerHTML = 'ℹ️ Select your branch and rank above to auto-populate your authorized SkillBridge days.';
    policyNote.className = 'sb-policy-note mt-1 text-sm text-navy-400';
    return;
  }

  if (!branch || !rg) {
    sbInput.value = 90;
    sbInput.max = 180;
    sbAutoMax = null;
    badge.classList.add('is-hidden');
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
    policyNote.innerHTML = '✅ <strong>Auto-set to ' + maxDays + ' days</strong> — this is the authorized maximum for ' + rg + ' in the ' + branch + ' per current DoD SkillBridge policy. Your actual duration is subject to leadership approval and may be fewer days. You may edit this field.';
    policyNote.className = 'sb-policy-note mt-1 text-sm rounded-lg px-3 py-2 note-success';
  } else if (branch === 'Coast Guard') {
    sbInput.value = 120;
    sbInput.max = 180;
    sbAutoMax = null;
    badge.textContent = '✎ Manual entry';
    badge.className = 'sb-badge sb-badge-manual';
    policyNote.innerHTML = 'ℹ️ Coast Guard SkillBridge limits vary — please confirm with your command. Default set to 120 days. You may edit this field.';
    policyNote.className = 'sb-policy-note mt-1 text-sm rounded-lg px-3 py-2 note-info note-info-text';
  } else if (rg === 'E-1') {
    sbInput.value = 0;
    sbAutoMax = 0;
    badge.textContent = '⚠ Not eligible';
    badge.className = 'sb-badge sb-badge-manual';
    policyNote.innerHTML = '⚠️ E-1 members are generally not eligible for SkillBridge. Please verify eligibility with your command.';
    policyNote.className = 'sb-policy-note mt-1 text-sm rounded-lg px-3 py-2 note-warn note-warn-alt';
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
    policyNote.innerHTML = 'ℹ️ SkillBridge eligibility for ' + rg + ' in the ' + branch + ' — please confirm limits with your command. Field is editable.';
    policyNote.className = 'sb-policy-note mt-1 text-sm rounded-lg px-3 py-2 note-info note-info-text';
  }
}

export function updateSbEditFeedback() {
  const editFeedback = $('sbEditFeedback');
  const overMaxError = $('sbOverMaxError');
  const sbInput = $('sbDays');
  const enteredVal = parseInt(sbInput.value);

  editFeedback.classList.remove('show');
  editFeedback.innerHTML = '';
  overMaxError.classList.remove('show');
  overMaxError.innerHTML = '';

  if (!ui.toggles.sb || sbAutoMax === null || sbAutoMax === 0 || isNaN(enteredVal)) return;

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
      editFeedback.className = 'sb-edit-feedback rounded-lg px-3 py-2 text-sm note-warn note-warn-alt show';
    }
  }
}


// ===== TOGGLE LOGIC =====
export function initToggle(id, key, label) {
  const el = $(id);
  el.setAttribute('role', 'switch');
  el.setAttribute('tabindex', '0');
  if (label) el.setAttribute('aria-label', label);
  el.setAttribute('aria-checked', String(!!ui.toggles[key]));
  const fire = () => {
    ui.toggles[key] = !ui.toggles[key];
    el.classList.toggle('active', ui.toggles[key]);
    el.setAttribute('aria-checked', String(ui.toggles[key]));
    if (key === 'ptdy') $('ptdyFields').classList.toggle('hidden', !ui.toggles[key]);
    if (key === 'sb') {
      $('sbFields').classList.toggle('hidden', !ui.toggles[key]);
      if (ui.toggles[key]) updateSkillbridgeLimit();
    }
  };
  el.addEventListener('click', fire);
  el.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fire(); } });
}

// ===== RADIO GROUP =====
// Implements the ARIA radio-group pattern's roving tabindex: only the checked option
// (or the first, if none is checked yet) is a Tab stop; Left/Right/Up/Down move
// between options the way a screen reader user expects from role="radio".
export function initRadioGroup(containerId, cb, cardSelector = '.radio-card') {
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
export function populateRanks() {
  const sel = $('rank');
  const branch = $('branch').value;
  sel.innerHTML = '<option value="">Select rank…</option>';
  if (!ui.rankCat || !branch) { updateSkillbridgeLimit(); return; }
  const warnNote = $('warrant-note');
  if (ui.rankCat === 'W' && (branch === 'Air Force' || branch === 'Space Force')) {
    warnNote.classList.remove('hidden');
    updateSkillbridgeLimit();
    return;
  }
  warnNote.classList.add('hidden');
  let list;
  if (ui.rankCat === 'O') {
    list = RANKS.O[branch] || RANKS.O['_all'];
  } else {
    list = (RANKS[ui.rankCat] && RANKS[ui.rankCat][branch]) || [];
  }
  list.forEach(r => {
    const o = document.createElement('option');
    o.value = r; o.textContent = r; sel.appendChild(o);
  });
  updateSkillbridgeLimit();
}

// ===== VALIDATION =====
export function showErr(id, show) {
  const el = $(id);
  if (el) el.classList.toggle('show', show);
  // Mirror the visual error onto the associated control so AT announces invalid state.
  // ~= matches one token in a space-separated aria-describedby list (a control can
  // reference more than one error message, e.g. #yos references two distinct errors).
  const ctrl = $1('[aria-describedby~="' + id + '"]');
  if (ctrl) ctrl.setAttribute('aria-invalid', String(show));
}

export function validate() {
  let ok = true;
  const fn = $('firstName').value.trim();
  if (!fn) { showErr('err-firstName', true); $('firstName').classList.add('error'); ok = false; } else { showErr('err-firstName', false); $('firstName').classList.remove('error'); }
  if (!$('branch').value) { showErr('err-branch', true); ok = false; } else { showErr('err-branch', false); }
  if (!ui.rankCat) { showErr('err-rankCat', true); ok = false; } else { showErr('err-rankCat', false); }
  if (!$('rank').value) { showErr('err-rank', true); ok = false; } else { showErr('err-rank', false); }
  const yos = parseInt($('yos').value);
  const yosInRange = !!yos && yos >= 1 && yos <= 40;
  if (!yosInRange) { showErr('err-yos', true); $('yos').classList.add('error'); ok = false; } else { showErr('err-yos', false); $('yos').classList.remove('error'); }
  if (!ui.transType) { showErr('err-transType', true); ok = false; } else { showErr('err-transType', false); }
  // A distinct message from the 1-40 range check above — "12" is a perfectly valid
  // answer to "years of service," it's just too few for Retirement specifically.
  const yosBelowRetirementFloor = yosInRange && ui.transType === 'Retirement' && yos < 20;
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
  const isExistingPlan = !!(ui.state && ui.state.firstName && ui.state.sepDate);
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
  if (ui.toggles.sb && sbAutoMax !== null) {
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
export function buildState() {
  /** @type {any} */
  const s = ui.state ? { ...ui.state } : {};
  s.firstName = $('firstName').value.trim();
  s.branch = $('branch').value;
  s.rankCat = ui.rankCat;
  s.rank = $('rank').value;
  s.yos = parseInt($('yos').value);
  s.dateOfRank = $('dateOfRank').value || '';
  s.transType = ui.transType;
  s.sepDate = $('sepDate').value;
  s.todayDate = $('todayDate').value;
  s.leaveDays = clamp(numOr(parseInt($('leaveDays').value), 60), 0, 120);
  // Captured once here rather than re-typed into every tool that needs it.
  s.bah = clamp(numOr(parseFloat($('bah').value), 0), 0, 1e5);
  s.ptdy = ui.toggles.ptdy;
  s.ptdyDays = ui.toggles.ptdy ? clamp(parseInt($('ptdyDays').value) || 20, 1, 30) : 0;
  s.sb = ui.toggles.sb;
  // Preserve a deliberate 0 (e.g. E-1 "not eligible"); only default to 90 on a blank/NaN field.
  const sbN = parseInt($('sbDays').value, 10);
  s.sbDays = ui.toggles.sb ? clamp(Number.isFinite(sbN) ? sbN : 90, 0, 180) : 0;
  s.postLocation = $('postLocation').value.trim();
  s.careerInterest = $('careerInterest').value;
  s.giBill = ui.toggles.giBill;
  s.vaClaim = ui.toggles.vaClaim;
  s.married = ui.toggles.married;
  s.homeowner = ui.toggles.homeowner;
  s.clearance = ui.toggles.clearance;
  s.federalJob = ui.toggles.federalJob;
  s.oconus = ui.toggles.oconus;
  s.payRetSystem = ui.payRetSystem;
  s.selectedVARating = ui.selectedVARating;
  s.hasDependents = ui.hasDependents;
  // TSP state
  s.tspBalance = parseFloat($('tspBalance')?.value) || 0;
  // Left UNDEFINED (not 0) when blank, so the auto-populate in applyLoadedPlan can fill in
  // "years until your separation date". `parseFloat('') || 0` wrote a real 0, which numOr
  // then accepted as a deliberate answer — so every brand-new plan projected $0 of TSP
  // contributions and $0 of growth in the headline card until the user noticed the field.
  s.tspYearsToRet = numOr(parseFloat($('tspYearsToRet')?.value), undefined);
  s.tspRate = parseFloat($('tspRate')?.value) || 6;
  s.tspContribMode = ui.tspContribMode;
  s.tspContribution = numOr(parseFloat($('tspContribution')?.value), 200);
  s.tspContribPct = parseFloat($('tspContribPct')?.value) || 5;
  // Clamped to the range isValidState accepts. Typing an out-of-range age (e.g. 30) used to
  // make every subsequent PUT fail validation with a permanent 400 and no explanation
  // beyond "Couldn't save".
  s.tspRetAge = clamp(numOr(parseInt($('tspRetAge')?.value), 45), 38, 70);
  s.tspWithdrawalMethod = ui.tspWithdrawalMethod;
  s.tspFixedAmount = numOr(parseFloat($('tspFixedAmount')?.value), 500);
  return s;
}

// ----- two-step form -----
// Step 1 holds the seven required fields and can build the plan on its own; step 2 holds the
// optional detail. Both step buttons are always live, so this is a view switch, not a wizard.
export function showSetupStep(n, { focus = false } = {}) {
  const step = n === 2 ? 2 : 1;
  for (const k of [1, 2]) {
    const panel = $('setupStep' + k);
    if (panel) panel.hidden = k !== step;
  }
  $$('.setup-step-btn').forEach(b => {
    const on = Number(b.dataset.step) === step;
    b.classList.toggle('is-current', on);
    if (on) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  if (focus) {
    const first = $1('#setupStep' + step + ' input:not([type="hidden"]):not([tabindex="-1"]), #setupStep' + step + ' select, #setupStep' + step + ' [tabindex="0"]');
    if (first) first.focus();
  }
}

// Reveal whichever step contains an element (a validation error may sit on the hidden one).
export function revealStepOf(el) {
  if (!el || !el.closest) return;
  const step = el.closest('.setup-step');
  if (step) showSetupStep(step.id === 'setupStep2' ? 2 : 1);
}

export function wireSetupForm() {
  const todayStr = todayLocalStr();
  $('todayDate').value = todayStr;

  $$('.setup-step-btn').forEach(b => b.addEventListener('click', () => showSetupStep(Number(b.dataset.step), { focus: true })));
  $$('[data-goto-step]').forEach(b => b.addEventListener('click', () => {
    showSetupStep(Number(b.dataset.gotoStep), { focus: true });
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
  }));
  showSetupStep(1);

  initToggle('ptdyToggle', 'ptdy', 'Taking Permissive TDY?');
  initToggle('sbToggle', 'sb', 'Taking SkillBridge?');
  initToggle('giBillToggle', 'giBill', 'Planning to use GI Bill?');
  initToggle('vaClaimToggle', 'vaClaim', 'Planning to file VA disability?');
  initToggle('marriedToggle', 'married', 'Married / have a spouse?');
  initToggle('homeownerToggle', 'homeowner', 'Own (or buying) a home?');
  initToggle('clearanceToggle', 'clearance', 'Hold a security clearance?');
  initToggle('federalJobToggle', 'federalJob', 'Pursuing federal employment?');
  initToggle('oconusToggle', 'oconus', 'Retiring from an OCONUS station?');

  initRadioGroup('rankCatGroup', val => { ui.rankCat = val; populateRanks(); });
  initRadioGroup('transTypeGroup', val => { ui.transType = val; });

  $('branch').addEventListener('change', () => { populateRanks(); });
  $('rank').addEventListener('change', () => { updateSkillbridgeLimit(); });
  $('sbDays').addEventListener('input', () => { updateSbEditFeedback(); });

  $('editBtn').addEventListener('click', () => {
    showSetup();
    if (ui.state.firstName) $('firstName').value = ui.state.firstName;
    if (ui.state.branch) $('branch').value = ui.state.branch;
    if (ui.state.rankCat) {
      ui.rankCat = ui.state.rankCat;
      $$('#rankCatGroup .radio-card').forEach(c => { const on = c.dataset.value === ui.rankCat; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
      populateRanks();
      if (ui.state.rank) setTimeout(() => {
        $('rank').value = ui.state.rank;
        updateSkillbridgeLimit(); // resets sbDays to the rank's auto-max…
        // …so restore the user's saved value AFTER it, or the custom value is clobbered.
        if (ui.state.sb && ui.state.sbDays !== undefined) { $('sbDays').value = ui.state.sbDays; updateSbEditFeedback(); }
      }, 50);
    }
    if (ui.state.yos) $('yos').value = ui.state.yos;
    if (ui.state.dateOfRank) $('dateOfRank').value = ui.state.dateOfRank;
    if (ui.state.transType) {
      ui.transType = ui.state.transType;
      $$('#transTypeGroup .radio-card').forEach(c => { const on = c.dataset.value === ui.transType; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
    }
    if (ui.state.sepDate) $('sepDate').value = ui.state.sepDate;
    // "Today's Date" is auto-set to the real current date; don't restore a stale saved value.
    $('todayDate').value = todayLocalStr();
    if (ui.state.leaveDays !== undefined) $('leaveDays').value = ui.state.leaveDays;
    if (ui.state.bah !== undefined) $('bah').value = ui.state.bah;
    ui.toggles.ptdy = !!ui.state.ptdy;
    $('ptdyToggle').classList.toggle('active', ui.toggles.ptdy);
    $('ptdyToggle').setAttribute('aria-checked', String(ui.toggles.ptdy));
    $('ptdyFields').classList.toggle('hidden', !ui.toggles.ptdy);
    if (ui.state.ptdyDays) $('ptdyDays').value = ui.state.ptdyDays;
    ui.toggles.sb = !!ui.state.sb;
    $('sbToggle').classList.toggle('active', ui.toggles.sb);
    $('sbToggle').setAttribute('aria-checked', String(ui.toggles.sb));
    $('sbFields').classList.toggle('hidden', !ui.toggles.sb);
    // Restore for the no-deferred path (no rank); when rank is set the deferred callback
    // above re-restores after updateSkillbridgeLimit(). Both guard on state.sb.
    if (ui.state.sb && ui.state.sbDays !== undefined) $('sbDays').value = ui.state.sbDays;
    if (ui.state.postLocation) $('postLocation').value = ui.state.postLocation;
    if (ui.state.careerInterest) $('careerInterest').value = ui.state.careerInterest;
    ui.toggles.giBill = !!ui.state.giBill;
    $('giBillToggle').classList.toggle('active', ui.toggles.giBill);
    $('giBillToggle').setAttribute('aria-checked', String(ui.toggles.giBill));
    ui.toggles.vaClaim = !!ui.state.vaClaim;
    $('vaClaimToggle').classList.toggle('active', ui.toggles.vaClaim);
    $('vaClaimToggle').setAttribute('aria-checked', String(ui.toggles.vaClaim));
    [['married','marriedToggle'],['homeowner','homeownerToggle'],['clearance','clearanceToggle'],['federalJob','federalJobToggle'],['oconus','oconusToggle']].forEach(([key, id]) => {
      ui.toggles[key] = ui.state[key] || false;
      const el = $(id);
      if (el) { el.classList.toggle('active', ui.toggles[key]); el.setAttribute('aria-checked', String(ui.toggles[key])); }
    });
  });

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

}
