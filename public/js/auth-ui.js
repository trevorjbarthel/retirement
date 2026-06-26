// ===== auth-ui.js =====
// Header account control + login/register modal. Talks to the API via store.js
// and coordinates guest→account plan migration. The modal markup is built here
// so index.html only needs an empty #accountArea container in the header.

import * as store from "./store.js";

let opts = { getCurrentState: () => null, onPlanLoaded: () => {} };
let modal = null;
let authMode = "login"; // "login" | "register" | "forgot" | "reset"
let lastFocused = null; // element to restore focus to when the modal closes
let resetToken = null;  // token from a ?reset= link, consumed by the reset form

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

// ---------- account area ----------
// Rendered into every container that exists: the results-screen header (#accountArea)
// and the setup-screen control (#accountAreaSetup), so a guest can sign in before they
// have built a plan.
function renderAccountArea(status) {
  ["accountArea", "accountAreaSetup"].forEach((id) => {
    const area = document.getElementById(id);
    if (area) renderAccountInto(area, status);
  });
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
}

function renderAccountInto(area, status) {
  area.innerHTML = "";

  const indicator = el("span", { class: "text-xs text-navy-400 hidden sm:inline" });
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
    logout.addEventListener("click", async () => {
      await store.logout();
      // Reboot in guest mode so the displayed plan/results are fully cleared, not just the header.
      location.reload();
    });
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
      <p id="authSubtitle" class="helper-text mb-3" style="display:none;"></p>
      <form id="authForm" novalidate>
        <div id="authEmailRow">
          <label class="block text-sm font-medium text-navy-600 mb-1" for="authEmail">Email</label>
          <input id="authEmail" name="email" type="email" autocomplete="email" class="input-field mb-3" />
        </div>
        <div id="authPasswordRow">
          <label id="authPasswordLabel" class="block text-sm font-medium text-navy-600 mb-1" for="authPassword">Password</label>
          <input id="authPassword" name="password" type="password" autocomplete="current-password" class="input-field mb-1" />
          <p id="authHint" class="helper-text mb-2">At least 12 characters.</p>
        </div>
        <p id="authError" class="error-msg mb-2" role="alert"></p>
        <button id="authSubmit" type="submit" class="w-full text-white font-semibold py-3 rounded-xl mt-1" style="background: linear-gradient(135deg,#1a2744 0%,#2e3f66 100%);">Sign in</button>
        <p id="authForgotRow" class="text-xs text-center mt-3"><button type="button" id="authForgot" class="text-navy-400 hover:text-navy-600 hover:underline">Forgot password?</button></p>
      </form>
      <p id="authNotice" class="text-sm text-navy-600 mt-3 text-center" style="display:none;"></p>
      <p id="authToggleRow" class="text-sm text-navy-500 mt-4 text-center">
        <span id="authTogglePrompt">New here?</span>
        <button type="button" id="authToggle" class="text-gold-600 font-medium hover:underline">Create an account</button>
      </p>
      <p id="authPrivacy" class="text-xs text-navy-400 mt-3 text-center">Your plan syncs securely to your account. Guest data stays in this browser.</p>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  overlay.querySelector("#authClose").addEventListener("click", closeModal);
  overlay.querySelector("#authToggle").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
  overlay.querySelector("#authForgot").addEventListener("click", () => setAuthMode("forgot"));
  overlay.querySelector("#authForm").addEventListener("submit", onSubmit);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeModal(); });
  // Trap Tab/Shift+Tab within the dialog while it's open (aria-modal alone doesn't do this).
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || overlay.classList.contains("hidden")) return;
    const focusable = Array.from(
      overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((n) => !n.disabled && n.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  return overlay;
}

// Modes: "login" | "register" | "forgot" (request a reset link) | "reset" (set new password).
function setAuthMode(m) {
  authMode = m;
  const $ = (id) => modal.querySelector(id);
  const show = (id, on) => { const e = $(id); if (e) e.style.display = on ? "" : "none"; };
  const t = $("#authTitle"), sub = $("#authSubmit"), prompt = $("#authTogglePrompt"), toggle = $("#authToggle");
  const pw = $("#authPassword"), hint = $("#authHint"), subtitle = $("#authSubtitle"), pwLabel = $("#authPasswordLabel");

  // Defaults, overridden per mode.
  $("#authForm").style.display = "";
  show("#authNotice", false);
  show("#authToggleRow", true);
  show("#authPrivacy", true);
  show("#authForgotRow", false);
  show("#authEmailRow", true);
  show("#authPasswordRow", true);
  subtitle.style.display = "none";
  pwLabel.textContent = "Password";

  if (m === "register") {
    t.textContent = "Create your account"; sub.textContent = "Create account";
    prompt.textContent = "Already have an account?"; toggle.textContent = "Sign in";
    pw.setAttribute("autocomplete", "new-password"); hint.style.display = "";
  } else if (m === "forgot") {
    t.textContent = "Reset your password"; sub.textContent = "Send reset link";
    subtitle.textContent = "Enter your email and we'll send you a link to set a new password.";
    subtitle.style.display = "";
    show("#authPasswordRow", false); show("#authPrivacy", false);
    prompt.textContent = "Remembered it?"; toggle.textContent = "Back to sign in";
  } else if (m === "reset") {
    t.textContent = "Set a new password"; sub.textContent = "Update password";
    subtitle.textContent = "Choose a new password for your account."; subtitle.style.display = "";
    show("#authEmailRow", false); show("#authToggleRow", false); show("#authPrivacy", false);
    pwLabel.textContent = "New password"; pw.setAttribute("autocomplete", "new-password"); hint.style.display = "";
  } else {
    t.textContent = "Sign in"; sub.textContent = "Sign in";
    prompt.textContent = "New here?"; toggle.textContent = "Create an account";
    pw.setAttribute("autocomplete", "current-password"); hint.style.display = "none";
    show("#authForgotRow", true);
  }
  sub.disabled = false;
  showError("");
}

function openModal(m) {
  if (!modal) modal = buildModal();
  lastFocused = document.activeElement; // restore focus here on close
  setAuthMode(m || "login");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  const focusId = m === "reset" ? "#authPassword" : "#authEmail";
  setTimeout(() => { const f = modal.querySelector(focusId); if (f) f.focus(); }, 30);
}

// Opened from an email reset link (?reset=<token>).
export function openResetFlow(token) {
  resetToken = token;
  openModal("reset");
}
function closeModal() {
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  showError("");
  modal.querySelector("#authForm").reset();
  if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  lastFocused = null;
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
  invalid_or_expired: "This reset link is invalid or has expired. Request a new one.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  csrf: "Security check failed. Please reload and try again.",
  too_large: "That plan is too large to save.",
};

async function onSubmit(e) {
  e.preventDefault();
  const submit = modal.querySelector("#authSubmit");
  const email = modal.querySelector("#authEmail").value.trim();
  const password = modal.querySelector("#authPassword").value;
  showError("");

  if (authMode === "forgot") {
    submit.disabled = true;
    await store.forgotPassword(email); // always 204 — show the same confirmation either way
    submit.disabled = false;
    modal.querySelector("#authForm").style.display = "none";
    const notice = modal.querySelector("#authNotice");
    notice.textContent = "If an account exists for that email, a reset link is on its way. Check your inbox (and spam).";
    notice.style.display = "";
    modal.querySelector("#authTogglePrompt").textContent = "Done?";
    modal.querySelector("#authToggle").textContent = "Back to sign in";
    return;
  }

  if (authMode === "reset") {
    submit.disabled = true;
    const r = await store.resetPassword(resetToken, password);
    submit.disabled = false;
    if (!r.ok) {
      const code = r.data && r.data.error;
      showError((r.data && r.data.message) || ERR_TEXT[code] || "This reset link is invalid or has expired.");
      return;
    }
    resetToken = null;
    closeModal();
    await runMigration(); // signed in against the new password → load the account's plan
    return;
  }

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
      const ok = await store.pushPlan(candidate);
      opts.onPlanLoaded(candidate);
      if (!ok) opts.onSyncFailed(); // upload failed (network / too_large) — tell the user
      return;
    }
  }
  opts.onPlanLoaded(null);
}

export function initAuthUI(options = {}) {
  opts = { getCurrentState: () => null, onPlanLoaded: () => {}, onSyncFailed: () => {}, ...options };
  store.onChange(renderAccountArea);
  renderAccountArea(store.getStatus());
}
