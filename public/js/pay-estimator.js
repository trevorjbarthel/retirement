// ===== pay-estimator.js =====
// The Pay & Income tab: retired pay (High-3), VA compensation, the income-by-rating table and
// chart, TSP projection and withdrawal, the full income summary, and the state-tax panel.

import {
  PAY_TABLE_YEARS, VA_RATES, vaCompensation, STATE_TAX_DATA, getBasePay2026, computeHigh3, parseStateFromLocation, interpolateAnnuityFactor, getLifeExpDistributionPeriod, daysBetween, clamp, getRankGrade, FLAG_OFFICER_GRADES, computeRetirementPay, applyVAWaiver, estimateStateTaxOnRetiredPay, isValidState
} from '/js/calc.js';
import { ui } from '/js/ui-state.js';
import { $, fmtDate, fmtCurrency, fmtCurrencyWhole, numOr, escapeHtml, $$, $1, afterRender, announce } from '/js/dom.js';
import { initRadioGroup, buildState } from '/js/setup-form.js';
import { saveState } from '/js/plan-io.js';
import { renderResults } from '/js/results.js';
import { scheduleDecisionToolsRefresh, renderDecisionTools } from '/js/decision-tools.js';

// ===== PAY ESTIMATOR RENDERING =====
// persist=false on the initial display render so we don't write back data we just loaded;
// user-driven recalcs (input handlers) call recalcPayEstimator() directly and do persist.
export function renderPayEstimator(isRet, persist = false) {
  const s = ui.state;
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

  ui.payRetSystem = s.payRetSystem || 'high3';
  const retCards = $$('.radio-card', $('payRetSystemGroup'));
  retCards.forEach(c => { const on = c.dataset.value === ui.payRetSystem; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });

  ui.selectedVARating = s.selectedVARating || 0;
  ui.hasDependents = s.hasDependents || false;
  $('depToggle').classList.toggle('active', ui.hasDependents);
  $('depNote').classList.toggle('hidden', !ui.hasDependents);

  const ratingBtns = $('vaRatingBtns');
  ratingBtns.innerHTML = '';
  [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach(r => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `va-rating-btn${r === ui.selectedVARating ? ' active' : ''}`;
    btn.textContent = r + '%';
    btn.dataset.rating = String(r);
    btn.setAttribute('aria-pressed', String(r === ui.selectedVARating));
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
  ui.tspContribMode = s.tspContribMode || 'fixed';
  const cmCards = $$('.radio-card', $('tspContribModeGroup'));
  cmCards.forEach(c => { const on = c.dataset.value === ui.tspContribMode; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
  $('tspContribFixedField').classList.toggle('hidden', ui.tspContribMode !== 'fixed');
  $('tspContribPctField').classList.toggle('hidden', ui.tspContribMode !== 'pct');

  ui.tspWithdrawalMethod = s.tspWithdrawalMethod || 'fixed';

  // Set withdrawal method radio
  const wCards = $$('.tsp-withdrawal-card', $('tspWithdrawalGroup'));
  wCards.forEach(c => { const on = c.dataset.value === ui.tspWithdrawalMethod; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
  $('tspFixedFields').style.display = ui.tspWithdrawalMethod === 'fixed' ? '' : 'none';

  recalcPayEstimator(persist);
}

// The High-3 average and the current-pay figure it was derived from, recomputed on every
// pass and read by the decision tools so they all price the same base.
export let currentHigh3 = null;
// The retired-pay figure the Pay tab last displayed (High-3 based). The decision tools prefill
// from this so SBP base / CRDP gross pay / the domicile tool quote the same number the Pay tab
// does, rather than re-deriving one from current base pay.
let lastRetiredPayMonthly = null;
export function getLastRetiredPayMonthly() { return lastRetiredPayMonthly; }

export function recalcPayEstimator(persist = true) {
  const s = ui.state;
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

  const { monthly: monthlyRet0, mult, pct: pctMult } = computeRetirementPay({ basePay: retBase, yos, system: ui.payRetSystem });
  const monthlyRet = isRet ? monthlyRet0 : 0;
  const annualRet = monthlyRet * 12;
  lastRetiredPayMonthly = monthlyRet;

  if (isRet && retBase > 0) {
    $('payRetResult').classList.remove('hidden');
    $('payRetMonthly').textContent = fmtCurrency(monthlyRet);
    $('payRetAnnual').textContent = fmtCurrency(annualRet);
    const multLabel = ui.payRetSystem === 'redux'
      ? `REDUX 40% + 3.5%/yr past 20 (${Math.round(pctMult * 100)}%)`
      : `${yos} yrs × ${(mult * 100).toFixed(1)}% (${Math.round(pctMult * 100)}%)`;
    $('payRetFormula').textContent = `${multLabel} × ${fmtCurrency(retBase)} = ${fmtCurrency(monthlyRet)}/mo`;
    $('payBrsNote').classList.toggle('hidden', ui.payRetSystem !== 'brs');
    const rx = $('payReduxNote');
    if (rx) rx.classList.toggle('hidden', ui.payRetSystem !== 'redux');
    const h3 = $('payHigh3Note');
    if (h3) {
      if (currentHigh3) {
        const caveats = [];
        if (currentHigh3.promotionInWindow) caveats.push('your Date of Rank falls inside the 36-month window, so the pre-promotion months are estimated one grade lower');
        if (currentHigh3.estimatedFromSingleYear) caveats.push(`some months of the 36-month window fall outside the ${Math.min(...PAY_TABLE_YEARS)}–${Math.max(...PAY_TABLE_YEARS)} pay tables this app holds, so they use the nearest year's rates`);
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
  const vaComp = vaCompensation({ rating: ui.selectedVARating, spouse: !!s.married, childrenU18: ui.hasDependents ? 1 : 0 });
  $('vaCompResult').classList.remove('hidden');
  $('vaRatingLabel').textContent = ui.selectedVARating + '%';
  $('vaCompAmount').textContent = fmtCurrency(vaComp);
  const vaDepNote = $('vaCompDepNote');
  if (vaDepNote) {
    const alone = VA_RATES[ui.selectedVARating] || 0;
    if (ui.selectedVARating === 0) {
      vaDepNote.textContent = 'Select a rating above to see the compensation it pays.';
    } else if (vaComp > alone) {
      vaDepNote.textContent = `Includes a dependent allowance (the veteran-alone rate is ${fmtCurrency(alone)}/mo). Actual amounts vary with the number and ages of dependents.`;
    } else if (ui.selectedVARating < 30) {
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
  scheduleDecisionToolsRefresh(isRet, `${retBase}|${ui.selectedVARating}|${yos}|${ui.payRetSystem}|${s.married}|${ui.hasDependents}`);

  ui.state.payRetSystem = ui.payRetSystem;
  ui.state.selectedVARating = ui.selectedVARating;
  ui.state.hasDependents = ui.hasDependents;
  ui.state.tspBalance = parseFloat($('tspBalance').value) || 0;
  // undefined (not 0) on a blank field — see buildState. `|| 0` here defeated the
  // auto-populate just as surely as it did there.
  ui.state.tspYearsToRet = numOr(parseFloat($('tspYearsToRet').value), undefined);
  ui.state.tspRate = parseFloat($('tspRate').value) || 6;
  ui.state.tspContribMode = ui.tspContribMode;
  ui.state.tspContribution = numOr(parseFloat($('tspContribution').value), 200);
  ui.state.tspContribPct = parseFloat($('tspContribPct').value) || 5;
  // Clamped to isValidState's range so an out-of-range entry can't 400 every save.
  ui.state.tspRetAge = clamp(numOr(parseInt($('tspRetAge').value), 45), 38, 70);
  ui.state.tspWithdrawalMethod = ui.tspWithdrawalMethod;
  ui.state.tspFixedAmount = numOr(parseFloat($('tspFixedAmount').value), 500);
  // Persist the (possibly manually-entered) base pay so flag-officer entries survive reloads.
  ui.state.payBasePay = parseFloat($('payBasePay').value) || 0;
  if (persist) saveState(ui.state);

  // Announce the numbers this screen exists to produce. Every figure here previously
  // updated with no announcement at all, while the save indicator announced "Saving…"
  // once per keystroke — exactly backwards.
  const summaryInc = incomeAtRating(ui.selectedVARating, monthlyRet, isRet);
  announce(
    (isRet ? `Estimated retired pay ${fmtCurrency(summaryInc.retiredPayAfterWaiver)} per month. ` : '') +
    (summaryInc.vaComp > 0 ? `VA compensation ${fmtCurrency(summaryInc.vaComp)} per month at ${ui.selectedVARating} percent. ` : '') +
    `Total estimated monthly income ${fmtCurrency(summaryInc.total + (tspMonthlyIncome || 0))}.` +
    (summaryInc.waived > 0 ? ` Note: ${fmtCurrency(summaryInc.waived)} of retired pay is waived to receive VA compensation.` : '')
  );

  afterRender();
}

// ===== TSP CALCULATIONS =====
export function recalcTSP(monthlyRet, isRet, basePay) {
  const currentBalance = parseFloat($('tspBalance').value) || 0;
  const yearsToRet = parseFloat($('tspYearsToRet').value) || 0;
  const annualRate = (parseFloat($('tspRate').value) || 6) / 100;
  const retAge = parseInt($('tspRetAge').value) || 45;
  const fixedAmount = numOr(parseFloat($('tspFixedAmount').value), 500);

  // Resolve monthly contribution based on mode
  let monthlyContrib = 0;
  if (ui.tspContribMode === 'pct') {
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

      if (ui.tspWithdrawalMethod === 'fixed') {
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
      } else if (ui.tspWithdrawalMethod === 'life') {
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
      } else if (ui.tspWithdrawalMethod === 'annuity') {
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
  if (ui.payRetSystem === 'brs' && basePay > 0) {
    const fivePercent = Math.round(basePay * 0.05);
    $('tspBrsCalloutText').innerHTML = `<strong>BRS Tip:</strong> As a BRS member, DoD matches up to 5% of your base pay in TSP contributions. If you're contributing at least 5% (<strong>${fmtCurrencyWhole(fivePercent)}/month</strong> based on your base pay), you're capturing your full match — a powerful wealth-building tool.`;
    brsCallout.classList.remove('hidden');
  } else {
    brsCallout.classList.add('hidden');
  }

  return tspMonthlyIncome;
}

export function renderFullIncomeSummary(monthlyRet, vaComp, tspMonthlyIncome, isRet) {
  const summary = $('tspFullIncomeSummary');
  const hasAnyIncome = monthlyRet > 0 || vaComp > 0 || tspMonthlyIncome > 0;

  if (!hasAnyIncome) {
    summary.classList.add('hidden');
    return;
  }

  summary.classList.remove('hidden');

  // The biggest number on the page — so it is the last place that can afford to skip the
  // VA waiver. Derived from the same helper as the table and chart above.
  const inc = incomeAtRating(ui.selectedVARating, monthlyRet, isRet);
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
export function incomeAtRating(r, monthlyRet, isRet) {
  const va = vaCompensation({
    rating: r,
    spouse: !!(ui.state && ui.state.married),
    childrenU18: ui.hasDependents ? 1 : 0,
  });
  return applyVAWaiver({
    grossRetiredPay: monthlyRet,
    vaComp: va,
    yos: (ui.state && ui.state.yos) || 0,
    rating: r,
    isRetirement: isRet,
  });
}

export const VA_RATING_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function renderIncomeTable(monthlyRet, isRet) {
  const tbody = $('incomeTableBody');
  let html = '';
  let anyWaiver = false;
  VA_RATING_STEPS.forEach(r => {
    const inc = incomeAtRating(r, monthlyRet, isRet);
    const isHighlighted = r === ui.selectedVARating;
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
      note.textContent = (ui.state && ui.state.yos < 20)
        ? 'Retired pay is reduced dollar-for-dollar by VA compensation (the "VA waiver"). CRDP would restore it, but it requires 20+ years of service — so at your years of service every rating below is a tax-free swap, not extra money. The gain is that the same total arrives untaxed.'
        : 'Below a 50% rating, retired pay is reduced dollar-for-dollar by VA compensation (the "VA waiver"), so your total does not rise — the benefit is that part of it becomes tax-free. At 50%+ CRDP restores the full amount.';
    }
  }
}

export function renderIncomeBarChart(monthlyRet, isRet) {
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
    const isActive = r === ui.selectedVARating;
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

export function renderInsightCards(monthlyRet, isRet) {
  const container = $('insightCards');
  const i0 = incomeAtRating(0, monthlyRet, isRet);
  const i50 = incomeAtRating(50, monthlyRet, isRet);
  const i100 = incomeAtRating(100, monthlyRet, isRet);
  const diff50 = i50.total - i0.total;
  const diffAnnual = diff50 * 12;
  const yos = (ui.state && ui.state.yos) || 0;
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
export function renderStateTaxPanel(monthlyRet, isRet) {
  const s = ui.state;
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
  const inc = incomeAtRating(ui.selectedVARating, monthlyRet, isRet);
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

export function wirePayEstimator() {
  initRadioGroup('payRetSystemGroup', val => { ui.payRetSystem = val; recalcPayEstimator(); });
  $('payBasePay').addEventListener('input', () => { recalcPayEstimator(); });
  $('payYOS').addEventListener('input', () => { recalcPayEstimator(); });

  $('vaRatingBtns').addEventListener('click', (e) => {
    const btn = e.target.closest('.va-rating-btn');
    if (!btn) return;
    ui.selectedVARating = parseInt(btn.dataset.rating);
    $$('.va-rating-btn', $('vaRatingBtns')).forEach(b => { const on = parseInt(b.dataset.rating) === ui.selectedVARating; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    recalcPayEstimator();
  });

  (() => {
    const dep = $('depToggle');
    dep.setAttribute('role', 'switch');
    dep.setAttribute('tabindex', '0');
    dep.setAttribute('aria-label', 'I have dependents');
    dep.setAttribute('aria-checked', String(ui.hasDependents));
    const fire = () => {
      ui.hasDependents = !ui.hasDependents;
      dep.classList.toggle('active', ui.hasDependents);
      dep.setAttribute('aria-checked', String(ui.hasDependents));
      $('depNote').classList.toggle('hidden', !ui.hasDependents);
      if (ui.state.firstName) { ui.state.hasDependents = ui.hasDependents; saveState(ui.state); }
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
    ui.tspContribMode = val;
    $('tspContribFixedField').classList.toggle('hidden', ui.tspContribMode !== 'fixed');
    $('tspContribPctField').classList.toggle('hidden', ui.tspContribMode !== 'pct');
    recalcPayEstimator();
  });

  // TSP withdrawal method radio (uses .tsp-withdrawal-card, also keyboard-accessible)
  initRadioGroup('tspWithdrawalGroup', (val) => {
    ui.tspWithdrawalMethod = val;
    $('tspFixedFields').style.display = ui.tspWithdrawalMethod === 'fixed' ? '' : 'none';
    recalcPayEstimator();
  }, '.tsp-withdrawal-card');

}
