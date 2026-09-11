// ===== ui-state.js =====
// The app's mutable UI state, shared by the feature modules. It is ONE exported object rather
// than a set of exported `let`s because an imported binding is read-only: `ui.state = plan`
// works from any module, `state = plan` would not. Everything not listed here is local to
// the module that owns it.
export const ui = {
  /** The current plan. */
  state: /** @type {any} */ ({}),
  // setup form selections that are not plain <input>s
  rankCat: '',
  transType: '',
  toggles: { ptdy: true, sb: true, giBill: false, vaClaim: false, married: false, homeowner: false, clearance: false, federalJob: false, oconus: false },
  // pay estimator selections
  payRetSystem: 'high3',
  selectedVARating: 0,
  hasDependents: false,
  tspContribMode: 'fixed',
  tspWithdrawalMethod: 'fixed',
  // Demo mode: every write is a no-op so browsing the sample can't clobber a real plan.
  sampleMode: false,
  // The milestones from the last render, for the .ics export.
  lastMilestones: /** @type {any[]} */ ([]),
  // Active results tab; null until the results screen has been shown once this page load.
  activeTab: /** @type {string|null} */ (null),
};
