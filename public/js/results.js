// ===== results.js =====
// The results screen shell and the Overview tab: screen switching, the full render pass,
// the horizontal timeline, the 180-day meter, advisories, the scenario comparison, the
// collapsible section headers, and printing.

import {
  subDays, daysBetween, clamp, getRankGrade, getSkillbridgeAuthorizedMax, getBAS, milestoneStatus, computeMilestones, compareScenarios, classifyDayMeter
} from '/js/calc.js';
import { ui } from '/js/ui-state.js';
import { $, fmtDate, fmtDateShort, fmtCurrencyWhole, numOr, scrollBehavior, escapeHtml, afterRender, $$ } from '/js/dom.js';
import { BRANCH_META, showSetupStep } from '/js/setup-form.js';
import { rememberedTab, scrollToUnderSticky, setActiveTab } from '/js/tabs.js';
import { renderTimelineCalendar, renderCalendarPage, printAllCalendarMonths } from '/js/calendar-view.js';
import { renderPayEstimator } from '/js/pay-estimator.js';
import { renderDecisionTools } from '/js/decision-tools.js';
import { setPhaseOpen, renderPhases, renderResources, renderThinkAbout } from '/js/phases.js';

// ===== SHOW RESULTS =====
export function showResults() {
  $('setup-screen').classList.add('hidden');
  $('results-screen').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
  // Same tab as before "Edit My Info" (in memory), else the one this browser tab last used
  // for this plan (sessionStorage), else Overview.
  setActiveTab(ui.activeTab || rememberedTab() || 'overview');
  renderResults();
  // Move focus (and the document title) to the new screen so a screen-reader user
  // hears that the form was replaced, instead of focus silently landing on <body>
  // when #submitBtn disappears underneath it.
  const title = $('resultTitle');
  if (title) { title.focus(); document.title = `${title.textContent} — Military Transition Calculator`; }
}

export function showSetup() {
  $('results-screen').classList.add('hidden');
  $('setup-screen').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
  document.title = 'Military Transition & Retirement Calculator';
  showSetupStep(1);
  const heading = $('setupTitle');
  if (heading) heading.focus();
}

// ===== RENDER =====
// Horizontal timeline: proportional markers from today → freedom day. Status
// colors come from the same milestoneStatus() the card grid uses.
// Label geometry, shared with the CSS (.tl-box width, .timeline-track min-width).
const TL_LABEL_W = 84;
const TL_LABEL_GAP = 8;
const TL_PX_PER_MARKER = 90;

// Spread label centres so no two in the same row are closer than `spacing`, keeping each as
// near its true x as possible. Positions arrive sorted. Clusters of overlapping labels are
// centred on the mean of their dots, then the whole row is clamped inside [lo, hi] with a
// forward + backward pass so nothing hangs off either edge of the track.
function dodgeLabels(xs, spacing, lo, hi) {
  const clusters = [];
  for (const x of xs) {
    let c = { sum: x, n: 1 };
    clusters.push(c);
    // Merge leftwards while this cluster overlaps the previous one.
    while (clusters.length > 1) {
      const prev = clusters[clusters.length - 2];
      const prevRight = prev.sum / prev.n + ((prev.n - 1) * spacing) / 2;
      const curLeft = c.sum / c.n - ((c.n - 1) * spacing) / 2;
      if (prevRight + spacing <= curLeft) break;
      clusters.pop();
      c = { sum: prev.sum + c.sum, n: prev.n + c.n };
      clusters[clusters.length - 1] = c;
    }
  }
  const out = [];
  for (const c of clusters) {
    const left = c.sum / c.n - ((c.n - 1) * spacing) / 2;
    for (let k = 0; k < c.n; k++) out.push(left + k * spacing);
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], lo, i ? out[i - 1] + spacing : lo);
  for (let i = out.length - 1; i >= 0; i--) out[i] = Math.min(out[i], hi, i < out.length - 1 ? out[i + 1] - spacing : hi);
  return out;
}

export function renderTimeline(milestones, today, sep) {
  const track = $('timelineTrack');
  if (!track || !milestones.length) return;
  // A full plan (retirement + VA claim + married + clearance, etc.) can produce 20+
  // milestones. Give the track room per marker (.timeline-scroll scrolls horizontally) — but
  // room alone is not enough: BDD close, SkillBridge end, PTDY start/end and terminal leave
  // can all fall inside a fortnight, so the labels are also dodged sideways (see dodgeLabels)
  // and joined to their dot by an elbow leader. Everything is laid out in px on the minimum
  // track width and emitted as percentages, so a wider viewport only spreads things further.
  const W = Math.max(640, milestones.length * TL_PX_PER_MARKER);
  track.style.minWidth = W + 'px';
  const times = milestones.map(m => m.date.getTime());
  const axisStart = Math.min(today.getTime(), ...times);
  const axisEnd = Math.max(sep.getTime(), ...times);
  const span = Math.max(1, axisEnd - axisStart);
  const pad = TL_LABEL_W / 2;
  const xOf = (t) => pad + clamp((t - axisStart) / span, 0, 1) * (W - 2 * pad);
  const pct = (px) => (px / W) * 100;

  // Alternate rows by date order, then dodge each row independently.
  const rows = [[], []];
  milestones.forEach((m, i) => rows[i % 2].push(i));
  const labelX = new Array(milestones.length);
  for (const row of rows) {
    const placed = dodgeLabels(row.map(i => xOf(times[i])), TL_LABEL_W + TL_LABEL_GAP, pad, W - pad);
    row.forEach((i, k) => { labelX[i] = placed[k]; });
  }

  const todayX = xOf(today.getTime());
  let html = '<div class="timeline-axis"></div><div class="timeline-fill" data-css-width="' + pct(todayX) + '%"></div>';
  milestones.forEach((m, i) => {
    const x = xOf(times[i]);
    const lx = labelX[i];
    const st = milestoneStatus(daysBetween(today, m.date));
    const dotClass = st === 'past' ? 'status-red' : (st === 'future' ? 'status-green' : 'status-gold');
    const statusText = st === 'past' ? 'Past' : (st === 'today' ? 'Today' : (st === 'soon' ? 'Due soon' : 'Upcoming'));
    const pos = (i % 2 === 0) ? 'tl-above' : 'tl-below';
    const displaced = Math.abs(lx - x) > 0.5;
    // No aria-labels here: the whole track is aria-hidden (the milestone grid above is the
    // accessible representation), so labelling the dots only produced a second reading.
    html += '<span class="tl-dot ' + dotClass + '" data-css-left="' + pct(x) + '%"></span>';
    if (displaced) {
      // Elbow: stem up/down from the dot, a shelf across to the label's x, a short drop.
      html += '<span class="tl-lead tl-lead-stem ' + pos + '" data-css-left="' + pct(x) + '%"></span>'
        + '<span class="tl-lead tl-lead-shelf ' + pos + '" data-css-left="' + pct(Math.min(x, lx)) + '%" data-css-width="' + pct(Math.abs(lx - x)) + '%"></span>'
        + '<span class="tl-lead tl-lead-drop ' + pos + '" data-css-left="' + pct(lx) + '%"></span>';
    } else {
      html += '<span class="tl-lead tl-lead-full ' + pos + '" data-css-left="' + pct(x) + '%"></span>';
    }
    html += '<div class="tl-box ' + pos + '" data-css-left="' + pct(lx) + '%"><div class="tl-label">' + escapeHtml(m.label) + '</div><div class="tl-date">' + fmtDateShort(m.date) + '</div><div class="tl-status">' + statusText + '</div></div>';
  });
  track.innerHTML = html;
}

// ===== SCENARIO COMPARISON =====
// Everything the panel needs is derived from the plan plus one alternative date, so nothing
// is persisted — this is a what-if, and saving it would make the plan ambiguous.
export function scenarioDefaultYos(altSep) {
  const s = ui.state;
  if (!s) return 0;
  const base = new Date(s.sepDate + 'T00:00:00');
  const yearsShifted = daysBetween(base, altSep) / 365.25;
  // Whole years only: you don't cross a longevity step part-way.
  return clamp(Math.round((Number(s.yos) || 0) + yearsShifted), 1, 40);
}

export function renderScenario() {
  const box = $('scenarioResult');
  if (!box || !ui.state) return;
  const raw = $('scenarioDate').value;
  if (!raw) {
    box.innerHTML = '<p class="text-navy-400">Pick a date above to compare it against your current plan.</p>';
    return;
  }
  const altSep = new Date(raw + 'T00:00:00');
  if (isNaN(altSep.getTime())) { box.innerHTML = '<p class="text-navy-400">That date could not be read.</p>'; return; }

  const yosField = $('scenarioYos');
  const altYos = clamp(numOr(parseInt(yosField.value, 10), scenarioDefaultYos(altSep)), 1, 40);
  const today = new Date(ui.state.todayDate + 'T00:00:00');
  const planB = { ...ui.state, sepDate: raw, yos: altYos };
  const cmp = compareScenarios(ui.state, planB, today, { monthlyAllowances: (ui.state.bah || 0) + getBAS(ui.state.rankCat) });
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
export function renderDayMeter(segments, totalDays, sbActive) {
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
export const MILESTONE_STATUS_STYLE = {
  past:   { statusClass: 'status-red',   color: '#ef4444', sr: 'overdue' },
  today:  { statusClass: 'status-gold',  color: '#f59e0b', sr: 'due today' },
  soon:   { statusClass: 'status-gold',  color: '#f59e0b', sr: 'due soon' },
  future: { statusClass: 'status-green', color: '#10b981', sr: 'on track' },
};

// Advisories are dated GUIDANCE, not deadlines, and are rendered deliberately outside the
// milestone grid so they are never painted red/overdue. See computeMilestones().
export function renderAdvisories(advisories, today) {
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

export function renderResults() {
  const s = ui.state;
  const bm = BRANCH_META[s.branch] || { color:'#1a2744', emoji:'🎖️', terms:{ spec:'Specialty', member:'Member', nco:'NCO' } };
  const today = new Date(s.todayDate + 'T00:00:00');
  const sep = new Date(s.sepDate + 'T00:00:00');
  const isRet = s.transType === 'Retirement';

  $('resultTitle').textContent = `${s.firstName}'s Transition Plan`;
  $('branchBadge').textContent = `${bm.emoji} ${s.branch}`;
  $('branchBadge').style.background = bm.color;
  // Not classList.remove('hidden'): the markup's `hidden md:inline` is what keeps this off
  // phones, where the header already wraps. Removing the class showed it everywhere.
  $('rankBadge').textContent = `${s.rank} · ${s.yos} years`;

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

  // 25 cards on a full plan pushed everything else on the Overview below the fold. Show what
  // is coming up next; the rest (everything already past, and the post-separation deadlines
  // years out) is one click away and always printed.
  const MILESTONES_SHOWN = 6;
  const upcomingIdx = milestones.findIndex(m => daysBetween(today, m.date) >= 0);
  const firstShown = Math.max(0, upcomingIdx);
  const grid = $('milestoneGrid');
  const showAll = grid.dataset.showAll === 'true';
  grid.innerHTML = milestones.map((m, i) => {
    const diff = daysBetween(today, m.date);
    const folded = !showAll && (i < firstShown || i >= firstShown + MILESTONES_SHOWN);
    // milestoneStatus() in calc.js is the single source of truth for this ladder, shared
    // with the horizontal timeline. The grid used to reimplement it inline, so tuning a
    // threshold in one place silently desynchronized the cards from the timeline.
    const { statusClass, color } = MILESTONE_STATUS_STYLE[milestoneStatus(diff)];
    const relText = diff === 0 ? 'Today' : (diff > 0 ? `In ${diff} days` : `${Math.abs(diff)} days ago`);
    return `
      <div class="milestone-card"${folded ? ' hidden' : ''}>
        <div class="flex items-center gap-2">
          <div class="status-dot ${statusClass}"></div>
          <span class="text-xs font-medium text-navy-400 uppercase tracking-wide">${escapeHtml(m.label)}</span>
        </div>
        <p class="text-base font-semibold text-navy-700 flex items-center gap-2"><i data-lucide="${m.icon}" class="w-4 h-4 text-gold-500"></i> ${fmtDate(m.date)}</p>
        <p class="text-xs tabular-nums" data-css-color="${color}">${relText}<span class="sr-only">, ${MILESTONE_STATUS_STYLE[milestoneStatus(diff)].sr}</span></p>
        ${m.description ? `<p class="text-xs text-navy-500 leading-relaxed mt-1">${escapeHtml(m.description)}</p>` : ''}
      </div>`;
  }).join('');
  const moreBtn = $('milestoneMoreBtn');
  if (moreBtn) {
    const past = firstShown;
    const later = Math.max(0, milestones.length - firstShown - MILESTONES_SHOWN);
    moreBtn.hidden = past + later === 0;
    const detail = [past ? `${past} past` : '', later ? `${later} further out` : ''].filter(Boolean).join(', ');
    moreBtn.textContent = showAll ? "Show only what's next" : `Show all ${milestones.length} milestones${detail ? ` (${detail})` : ''}`;
    moreBtn.setAttribute('aria-expanded', String(showAll));
  }

  renderAdvisories(advisories, today);

  ui.lastMilestones = milestones;
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

export function wireResults() {
  $('milestoneMoreBtn')?.addEventListener('click', () => {
    const grid = $('milestoneGrid');
    grid.dataset.showAll = grid.dataset.showAll === 'true' ? 'false' : 'true';
    renderResults();
    $('milestoneMoreBtn')?.focus();
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

  $('jumpToPayBtn').addEventListener('click', () => {
    setActiveTab('pay');
    setCollapsibleOpen('payEstimatorHeader', 'payEstimatorContent', 'payChevron', true);
    scrollToUnderSticky($('payEstimatorSection'));
  });

}
