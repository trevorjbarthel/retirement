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
const listeners = new Set();

function emit() {
  const s = getStatus();
  for (const fn of listeners) { try { fn(s); } catch { /* ignore */ } }
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onConflict(fn) { conflictHandler = fn; }
export function getStatus() { return { planId, editKey, readOnly, lastSavedAt }; }
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
  try { localStorage.setItem(LS_KEY, JSON.stringify({ plan, id: planId, editKey, rev })); } catch { /* quota */ }
}
export function cacheClear() { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } }
export function getCached() { return cacheLoad(); }

// ----- load / create / save -----
// Fetch the plan named by configure()'s id. Returns the plan, or null (404 / network).
export async function loadRemote() {
  if (!planId) return null;
  const { ok, data } = await apiFetch(`/api/p/${planId}`);
  if (ok && data) { rev = typeof data.rev === "number" ? data.rev : 0; cacheSave(data.plan); return data.plan; }
  return null;
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
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { pushPlan(plan); }, 800);
}

// Immediate update. Optimistic concurrency on rev → 409 routed to the conflict handler.
export async function pushPlan(plan) {
  cacheSave(plan);
  if (readOnly || !planId || !editKey) return false;
  const res = await apiFetch(`/api/p/${planId}`, {
    method: "PUT",
    body: { plan, schema_version: SCHEMA_VERSION, edit_key: editKey, base_rev: rev },
  });
  if (res.ok && res.data) {
    if (typeof res.data.rev === "number") rev = res.data.rev;
    lastSavedAt = Date.now(); emit(); return true;
  }
  if (res.status === 409) {
    const current = res.data && res.data.current;
    if (current && typeof current.rev === "number") rev = current.rev; // adopt server rev for a retry
    if (conflictHandler) {
      const choice = await conflictHandler(current ? current.plan : null);
      if (choice === "mine") return pushPlan(plan);
    }
    return false;
  }
  return false; // network / 403 / etc. — local cache already kept the edit
}
