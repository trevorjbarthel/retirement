// ===== store.js =====
// Persistence abstraction: talks to the D1-backed API when the user is signed
// in, and falls back to localStorage for guests / offline. The render code in
// index.html only ever calls saveState/loadState — which now route through here.

const LS_KEY = "military-transition-calc-v5"; // unchanged: preserves existing guest data
const SCHEMA_VERSION = 5;

let mode = "guest"; // "guest" | "auth"
let currentUser = null;
let lastSavedAt = null;
let saveTimer = null;
const listeners = new Set();

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
  const r = await apiFetch("/api/auth/register", { body: { email, password } });
  if (r.ok && r.data) { currentUser = r.data.user; mode = "auth"; emit(); }
  return r;
}
export async function login(email, password) {
  const r = await apiFetch("/api/auth/login", { body: { email, password } });
  if (r.ok && r.data) { currentUser = r.data.user; mode = "auth"; emit(); }
  return r;
}
export async function logout() {
  await apiFetch("/api/auth/logout", { method: "POST" });
  currentUser = null; mode = "guest"; lastSavedAt = null; emit();
}
export async function changePassword(current, next) {
  return apiFetch("/api/auth/change-password", { body: { current, next } });
}
export async function deleteAccount() {
  const r = await apiFetch("/api/account", { method: "DELETE" });
  if (r.ok) { currentUser = null; mode = "guest"; lastSavedAt = null; lsClear(); emit(); }
  return r;
}

// ----- localStorage (guest / fallback / cache) -----
function lsLoad() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
}
function lsSave(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota */ }
}
export function lsClear() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
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
    const { ok, data } = await apiFetch("/api/plan");
    if (ok && data) return data.plan; // plan object or null (signed in, nothing saved yet)
    // fall through to local cache on error
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

// Immediate sync (used for guest→account migration and "save now").
export async function pushPlan(state) {
  if (mode !== "auth") { lsSave(state); lastSavedAt = Date.now(); emit(); return true; }
  const { ok } = await apiFetch("/api/plan", {
    method: "PUT",
    body: { plan: state, schema_version: SCHEMA_VERSION },
  });
  if (ok) { lastSavedAt = Date.now(); emit(); return true; }
  lsSave(state); // network failure → keep a local copy
  return false;
}
