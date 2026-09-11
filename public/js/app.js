// ===== app.js =====
// The application entry point. Feature code lives in the sibling modules (see README
// "Architecture"); this file only wires them up in order and boots the right plan.
//
// Module-scope state shared between features lives in ui-state.js as one exported object;
// everything else is local to the module that owns it. calc.js (pure domain logic) and
// store.js (persistence) are unchanged by the split.

import { afterRender } from '/js/dom.js';
import { wireSetupForm, updateSkillbridgeLimit } from '/js/setup-form.js';
import { wirePlanIO, loadInitialPlan } from '/js/plan-io.js';
import { wireResults } from '/js/results.js';
import { wireCalendar } from '/js/calendar-view.js';
import { wirePayEstimator } from '/js/pay-estimator.js';
import { wireDecisionTools } from '/js/decision-tools.js';
import { wireTabs } from '/js/tabs.js';

async function init() {
  wireSetupForm();
  wirePlanIO();
  wireResults();
  wireCalendar();
  wirePayEstimator();
  wireDecisionTools();
  wireTabs();
  await loadInitialPlan();
  updateSkillbridgeLimit();
}

// Paint the icons already present in the static markup. No guard needed: the path data is
// imported, not fetched, so it is always available by the time this module runs.
afterRender();

init();
