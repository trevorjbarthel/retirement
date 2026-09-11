// ===== phases.js =====
// The Checklist and Resources tabs: the phase checklist renderer, "Things to Think About",
// and the resource grid.

import {
  buildPhases
} from '/js/calc.js';
import * as store from '/js/store.js';
import { ui } from '/js/ui-state.js';
import { $, fmtDateShort, escapeHtml, $$, $1, afterRender } from '/js/dom.js';
import { loadChecks, saveChecks, applyReadOnlyControls } from '/js/plan-io.js';

// ===== PHASES =====
// Shared by renderPhases' wiring and the print-export open/restore flow.
export function setPhaseOpen(header, open) {
  const content = $('content-' + header.dataset.phase);
  const chev = $1('.phase-chevron', header);
  if (!content) return;
  content.classList.toggle('open', open);
  header.setAttribute('aria-expanded', String(open));
  if (open) content.removeAttribute('inert'); else content.setAttribute('inert', '');
  if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
}

export function renderPhases(today, sep, termStart, ptdyStart, ptdyEnd, sbStart, sbEnd, tapDeadline, isRet) {
  const s = ui.state;
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
      if (span) span.classList.toggle('is-done', cb.checked);
      const phaseId = cb.dataset.phase;
      const allInPhase = $$(`input[data-phase="${phaseId}"]`);
      const doneCount = [...allInPhase].filter(c => c.checked).length;
      const pctNew = Math.round((doneCount / allInPhase.length) * 100);
      const header = $1(`.phase-header[data-phase="${phaseId}"]`);
      if (header) {
        const badge = $1('.rounded-full:first-of-type', header);
        if (badge) { badge.textContent = pctNew + '%'; badge.classList.toggle('is-complete', pctNew === 100); }
        const bar = $1('.progress-animate', header);
        if (bar) { bar.style.width = pctNew + '%'; bar.classList.toggle('is-complete', pctNew === 100); }
      }
    });
  });
}

// ===== RESOURCES =====
export function renderResources() {
  const s = ui.state;
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
export function renderThinkAbout() {
  const s = ui.state;
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
