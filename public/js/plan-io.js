// ===== plan-io.js =====
// Everything that moves a plan in or out of the page: save/load through store.js, the
// capability-link banners, backup/import, the sample plan, deletion, the first-save and
// conflict dialogs, and the boot sequence that decides which plan to show.

import {
  clamp, DATA_VINTAGE, migrateChecks, buildICS, isValidState
} from '/js/calc.js';
import * as store from '/js/store.js';
import { ui } from '/js/ui-state.js';
import { $, todayLocalStr, escapeHtml, $$, afterRender, showToast, announce, showModal } from '/js/dom.js';
import { validate, buildState, revealStepOf } from '/js/setup-form.js';
import { rememberTab } from '/js/tabs.js';
import { showResults } from '/js/results.js';

// ===== SAVE / LOAD =====
// Persistence routes through store.js: a plan lives at /p/<id> in D1, cached in localStorage.
//
// `sampleMode` makes every write a no-op. Without it, browsing the demo plan would mirror it
// into localStorage under the same key as a real plan — overwriting a returning visitor's
// own plan AND the edit key that is their only way back to it.
export function saveState(s) { if (ui.sampleMode) return; store.savePlan(s); }

// Checklist state travels inside the plan (state.checks), persisted via saveState.
export function loadChecks() { return (ui.state && ui.state.checks) || {}; }
export function saveChecks(checks) { if (ui.state) { ui.state.checks = checks; saveState(ui.state); } }

// Masks the secret key portion of an edit URL (everything from #k= on) so it isn't
// sitting in plain text by default — someone glancing at a shared screen, a recording,
// or a screenshot shouldn't be able to read the credential off it at a glance.
export function maskEditUrl(url) {
  return url.replace(/(#k=)([^&]+)/, (_, prefix, key) => prefix + '•'.repeat(Math.min(key.length, 24)));
}

export let planLinkVisible = false;

// Disable the controls a read-only viewer cannot use. Called after every render that can
// create checkboxes, since the checklist is rebuilt on each pass.
export function applyReadOnlyControls() {
  const ro = store.isReadOnly();
  $$('#phaseList input[type="checkbox"]').forEach((cb) => {
    cb.disabled = ro;
    if (ro) cb.setAttribute('title', "You're viewing a shared plan — changes aren't saved.");
    else cb.removeAttribute('title');
  });
}

// Reflect the current plan's link/read-only state in the header + banners.
export function renderPlanLink() {
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
  // Every path that changes which plan this page holds ends here (first save, /p/<id> load,
  // import, copy). Re-key the remembered tab under the new id: on a brand-new plan the tab
  // was chosen before createPlan() minted the id, so it was stored under "local".
  if (ui.activeTab) rememberTab(ui.activeTab);
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
export function downloadBackup() {
  if (!ui.state || !ui.state.firstName) { showToast('Build your plan first'); return; }
  const blob = new Blob([JSON.stringify(ui.state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'transition-plan.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Backup downloaded');
}

// The link IS the credential: no email, no password, no reset. Losing it loses the plan.
export async function showFirstSaveModal() {
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
export function showPlanLoading(on) {
  const el = $('planLoadingState');
  if (!el) return;
  el.classList.toggle('hidden', !on);
  $('setup-form')?.classList.toggle('hidden', on);
  if (on) afterRender();
}

export function showPlanLoadError({ title, body, tone = 'error', retry = false }) {
  const el = $('planLoadError');
  if (!el) return;
  const palette = tone === 'warn' ? { cls: 'note-warn', icon: 'alert-triangle' } : { cls: 'note-danger note-danger-deep', icon: 'cloud-off' };
  el.classList.remove('note-warn', 'note-danger', 'note-danger-deep');
  el.classList.add(...palette.cls.split(' '));
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

// ===== INIT =====
// Apply a loaded plan (from the account or localStorage) and show results.
export const RESUME_BANNER_DISMISS_KEY = 'mtc-resume-banner-dismissed';

export function showResumeBanner(id, key) {
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

export function applyLoadedPlan(plan) {
  // Plans loaded from a shared /p/<id> link or the local cache are untrusted input —
  // the server stores whatever JSON it's handed (see src/routes/plan.ts), so a shared
  // link is a viable XSS delivery path unless every field is allow-listed here before
  // it ever reaches a render function. Also escapeHtml at every innerHTML sink below
  // (defense-in-depth) — this check must not be the only thing standing in the way.
  if (!isValidState(plan)) { showToast('That plan link contains invalid data and was not loaded.'); return; }
  ui.state = plan;
  // The countdown is relative to the viewer's actual "now", not a date frozen into a
  // plan saved on a prior day (or shared by someone else). Refresh it on every load;
  // also repairs a missing/malformed todayDate that would otherwise render NaN.
  ui.state.todayDate = todayLocalStr();
  // Defense-in-depth: coerce day fields to safe integers so a malformed loaded plan
  // can never reach an innerHTML sink as a string (see escapeHtml + isValidState).
  const toInt = (v, dflt, lo, hi) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? clamp(n, lo, hi) : dflt; };
  ui.state.sbDays = toInt(ui.state.sbDays, 0, 0, 180);
  ui.state.ptdyDays = toInt(ui.state.ptdyDays, 0, 0, 30);
  ui.state.leaveDays = toInt(ui.state.leaveDays, 60, 0, 120);
  ui.state.payBasePay = Number.isFinite(+ui.state.payBasePay) ? Math.max(0, +ui.state.payBasePay) : 0;
  ui.toggles.ptdy = ui.state.ptdy;
  ui.toggles.sb = ui.state.sb;
  ui.toggles.giBill = ui.state.giBill || false;
  ui.toggles.vaClaim = ui.state.vaClaim || false;
  ui.toggles.married = ui.state.married || false;
  ui.toggles.homeowner = ui.state.homeowner || false;
  ui.toggles.clearance = ui.state.clearance || false;
  ui.toggles.federalJob = ui.state.federalJob || false;
  ui.toggles.oconus = ui.state.oconus || false;
  ui.rankCat = ui.state.rankCat;
  ui.transType = ui.state.transType;
  ui.payRetSystem = ui.state.payRetSystem || 'high3';
  ui.selectedVARating = ui.state.selectedVARating || 0;
  ui.hasDependents = ui.state.hasDependents || false;
  ui.tspWithdrawalMethod = ui.state.tspWithdrawalMethod || 'fixed';
  ui.tspContribMode = ui.state.tspContribMode || 'fixed';
  ui.state.checks = migrateChecks(ui.state.checks, ui.state);
  showResults();
  renderPlanLink();
}

export function wirePlanIO() {
  $('setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate()) {
      const invalid = $$('[aria-invalid="true"]');
      const fs = $('form-status');
      if (fs) fs.textContent = `${invalid.length} field${invalid.length === 1 ? '' : 's'} need attention — please review the highlighted fields.`;
      const first = invalid[0];
      revealStepOf(first); // the error may be on the step that isn't showing
      if (first && typeof first.focus === 'function') first.focus();
      return;
    }
    if ($('form-status')) $('form-status').textContent = '';
    const prevChecks = (ui.state && ui.state.checks) || {};
    ui.state = buildState();
    ui.state.checks = prevChecks; // keep checklist progress across edits
    showResults();
    if (store.isReadOnly()) {
      renderPlanLink(); // viewing a shared plan — local edits only, can't save
    } else if (store.hasPlan()) {
      saveState(ui.state); // editing an existing plan → update it
      renderPlanLink();
    } else if (ui.sampleMode) {
      // Submitting the form is an explicit "this is mine now" — leave demo mode so the
      // plan is really created and cached.
      ui.sampleMode = false;
      $('sampleModeBanner')?.classList.add('hidden');
      const created = await store.createPlan(ui.state);
      history.replaceState(null, '', created ? `/p/${created.id}#k=${created.editKey}` : (location.pathname + location.search));
      renderPlanLink();
      if (created) showFirstSaveModal();
      else showToast('Saved in this browser — couldn\'t create an online link');
    } else {
      // Brand-new plan → create it server-side to mint the shareable link.
      const created = await store.createPlan(ui.state);
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
    ui.sampleMode = true;
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
    // The shared <dialog>, like every other decision in the app — window.confirm() can be
    // suppressed by the browser, and its OK/Cancel gave no way to offer the backup first.
    const choice = await showModal({
      title: 'Permanently delete this plan?',
      bodyHtml: `
        <p>The link <span class="mono text-xs break-all">${escapeHtml(store.getViewUrl() || '')}</span> will stop working for everyone, including anyone you shared it with.</p>
        <p>This cannot be undone — there is no backup on the server and no account to recover from. Download a backup first if you want to keep a copy.</p>`,
      actions: [
        { value: 'cancel', label: 'Keep my plan', style: 'secondary' },
        { value: 'backup', label: 'Download a backup first' },
        { value: 'delete', label: 'Delete permanently', style: 'danger' },
      ],
    });
    if (choice === 'backup') { downloadBackup(); return; }
    if (choice !== 'delete') return;
    const deleted = await store.deletePlan();
    if (deleted) {
      showToast('Plan deleted');
      setTimeout(() => { location.href = '/'; }, 800);
    } else {
      showToast("Couldn't delete — check your connection and try again");
    }
  });
  $('makeCopyBtn').addEventListener('click', async () => {
    if (!ui.state.firstName) { showToast('Nothing to copy yet'); return; }
    const created = await store.createPlan(ui.state);
    if (created) location.href = `/p/${created.id}#k=${created.editKey}`; // reload into your own editable copy
    else showToast('Could not create a copy — check your connection');
  });

  // Calendar (.ics) export of every milestone.
  $('icsBtn').addEventListener('click', () => {
    if (!ui.lastMilestones.length) { showToast('Build your plan first'); return; }
    const ics = buildICS(ui.lastMilestones, { calName: (ui.state.firstName || 'My') + ' Transition Plan', now: new Date() });
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
    if (retryBtn) retryBtn.addEventListener('click', () => { if (ui.state) store.retryNow(ui.state); });
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

}
export async function loadInitialPlan() {
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

}
