// ===== store.js =====
// Persistence abstraction: talks to the D1-backed API when the user is signed
// in, and falls back to localStorage for guests / offline. The render code in
// index.html only ever calls saveState/loadState — which now route through here.

const LS_KEY = "military-transition-calc-v5"; // unchanged: preserves existing guest data
const LS_UID_KEY = "military-transition-calc-owner"; // which account the cache belongs to
const SCHEMA_VERSION = 5;

let mode = "guest"; // "guest" | "auth"
let currentUser = null;
let lastSavedAt = null;
let saveTimer = null;
let knownRev = 0; // last server revision this tab has seen (0 = no saved plan yet)
let conflictHandler = null; // async (serverPlan) => "mine" | "theirs"
const listeners = new Set();

// The host page registers how to resolve a concurrent-edit conflict (another tab/device
// wrote a newer version). "mine" overwrites with this tab's state; "theirs" keeps the server's.
export function onConflict(fn) { conflictHandler = fn; }

// Cancel any queued debounced PUT. MUST run before an identity/state transition (and
// before any await) so a stale write can't fire during the request or after a cache clear.
function cancelPendingSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
}

function emit() {
  const s = getStatus();
  for (const fn of listeners) {
    try { fn(s); } catch { /* ignore listener errors */ }
  }
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getStatus() {
  return { mode, user: currentUser, lastSavedAt };
}
export function isAuthed() {
  return mode === "auth";
}
export function getUser() {
  return currentUser;
}

async function apiFetch(path, opts = {}) {
  const method = opts.method || (opts.body !== undefined ? "POST" : "GET");
  const headers = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-Requested-With"] = "fetch"; // CSRF token-less guard
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: null };
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

// ----- auth -----
export async function bootAuth() {
  const { data } = await apiFetch("/api/me");
  currentUser = data && data.user ? data.user : null;
  mode = currentUser ? "auth" : "guest";
  emit();
  return currentUser;
}

export async function register(email, password) {
  cancelPendingSave(); knownRev = 0;
  const r = await apiFetch("/api/auth/register", { body: { email, password } });
  if (r.ok && r.data) { currentUser = r.data.user; mode = "auth"; emit(); }
  return r;
}
export async function login(email, password) {
  cancelPendingSave(); knownRev = 0;
  const r = await apiFetch("/api/auth/login", { body: { email, password } });
  if (r.ok && r.data) { currentUser = r.data.user; mode = "auth"; emit(); }
  return r;
}
export async function logout() {
  cancelPendingSave(); knownRev = 0;
  await apiFetch("/api/auth/logout", { method: "POST" });
  // Clear the local cache too (mirrors deleteAccount): the cached plan belongs to the
  // account we're leaving, and must not leak to the next person on a shared browser.
  lsClear();
  currentUser = null; mode = "guest"; lastSavedAt = null; emit();
}
export async function changePassword(current, next) {
  return apiFetch("/api/auth/change-password", { body: { current, next } });
}
export async function deleteAccount() {
  cancelPendingSave(); knownRev = 0;
  const r = await apiFetch("/api/account", { method: "DELETE" });
  if (r.ok) { currentUser = null; mode = "guest"; lastSavedAt = null; lsClear(); emit(); }
  return r;
}

// ----- localStorage (guest / fallback / cache) -----
function lsLoad() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
}
function lsSave(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    // Tag the cache with its owning account so a transient API failure can't surface
    // it to a different signed-in user; guests leave it untagged.
    if (mode === "auth" && currentUser) localStorage.setItem(LS_UID_KEY, String(currentUser.id));
    else localStorage.removeItem(LS_UID_KEY);
  } catch { /* quota */ }
}
function cacheOwner() {
  try { return localStorage.getItem(LS_UID_KEY); } catch { return null; }
}
export function lsClear() {
  try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_UID_KEY); } catch { /* ignore */ }
}
export function getLocalPlan() {
  return lsLoad();
}
export function hasLocalPlan() {
  const p = lsLoad();
  return !!(p && p.firstName && p.sepDate);
}

// ----- unified load/save -----
export async function loadPlan() {
  if (mode === "auth") {
    const { ok, status, data } = await apiFetch("/api/plan");
    if (ok && data) {
      knownRev = typeof data.rev === "number" ? data.rev : 0; // base for optimistic concurrency
      if (data.schema_version != null && data.schema_version < SCHEMA_VERSION) {
        // No client-side migration ladder exists yet; make the gap observable rather than
        // letting the next autosave silently re-stamp it to the current version.
        console.warn(`Loaded plan schema_version ${data.schema_version} < ${SCHEMA_VERSION}; no migration ran.`);
      }
      return data.plan; // plan object or null (signed in, nothing saved yet)
    }
    if (status === 401) { // session expired/invalid → drop to guest, don't surface stale cache
      lsClear(); currentUser = null; mode = "guest"; lastSavedAt = null; emit();
      return null;
    }
    // Transient network/5xx: only use the cache if it belongs to THIS account, never
    // another user's or untagged guest data.
    if (currentUser && cacheOwner() === String(currentUser.id)) return lsLoad();
    return null;
  }
  return lsLoad();
}

// Debounced save. Always writes a local cache; when signed in, also syncs to D1.
export function savePlan(state) {
  lsSave(state);
  if (mode === "auth") {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { pushPlan(state); }, 800);
  } else {
    lastSavedAt = Date.now();
    emit();
  }
}

// Immediate sync (used for guest→account migration and "save now"). Uses optimistic
// concurrency: sends the last-seen rev as base_rev; a 409 means another tab/device wrote
// a newer version, which we resolve via the host's conflict handler instead of clobbering.
export async function pushPlan(state) {
  if (mode !== "auth") { lsSave(state); lastSavedAt = Date.now(); emit(); return true; }
  const res = await apiFetch("/api/plan", {
    method: "PUT",
    body: { plan: state, schema_version: SCHEMA_VERSION, base_rev: knownRev },
  });
  if (res.ok && res.data) {
    if (typeof res.data.rev === "number") knownRev = res.data.rev;
    lastSavedAt = Date.now(); emit(); return true;
  }
  if (res.status === 409) {
    lsSave(state); // never lose the user's local edits
    const current = res.data && res.data.current;
    // Adopt the server's rev so a "keep mine" retry can succeed at the new base.
    if (current && typeof current.rev === "number") knownRev = current.rev;
    if (conflictHandler) {
      const choice = await conflictHandler(current ? current.plan : null);
      if (choice === "mine") return pushPlan(state); // retry at the new base → overwrites
    }
    return false; // "theirs" (handler applied the server plan) or no handler
  }
  lsSave(state); // network failure → keep a local copy
  return false;
}
