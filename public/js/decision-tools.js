// ===== decision-tools.js =====
// The Decision Tools tab. Each calculator is declared ONCE in TOOLS below — its inputs, how
// each input is prefilled from the plan, and the function that recomputes it — and the markup
// is generated from that spec. Adding a tool is one entry here plus its recalc function, not a
// block of hand-copied HTML plus three parallel id lists.
//
// Overrides: `ui.state.tools` holds ONLY the inputs a visitor has actually changed away from
// their prefill. Untouched inputs re-prefill on every render, so editing base pay on the Pay
// tab keeps flowing into SBP base, CRDP gross pay and the domicile tool. (Persisting every
// input on any edit — the previous behaviour — froze all of them the moment one was touched.)

import {
  getBasePay2026, parseStateFromLocation, getRankGrade, getBAS, computeRetirementPay, vaCompensation,
  computeSBP, compareConcurrentReceipt, estimateRetireeHealthcareCost, compareTricarePrimeSelect,
  compareStates, requiredCivilianSalary, estimatePPM, compareLeaveSellBack, tspKeepVsRoll
} from '/js/calc.js';
import { ui } from '/js/ui-state.js';
import { $, fmtCurrency, fmtCurrencyWhole, numOr, escapeHtml, afterRender } from '/js/dom.js';
import { saveState } from '/js/plan-io.js';
import { incomeAtRating, getLastRetiredPayMonthly } from '/js/pay-estimator.js';

// Coalesced, memoized refresh of the Decision Tools panel. `signature` is every input the
// panel's prefills actually derive from; identical signature → nothing to do.
let dtSignature = null;
let dtFrame = null;
export function scheduleDecisionToolsRefresh(isRet, signature) {
  if (signature === dtSignature) return;
  dtSignature = signature;
  if (dtFrame) cancelAnimationFrame(dtFrame);
  dtFrame = requestAnimationFrame(() => { dtFrame = null; renderDecisionTools(isRet); });
}

const _n = (id) => parseFloat($(id) && $(id).value) || 0;

// ----- the spec -----
// input: { id, label, type: 'number'|'text'|'select'|'checkbox', attrs?, options?, help?, prefill(ctx) }
// ctx: { s: plan, isRet, retMonthly, basePay, rg }
/**
 * @typedef {{ s: any, isRet: boolean, retMonthly: number, basePay: number, rg: string }} ToolCtx
 * @typedef {{ id: string, label: string, type: 'number'|'text'|'select'|'checkbox', attrs?: string,
 *   options?: [string, string][], help?: string, prefill: (c: ToolCtx) => any }} ToolInput
 * @typedef {{ id: string, icon: string, title: string, result: string, cols: string, intro?: string,
 *   inputs: ToolInput[], recalc: () => void, method: string }} ToolSpec
 */
/** @type {[string, string][]} */
const VA_RATING_OPTIONS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(r => /** @type {[string, string]} */ ([String(r), r + '%']));
/** @returns {ToolInput} */
const num = (id, label, attrs, prefill, help) => ({ id, label, type: 'number', attrs, prefill, help });
/** @returns {ToolInput} */
const sel = (id, label, options, prefill) => ({ id, label, type: 'select', options, prefill });

/** @type {ToolSpec[]} */
export const TOOLS = [
  {
    id: 'sbp', icon: 'shield', title: 'SBP Premium & Break-Even', result: 'dtSbpResult', cols: 'grid-cols-1 md:grid-cols-2',
    inputs: [
      num('dtSbpBase', 'SBP base amount ($/mo)', 'min="0" step="50"', c => Math.round(c.retMonthly)),
      num('dtSbpRetAge', 'Your age at retirement', 'min="37" max="70"', c => c.s.tspRetAge || 45),
    ],
    recalc: recalcSBP,
    method: 'Premium = 6.5% of the elected base amount; survivor annuity = 55% of base. Coverage is paid-up only after 360 payments AND age 70. Spouse coverage only — child-only and spouse-and-child premiums are priced from actuarial tables this tool does not hold. The SBP-DIC offset was repealed in 2023. <a href="https://www.dfas.mil/RetiredMilitary/provide/sbp/" target="_blank" rel="noopener" class="text-gold-700 hover:underline">DFAS SBP →</a>',
  },
  {
    id: 'crsc', icon: 'git-compare', title: 'CRDP vs. CRSC Net Pay', result: 'dtCrResult', cols: 'grid-cols-2 md:grid-cols-4',
    inputs: [
      num('dtCrGross', 'Gross retired pay ($/mo)', 'min="0" step="50"', c => Math.round(c.retMonthly)),
      sel('dtCrRating', 'VA rating', VA_RATING_OPTIONS, c => String(c.s.selectedVARating || 0)),
      num('dtCrCombat', 'Combat-related %', 'min="0" max="100"', () => 0),
      sel('dtCrBracket', 'Marginal tax rate', [['0.10', '10%'], ['0.12', '12%'], ['0.22', '22%'], ['0.24', '24%'], ['0.32', '32%']], () => '0.22'),
    ],
    recalc: recalcCRSC,
    method: 'VA compensation offsets retired pay dollar-for-dollar. CRDP (automatic at 20 years + 50%+) restores it and is taxable; CRSC (combat-related, requires DD 2860) restores the combat-related portion tax-free. The VA figure includes your household (spouse / dependents) exactly as on the Pay tab. <a href="https://www.dfas.mil/RetiredMilitary/disability/" target="_blank" rel="noopener" class="text-gold-700 hover:underline">DFAS →</a>',
  },
  {
    id: 'healthcare', icon: 'heart-pulse', title: 'Retiree Healthcare Cost (TRICARE Select + FEDVIP)', result: 'dtHcResult', cols: 'grid-cols-2 md:grid-cols-4',
    inputs: [
      sel('dtHcGroup', 'TRICARE group', [['A', 'Group A (enlisted/commissioned before Jan 1 2018)'], ['B', 'Group B (on/after Jan 1 2018)']], () => 'A'),
      sel('dtHcCoverage', 'Coverage', [['family', 'Family'], ['individual', 'Individual']], c => (c.s.hasDependents || c.s.married) ? 'family' : 'individual'),
      num('dtHcRx', 'Est. annual Rx ($)', 'min="0" step="50"', () => 0),
      num('dtHcFedvip', 'FEDVIP premium ($/mo)', 'min="0" step="5"', () => 0),
    ],
    recalc: recalcHealthcare,
    method: 'CY2026 TRICARE Select enrollment fees. Medically retired members and survivors (Group A) pay $0. Active-duty healthcare costs $0 — budget for the jump. <a href="https://tricare.mil/Costs/PayFees/SelectFees" target="_blank" rel="noopener" class="text-gold-700 hover:underline">TRICARE fees →</a>',
  },
  {
    id: 'primeselect', icon: 'git-fork', title: 'TRICARE Prime vs. Select', result: 'dtPsResult', cols: 'grid-cols-1 md:grid-cols-3 items-end',
    inputs: [
      sel('dtPsVisits', 'Expected doctor visits', [['low', 'Low'], ['moderate', 'Moderate'], ['high', 'High']], () => 'moderate'),
      { id: 'dtPsLowCost', label: 'I prioritize lowest cost', type: 'checkbox', prefill: () => true },
      { id: 'dtPsFlex', label: 'I want provider flexibility / no referrals', type: 'checkbox', prefill: () => false },
    ],
    recalc: recalcPrimeSelect,
    method: 'Decide within 90 days of retirement (retroactive up to 12 months). General guidance, not a coverage determination. <a href="https://www.tricare.mil/Plans/HealthPlans" target="_blank" rel="noopener" class="text-gold-700 hover:underline">Compare plans →</a>',
  },
  {
    id: 'state', icon: 'map', title: 'Best State of Residence (Domicile)', result: 'dtStResult', cols: 'grid-cols-1 md:grid-cols-2',
    inputs: [
      num('dtStPay', 'Annual retired pay ($)', 'min="0" step="500"', c => Math.round(c.retMonthly * 12)),
      { id: 'dtStStates', label: 'Candidate states (2-letter codes)', type: 'text', attrs: 'placeholder="e.g., TX, CA, VA, FL"', prefill: c => parseStateFromLocation(c.s.postLocation) || '' },
    ],
    recalc: recalcBestState,
    method: 'Estimates tax on military RETIRED pay only (VA compensation is always tax-free). States with a fixed-dollar exemption are taxed only on the pay above it; age- or income-conditioned exemptions are approximated at half the damped top marginal rate. Confirm with a tax professional.',
  },
  {
    id: 'ppm', icon: 'truck', title: 'PPM / DITY Move Estimator', result: 'dtPpmResult', cols: 'grid-cols-1 md:grid-cols-2',
    inputs: [
      num('dtPpmGcc', 'Government Constructed Cost / GCC ($)', 'min="0" step="100" placeholder="Ask your TMO for the GCC estimate"', () => ''),
      num('dtPpmExpenses', 'Your expected expenses ($)', 'min="0" step="100"', () => 0),
    ],
    recalc: recalcPPM,
    method: 'Incentive is 100% of GCC (2025+); profit (incentive minus documented expenses) is taxable and withheld at ~22%. <a href="https://www.move.mil/moving-guide/ppm" target="_blank" rel="noopener" class="text-gold-700 hover:underline">Move.mil PPM →</a>',
  },
  {
    id: 'tsproll', icon: 'landmark', title: 'TSP: Keep-In vs. Roll-Out', result: 'dtTspResult', cols: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-5',
    inputs: [
      num('dtTspAge', 'Age at separation', 'min="37" max="70"', c => c.s.tspRetAge || 45),
      num('dtTspTrad', 'Traditional ($)', 'min="0" step="1000"', c => c.s.tspBalance || 0),
      num('dtTspRoth', 'Roth ($)', 'min="0" step="1000"', () => 0),
      num('dtTspAdvFee', 'Advisory fee (%)', 'min="0" max="5" step="0.05"', () => 1.0),
      num('dtTspYears', 'Years invested', 'min="1" max="50"', () => 20),
    ],
    recalc: recalcTSPRoll,
    method: 'Fee drag assumes ~6% growth and the TSP\'s ~0.05% expense ratio. Not investment advice — vet any advisor on <a href="https://brokercheck.finra.org" target="_blank" rel="noopener" class="text-gold-700 hover:underline">FINRA BrokerCheck</a>.',
  },
  {
    id: 'leave', icon: 'plane', title: 'Terminal Leave vs. Selling Leave Back', result: 'dtLeaveResult', cols: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
    inputs: [
      num('dtLeaveDays', 'Days to compare', 'inputmode="numeric" min="0" max="120"', c => c.s.leaveDays || 60),
      num('dtLeaveAlreadySold', 'Days sold earlier', 'inputmode="numeric" min="0" max="60"', () => 0, 'Counts against the 60-day career cap.'),
      num('dtLeaveBase', 'Base pay ($/mo)', 'inputmode="decimal" min="0" step="50"', c => Math.round(c.basePay)),
      // BAH comes from the plan (captured once in setup) rather than defaulting to 0, which
      // silently priced terminal leave at base+BAS only — omitting its largest term.
      num('dtLeaveBah', 'BAH ($/mo)', 'inputmode="decimal" min="0" step="50" placeholder="0 if in barracks"', c => Math.round(c.s.bah || 0)),
      num('dtLeaveBas', 'BAS ($/mo)', 'inputmode="decimal" min="0" step="10"', c => getBAS(c.s.rankCat)),
    ],
    recalc: recalcLeaveSellBack,
    method: 'Selling leave pays base pay only (no BAH/BAS) as a one-time lump sum, taxed at ~22% federal withholding, and is capped at 60 days across your whole career (37 U.S.C. 501). Terminal leave keeps you on active duty — full pay plus tax-exempt BAH/BAS — for the same days, but delays your separation date and any civilian paycheck that would start after it. This compares take-home dollars only; it doesn\'t weigh starting a civilian job earlier, which sell-back enables and terminal leave doesn\'t.',
  },
  {
    id: 'salary', icon: 'briefcase', title: 'What Civilian Salary Do I Need to Break Even?', result: 'dtSalResult', cols: 'grid-cols-2 md:grid-cols-3',
    intro: 'Military pay looks smaller than it is: BAH and BAS are completely untaxed, and healthcare is nearly free. A civilian offer has to clear a higher bar than your base pay to leave you where you are today. This works out that bar.',
    inputs: [
      sel('dtSalFiling', 'Tax filing status', [['single', 'Single'], ['joint', 'Married filing jointly']], c => c.s.married ? 'joint' : 'single'),
      num('dtSalHealth', 'Civilian health premium ($/mo)', 'inputmode="decimal" min="0" step="25"', () => 0, 'Your share of the premium, not the employer\'s.'),
      num('dtSal401k', 'Employer 401(k) match (%)', 'inputmode="decimal" min="0" max="25" step="0.5"', () => 0, 'Shown separately — deferred pay, not take-home.'),
    ],
    recalc: recalcSalaryBreakEven,
    method: 'Uses 2026 federal brackets and the standard deduction, FICA at 7.65%, and your state\'s damped effective rate. Your retired pay (if any) is counted as continuing income, which lowers the salary you need; the VA rating and gross retired pay come from the CRDP/CRSC tool above. Bonuses, equity, PTO, commute and relocation costs are not modeled — treat the result as the floor of a negotiating range, not a precise target.',
  },
];

const ALL_INPUTS = TOOLS.flatMap(t => t.inputs);

// ----- markup -----
function inputHtml(inp) {
  const label = `<label class="block text-xs font-medium text-navy-600 mb-1" for="${inp.id}">${escapeHtml(inp.label)}</label>`;
  const help = inp.help ? `<p id="${inp.id}Help" class="text-xs text-navy-400 mt-1">${escapeHtml(inp.help)}</p>` : '';
  const describedBy = inp.help ? ` aria-describedby="${inp.id}Help"` : '';
  if (inp.type === 'checkbox') {
    return `<label class="flex items-center gap-2 text-sm text-navy-600"><input type="checkbox" id="${inp.id}" /> ${escapeHtml(inp.label)}</label>`;
  }
  if (inp.type === 'select') {
    const opts = inp.options.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('');
    return `<div>${label}<select id="${inp.id}" class="input-field"${describedBy}>${opts}</select>${help}</div>`;
  }
  return `<div>${label}<input type="${inp.type}" id="${inp.id}" class="input-field" ${inp.attrs || ''}${describedBy} />${help}</div>`;
}

function toolHtml(t) {
  return `<div id="tool-${t.id}">
    <h3 class="text-base font-semibold text-navy-700 mb-3 flex items-center gap-2"><i data-lucide="${t.icon}" class="w-4 h-4 text-gold-500"></i> ${escapeHtml(t.title)}</h3>
    ${t.intro ? `<p class="text-xs text-navy-500 mb-3 leading-relaxed">${escapeHtml(t.intro)}</p>` : ''}
    <div class="grid ${t.cols} gap-3 mb-3">${t.inputs.map(inputHtml).join('')}</div>
    <div id="${t.result}" class="bg-navy-50 rounded-xl p-4 text-sm"></div>
    <details class="method-note"><summary>How this is estimated</summary><p>${t.method}</p></details>
  </div>`;
}

function mountTools() {
  const host = $('decisionToolsList');
  // Idempotent on the DOM itself (not a module flag): the markup is the source of truth for
  // whether the tools exist, so a re-created document gets them again.
  if (!host || host.querySelector('[id^="tool-"]')) return;
  host.innerHTML = TOOLS.map(toolHtml).join('<div class="border-t rule-soft"></div>');
}

// ----- prefill + overrides -----
// The prefill each input had on the last render, so persistTools can tell "changed away from
// the prefill" from "typed the prefill back in".
let lastPrefill = {};
const touched = new Set();

function readInput(inp) { const el = $(inp.id); return inp.type === 'checkbox' ? !!el.checked : el.value; }
function writeInput(inp, v) { const el = $(inp.id); if (!el) return; if (inp.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : String(v); }
const same = (a, b) => (typeof a === 'boolean' || typeof b === 'boolean') ? !!a === !!b : String(a ?? '') === String(b ?? '');

// Prefill every calculator from the plan, apply the visitor's overrides, then compute.
export function renderDecisionTools(isRet) {
  mountTools();
  const s = ui.state;
  const rg = getRankGrade(s.rank);
  const basePayEl = $('payBasePay');
  const basePay = (basePayEl && parseFloat(basePayEl.value)) || getBasePay2026(rg, s.yos) || 0;
  // Prefer the figure the Pay tab is showing (High-3 based); fall back to current-pay math only
  // before the estimator has rendered.
  const shown = getLastRetiredPayMonthly();
  const retMonthly = isRet ? (shown != null ? shown : computeRetirementPay({ basePay, yos: s.yos, system: s.payRetSystem || 'high3' }).monthly) : 0;
  const ctx = { s, isRet, retMonthly, basePay, rg };

  const overrides = { ...(s.tools || {}) };
  lastPrefill = {};
  for (const inp of ALL_INPUTS) {
    const pre = inp.prefill(ctx);
    lastPrefill[inp.id] = pre;
    // A stored value that equals today's prefill is not an override, whatever it once was —
    // dropping it here is what un-freezes plans saved by the old persist-everything code.
    if (inp.id in overrides && same(overrides[inp.id], pre)) delete overrides[inp.id];
    writeInput(inp, inp.id in overrides ? overrides[inp.id] : pre);
  }
  s.tools = overrides;
  recalcAllTools();
}

// Store only the inputs the visitor changed away from their prefill.
export function persistTools() {
  if (!ui.state || !ui.state.firstName) return;
  const overrides = { ...(ui.state.tools || {}) };
  for (const inp of ALL_INPUTS) {
    if (!touched.has(inp.id)) continue;
    const v = readInput(inp);
    if (same(v, lastPrefill[inp.id])) delete overrides[inp.id];
    else overrides[inp.id] = v;
  }
  ui.state.tools = overrides;
  saveState(ui.state);
}

export function recalcAllTools() {
  for (const t of TOOLS) t.recalc();
  afterRender($('decisionToolsList'));
}

export function wireDecisionTools() {
  mountTools();
  const onEdit = (e) => {
    const id = e.target && e.target.id;
    if (id) touched.add(id);
    recalcAllTools();
    persistTools();
  };
  $('decisionToolsContent').addEventListener('input', onEdit);
  $('decisionToolsContent').addEventListener('change', onEdit);
}

// ----- per-tool recompute -----
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

// Household VA figure for the CRDP/CRSC and salary tools — the same one the Pay tab shows,
// so the two never quote different amounts for the same person.
function householdVaComp(rating) {
  const s = ui.state;
  return vaCompensation({ rating, spouse: !!(s && s.married), childrenU18: ui.hasDependents ? 1 : 0 });
}

// "What civilian salary do I need to break even?" — the #1 TAP employment question. Every
// input already existed in the app; nothing joined them up until now.
function recalcSalaryBreakEven() {
  const box = $('dtSalResult');
  if (!box) return;
  const s = ui.state;
  const isRet = s.transType === 'Retirement';
  const basePay = _n('dtLeaveBase') || _n('payBasePay');
  if (basePay <= 0) {
    box.innerHTML = '<p class="text-navy-400">Enter your base pay above to work out the salary you need.</p>';
    return;
  }
  // Same rating and gross retired pay as the CRDP/CRSC tool, so the two agree.
  const rating = _n('dtCrRating');
  const retiredPayMonthly = isRet ? incomeAtRating(rating, _n('dtCrGross'), true).retiredPayAfterWaiver : 0;
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
  const r = computeSBP({ baseAmount: _n('dtSbpBase'), retireeAge: _n('dtSbpRetAge') || 45 });
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
  const rating = _n('dtCrRating');
  const r = compareConcurrentReceipt({
    grossRetiredPay: _n('dtCrGross'), vaRating: rating, combatRelatedPct: _n('dtCrCombat'),
    marginalRate: parseFloat($('dtCrBracket').value) || 0.22, yos: ui.state.yos || 20,
    vaComp: householdVaComp(rating),
  });
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
