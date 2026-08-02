// ===== store.js =====
// Capability-URL persistence: a plan lives in D1 behind a public id (the /p/<id> URL) and
// a secret edit key (the #k=<key> hash). No accounts. The page calls configure() with the
// URL's id+key on boot, createPlan() on first save, and savePlan() for edits. A copy is
// always mirrored to localStorage so the same browser can recover (and restore the URL).

const LS_KEY = "military-transition-calc-v6"; // { plan, id, editKey, rev }
const SCHEMA_VERSION = 5;

let planId = null;
let editKey = null;
let rev = 0;
let readOnly = false;
let lastSavedAt = null;
let saveTimer = null;
let conflictHandler = null; // async (serverPlan) => "mine" | "theirs"
// 'idle' | 'pending' (debounce running) | 'saving' (request in flight) | 'saved' |
// 'error' (network/server failure — the edit is still safe in localStorage) |
// 'conflict' (409, being routed to conflictHandler). Exists so the UI can show a
// Saving.../Saved/Couldn't save indicator instead of failing completely silently.
let saveState = "idle";
const listeners = new Set();

function emit() {
  const s = getStatus();
  for (const fn of listeners) { try { fn(s); } catch { /* ignore */ } }
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onConflict(fn) { conflictHandler = fn; }
export function getStatus() { return { planId, editKey, readOnly, lastSavedAt, saveState, retryScheduled: retryTimer !== null }; }
export function isReadOnly() { return readOnly; }
export function hasPlan() { return !!planId; }
export function getEditUrl() { return planId && editKey ? `${location.origin}/p/${planId}#k=${editKey}` : null; }
export function getViewUrl() { return planId ? `${location.origin}/p/${planId}` : null; }

// Adopt the id/key parsed from the current URL. readOnly when we have an id but no key.
export function configure({ id, key }) {
  planId = id || null;
  editKey = key || null;
  rev = 0;
  readOnly = !!planId && !editKey;
}

async function apiFetch(path, opts = {}) {
  const method = opts.method || (opts.body !== undefined ? "POST" : "GET");
  /** @type {Record<string, string>} */
  const headers = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    return { ok: false, status: 0, data: null };
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

// ----- localStorage cache (same-browser recovery) -----
function cacheLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
function cacheSave(plan) {
  // Never overwrite the visitor's own cached plan (and edit key!) while they're viewing
  // someone else's read-only link, and never cache a null/corrupt plan over a good copy
  // (a server row that fails to JSON.parse comes back as {plan: null}, not an error).
  if (readOnly || !plan) return;
  try { localStorage.setItem(LS_KEY, JSON.stringify({ plan, id: planId, editKey, rev })); } catch { /* quota */ }
}
export function cacheClear() { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } }
export function getCached() { return cacheLoad(); }

// ----- load / create / save -----
// Fetch the plan named by configure()'s id.
//
// Returns a DISCRIMINATED result, not just a plan-or-null: "this plan doesn't exist" and
// "your phone has no signal" are completely different things to tell a user, and collapsing
// both to null meant a returning visitor on a flaky connection was told their plan was gone.
//   { status: "ok", plan, rev } | { status: "not_found" } | { status: "offline" } | { status: "error" }
export async function loadRemote() {
  if (!planId) return { status: "not_found" };
  const { ok, status, data } = await apiFetch(`/api/p/${planId}`);
  if (ok && data) {
    const serverRev = typeof data.rev === "number" ? data.rev : 0;
    rev = serverRev;
    // Never let the server's copy clobber a NEWER local one. If a save failed (offline,
    // 500, rate limit) the good edit lives only in localStorage at a higher rev; blindly
    // caching the server plan on the next load silently discarded it — while the UI still
    // claimed a copy was "kept in this browser".
    const cached = cacheLoad();
    const localIsNewer = cached && cached.id === planId && typeof cached.rev === "number" && cached.rev > serverRev;
    if (localIsNewer) {
      return { status: "ok", plan: cached.plan, rev: cached.rev, recoveredLocal: true, serverPlan: data.plan };
    }
    cacheSave(data.plan);
    return { status: "ok", plan: data.plan, rev: serverRev };
  }
  if (status === 404) return { status: "not_found" };
  if (status === 0) return { status: "offline" };
  return { status: "error", httpStatus: status };
}

// Create a brand-new plan; on success we own it (id + edit key). Returns {id, editKey} or null.
export async function createPlan(plan) {
  const { ok, data } = await apiFetch("/api/p", { method: "POST", body: { plan, schema_version: SCHEMA_VERSION } });
  if (ok && data && data.id) {
    planId = data.id; editKey = data.edit_key; rev = data.rev || 1; readOnly = false;
    lastSavedAt = Date.now(); cacheSave(plan); emit();
    return { id: planId, editKey };
  }
  cacheSave(plan); // keep a local copy even if the create failed
  return null;
}

// Debounced save of an edit. No-op to the server for read-only links or before a plan exists
// (the page creates on submit); always mirrors to localStorage.
export function savePlan(plan) {
  cacheSave(plan);
  if (readOnly || !planId || !editKey) { lastSavedAt = readOnly ? lastSavedAt : Date.now(); emit(); return; }
  // A fresh edit supersedes anything queued for retry — push the newer plan, not the old one.
  cancelRetry();
  saveState = "pending"; emit();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { pushPlan(plan); }, 800);
}

// Transient failures (offline, 5xx, 429) are retried with backoff before the UI is told the
// save failed. Without this, one dropped request left a red "Couldn't save" that nothing
// would ever clear on its own — the user had to notice and manually re-edit something.
const RETRY_DELAYS_MS = [1000, 3000, 8000];
let retryTimer = null;
let pendingRetryPlan = null;

function isTransient(status) { return status === 0 || status === 429 || status >= 500; }

export function cancelRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  pendingRetryPlan = null;
}

// True while an edit exists that has not reached the server. The page uses this to warn on
// unload rather than letting the tab close over an unsaved change.
export function hasUnsavedWork() {
  return saveState === "pending" || saveState === "saving" || saveState === "error" || saveState === "conflict";
}

// Immediate update. Optimistic concurrency on rev → 409 routed to the conflict handler.
export async function pushPlan(plan, attempt = 0) {
  cacheSave(plan);
  if (readOnly || !planId || !editKey) return false;
  saveState = "saving"; emit();
  const res = await apiFetch(`/api/p/${planId}`, {
    method: "PUT",
    body: { plan, schema_version: SCHEMA_VERSION, edit_key: editKey, base_rev: rev },
  });
  if (res.ok && res.data) {
    if (typeof res.data.rev === "number") rev = res.data.rev;
    cancelRetry();
    lastSavedAt = Date.now(); saveState = "saved"; emit(); return true;
  }
  if (res.status === 409) {
    const current = res.data && res.data.current;
    if (current && typeof current.rev === "number") rev = current.rev; // adopt server rev for a retry
    saveState = "conflict"; emit();
    if (conflictHandler) {
      // Pass the server row's metadata too, so the UI can tell the user WHEN the other
      // version was saved instead of asking them to choose blind.
      const choice = await conflictHandler(current ? current.plan : null, current || null);
      if (choice === "mine") return pushPlan(plan);
    }
    saveState = "error"; emit();
    return false;
  }
  if (isTransient(res.status) && attempt < RETRY_DELAYS_MS.length) {
    pendingRetryPlan = plan;
    saveState = "error"; emit(); // the indicator shows "Retrying…" off this + a scheduled retry
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (pendingRetryPlan) pushPlan(pendingRetryPlan, attempt + 1);
    }, RETRY_DELAYS_MS[attempt]);
    return false;
  }
  saveState = "error"; emit();
  return false; // permanent failure (403 / 400) — local cache already kept the edit
}

// User-initiated retry from the save indicator, independent of the backoff schedule.
export async function retryNow(plan) {
  cancelRetry();
  return pushPlan(plan, 0);
}

// Permanently delete the plan behind this capability URL. Requires the edit key.
export async function deletePlan() {
  if (readOnly || !planId || !editKey) return false;
  const res = await apiFetch(`/api/p/${planId}`, { method: "DELETE", body: { edit_key: editKey } });
  if (res.ok) {
    cancelRetry();
    cacheClear();
    planId = null; editKey = null; rev = 0; saveState = "idle"; lastSavedAt = null;
    emit();
    return true;
  }
  return false;
}
