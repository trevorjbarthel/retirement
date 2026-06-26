// ===== auth-ui.js =====
// Header account control + login/register modal. Talks to the API via store.js
// and coordinates guest→account plan migration. The modal markup is built here
// so index.html only needs an empty #accountArea container in the header.

import * as store from "./store.js";

let opts = { getCurrentState: () => null, onPlanLoaded: () => {} };
let modal = null;
let authMode = "login"; // "login" | "register"

function el(tag, attrs = {}, html) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function fmtSaved(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

// ---------- header account area ----------
function renderAccountArea(status) {
  const area = document.getElementById("accountArea");
  if (!area) return;
  area.innerHTML = "";

  const indicator = el("span", { class: "text-xs text-navy-400 hidden sm:inline", id: "saveIndicator" });
  if (status.mode === "auth") {
    indicator.textContent = status.lastSavedAt ? `Saved to account · ${fmtSaved(status.lastSavedAt)}` : "Synced to your account";
    indicator.style.color = "#047857";
  } else {
    indicator.textContent = status.lastSavedAt ? "Saved in this browser" : "";
  }

  if (status.mode === "auth") {
    const email = el("span", { class: "text-xs font-medium text-navy-500 hidden md:inline" });
    email.textContent = status.user ? status.user.email : "";
    const logout = el(
      "button",
      { class: "no-print text-sm font-medium text-navy-500 hover:text-navy-700 px-2 py-1 rounded-lg hover:bg-navy-50", type: "button" },
      '<i data-lucide="log-out" class="w-4 h-4 inline"></i> Log out',
    );
    logout.addEventListener("click", () => store.logout());
    const del = el(
      "button",
      { class: "no-print text-xs text-danger-700 hover:underline px-1", type: "button", title: "Delete account" },
      "Delete",
    );
    del.addEventListener("click", async () => {
      if (confirm("Permanently delete your account and saved plan? This cannot be undone.")) {
        await store.deleteAccount();
      }
    });
    area.append(indicator, email, logout, del);
  } else {
    const signIn = el(
      "button",
      { class: "no-print flex items-center gap-1.5 text-sm font-medium text-gold-600 hover:text-gold-700 px-3 py-1.5 rounded-lg hover:bg-gold-50", type: "button" },
      '<i data-lucide="user" class="w-4 h-4"></i> Sign in',
    );
    signIn.addEventListener("click", () => openModal("login"));
    area.append(indicator, signIn);
  }
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
}

// ---------- modal ----------
function buildModal() {
  const overlay = el("div", {
    id: "authModal",
    class: "fixed inset-0 z-50 hidden items-center justify-center p-4",
    style: "background: rgba(12,18,32,0.55);",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "authTitle",
  });
  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" role="document">
      <div class="flex items-center justify-between mb-4">
        <h2 id="authTitle" class="text-lg font-bold text-navy-700">Sign in</h2>
        <button type="button" id="authClose" aria-label="Close" class="text-navy-400 hover:text-navy-700 text-xl leading-none">&times;</button>
      </div>
      <form id="authForm" novalidate>
        <label class="block text-sm font-medium text-navy-600 mb-1" for="authEmail">Email</label>
        <input id="authEmail" name="email" type="email" autocomplete="email" class="input-field mb-3" required />
        <label class="block text-sm font-medium text-navy-600 mb-1" for="authPassword">Password</label>
        <input id="authPassword" name="password" type="password" autocomplete="current-password" class="input-field mb-1" required />
        <p id="authHint" class="helper-text mb-2">At least 12 characters.</p>
        <p id="authError" class="error-msg mb-2" role="alert"></p>
        <button id="authSubmit" type="submit" class="w-full text-white font-semibold py-3 rounded-xl mt-1" style="background: linear-gradient(135deg,#1a2744 0%,#2e3f66 100%);">Sign in</button>
      </form>
      <p class="text-sm text-navy-500 mt-4 text-center">
        <span id="authTogglePrompt">New here?</span>
        <button type="button" id="authToggle" class="text-gold-600 font-medium hover:underline">Create an account</button>
      </p>
      <p class="text-xs text-navy-400 mt-3 text-center">Your plan syncs securely to your account. Guest data stays in this browser.</p>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector("#authClose").addEventListener("click", closeModal);
  overlay.querySelector("#authToggle").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
  overlay.querySelector("#authForm").addEventListener("submit", onSubmit);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeModal(); });
  return overlay;
}

function setAuthMode(m) {
  authMode = m;
  const t = modal.querySelector("#authTitle");
  const sub = modal.querySelector("#authSubmit");
  const prompt = modal.querySelector("#authTogglePrompt");
  const toggle = modal.querySelector("#authToggle");
  const pw = modal.querySelector("#authPassword");
  const hint = modal.querySelector("#authHint");
  if (m === "register") {
    t.textContent = "Create your account";
    sub.textContent = "Create account";
    prompt.textContent = "Already have an account?";
    toggle.textContent = "Sign in";
    pw.setAttribute("autocomplete", "new-password");
    hint.style.display = "";
  } else {
    t.textContent = "Sign in";
    sub.textContent = "Sign in";
    prompt.textContent = "New here?";
    toggle.textContent = "Create an account";
    pw.setAttribute("autocomplete", "current-password");
    hint.style.display = "none";
  }
  showError("");
}

function openModal(m) {
  if (!modal) modal = buildModal();
  setAuthMode(m || "login");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  const email = modal.querySelector("#authEmail");
  setTimeout(() => email && email.focus(), 30);
}
function closeModal() {
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  showError("");
  modal.querySelector("#authForm").reset();
}
function showError(msg) {
  const e = modal && modal.querySelector("#authError");
  if (!e) return;
  e.textContent = msg || "";
  e.classList.toggle("show", !!msg);
}

const ERR_TEXT = {
  invalid_input: "Please check your email and password (12+ characters).",
  email_taken: "That email is already registered. Try signing in.",
  invalid_credentials: "Incorrect email or password.",
  csrf: "Security check failed. Please reload and try again.",
  too_large: "That plan is too large to save.",
};

async function onSubmit(e) {
  e.preventDefault();
  const submit = modal.querySelector("#authSubmit");
  const email = modal.querySelector("#authEmail").value.trim();
  const password = modal.querySelector("#authPassword").value;
  showError("");
  submit.disabled = true;
  const r = authMode === "register" ? await store.register(email, password) : await store.login(email, password);
  submit.disabled = false;
  if (!r.ok) {
    const code = r.data && r.data.error;
    showError((r.data && r.data.message) || ERR_TEXT[code] || "Something went wrong. Please try again.");
    return;
  }
  closeModal();
  await runMigration();
}

// After login/register: load the server plan, or offer to upload the in-browser plan.
async function runMigration() {
  const serverPlan = await store.loadPlan(); // mode is now "auth"
  if (serverPlan && serverPlan.firstName) {
    opts.onPlanLoaded(serverPlan);
    return;
  }
  const candidate = (opts.getCurrentState && opts.getCurrentState()) || store.getLocalPlan();
  if (candidate && candidate.firstName && candidate.sepDate) {
    if (confirm("Upload the plan from this browser to your account?")) {
      await store.pushPlan(candidate);
      opts.onPlanLoaded(candidate);
      return;
    }
  }
  opts.onPlanLoaded(null);
}

export function initAuthUI(options = {}) {
  opts = { getCurrentState: () => null, onPlanLoaded: () => {}, ...options };
  store.onChange(renderAccountArea);
  renderAccountArea(store.getStatus());
}
