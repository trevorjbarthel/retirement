import { Hono } from "hono";
import type { Context } from "hono";
import type { AppContext } from "../env";
import { jsonError } from "../lib/json";
import { isValidEmail, normalizeEmail, passwordIssue } from "../lib/validate";
import { hashPassword, verifyPassword } from "../auth/password";
import { clearSession, issueSession } from "../auth/session";
import { requireAuth } from "../auth/middleware";
import { generateResetToken, hashToken } from "../auth/tokens";
import { sendResetEmail } from "../auth/email";
import {
  createUser,
  createPasswordReset,
  findValidReset,
  getUserByEmail,
  getUserById,
  invalidateUserResets,
  markResetUsed,
  updateUserHash,
  updateUserPasswordAndRevoke,
} from "../db/queries";

const RESET_TTL_SECONDS = 3600; // password-reset links are valid for 1 hour

const auth = new Hono<AppContext>();

function iterations(env: AppContext["Bindings"]): number {
  const n = Number(env.PBKDF2_ITERATIONS);
  return Number.isFinite(n) && n > 0 ? n : 210000;
}

/**
 * Best-effort throttle for a credential endpoint, keyed by client IP (+ account).
 * No-op when the AUTH_LIMITER binding isn't configured (local dev / tests / an
 * un-provisioned deploy), and never blocks on a limiter failure. Returns true when
 * the caller should be rejected with 429.
 */
async function throttled(c: Context<AppContext>, scope: string): Promise<boolean> {
  const limiter = c.env.AUTH_LIMITER;
  if (!limiter) return false;
  const ip = c.req.header("cf-connecting-ip") ?? "ip-unknown";
  try {
    const { success } = await limiter.limit({ key: `${scope}:${ip}` });
    return !success;
  } catch {
    return false;
  }
}

const RATE_LIMITED = (c: Context<AppContext>) =>
  jsonError(c, "rate_limited", 429, "Too many attempts. Please wait a moment and try again.");

auth.post("/register", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "invalid_input", 400);
  }
  const email = normalizeEmail(String(body?.email ?? ""));
  const password = String(body?.password ?? "");
  if (!isValidEmail(email)) return jsonError(c, "invalid_input", 400, "Enter a valid email address.");
  const pwIssue = passwordIssue(password);
  if (pwIssue) return jsonError(c, "invalid_input", 400, pwIssue);
  if (await throttled(c, "register")) return RATE_LIMITED(c);

  // Always do the PBKDF2 work, even for an already-registered email, so registration
  // timing doesn't reveal whether an account exists (mirrors the /login hardening).
  const cost = iterations(c.env);
  const { hash, salt } = await hashPassword(password, cost);

  if (await getUserByEmail(c.env.DB, email)) return jsonError(c, "email_taken", 409, "That email is already registered.");

  // The UNIQUE(email) constraint is the source of truth: concurrent double-submits can
  // both pass the check above, so map a unique-violation to the same 409 (not a 500).
  let user;
  try {
    user = await createUser(c.env.DB, { email, hash, salt, iterations: cost });
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? ""))) {
      return jsonError(c, "email_taken", 409, "That email is already registered.");
    }
    throw e;
  }
  await issueSession(c, user);
  return c.json({ user: { id: user.id, email: user.email } }, 201);
});

auth.post("/login", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "invalid_input", 400);
  }
  const email = normalizeEmail(String(body?.email ?? ""));
  const password = String(body?.password ?? "");
  if (!email || !password) return jsonError(c, "invalid_input", 400);
  if (await throttled(c, "login")) return RATE_LIMITED(c);

  const user = await getUserByEmail(c.env.DB, email);
  if (!user) {
    // Equalize timing + avoid email enumeration: do the work, then fail the same way.
    await hashPassword(password, iterations(c.env));
    return jsonError(c, "invalid_credentials", 401, "Incorrect email or password.");
  }

  const ok = await verifyPassword(password, user.password_hash, user.password_salt, user.iterations);
  if (!ok) return jsonError(c, "invalid_credentials", 401, "Incorrect email or password.");

  // Transparent cost upgrade if the global iteration count has been raised.
  const target = iterations(c.env);
  if (user.iterations < target) {
    const upgraded = await hashPassword(password, target);
    await updateUserHash(c.env.DB, user.id, upgraded.hash, upgraded.salt, target);
  }

  await issueSession(c, user);
  return c.json({ user: { id: user.id, email: user.email } });
});

auth.post("/logout", async (c) => {
  clearSession(c);
  return c.body(null, 204);
});

auth.post("/change-password", requireAuth, async (c) => {
  const userId = c.get("userId")!;
  if (await throttled(c, "change-password")) return RATE_LIMITED(c);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "invalid_input", 400);
  }
  const current = String(body?.current ?? "");
  const next = String(body?.next ?? "");
  const pwIssue = passwordIssue(next);
  if (pwIssue) return jsonError(c, "invalid_input", 400, pwIssue);

  const user = await getUserById(c.env.DB, userId);
  if (!user) return jsonError(c, "unauthorized", 401);
  const ok = await verifyPassword(current, user.password_hash, user.password_salt, user.iterations);
  if (!ok) return jsonError(c, "invalid_credentials", 401, "Current password is incorrect.");

  // Reject a no-op change (after proving knowledge of the current password) so we don't
  // needlessly bump token_version and sign the user out of their other sessions.
  if (next === current) return jsonError(c, "invalid_input", 400, "New password must be different from your current password.");

  const { hash, salt } = await hashPassword(next, iterations(c.env));
  await updateUserPasswordAndRevoke(c.env.DB, user.id, hash, salt, iterations(c.env));
  // Re-issue this device's cookie against the new token_version so the user stays signed in here.
  const fresh = await getUserById(c.env.DB, user.id);
  if (fresh) await issueSession(c, fresh);
  return c.body(null, 204);
});

// Request a reset link. ALWAYS returns 204 (whether or not the email exists) and does
// comparable work in both branches, so it can't be used to enumerate accounts.
auth.post("/forgot", async (c) => {
  if (await throttled(c, "forgot")) return RATE_LIMITED(c);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "invalid_input", 400);
  }
  const email = normalizeEmail(String(body?.email ?? ""));
  if (isValidEmail(email)) {
    const user = await getUserByEmail(c.env.DB, email);
    if (user) {
      await invalidateUserResets(c.env.DB, user.id); // one live token at a time
      const raw = generateResetToken();
      const tokenHash = await hashToken(raw);
      await createPasswordReset(c.env.DB, user.id, tokenHash, Math.floor(Date.now() / 1000) + RESET_TTL_SECONDS);
      const origin = (c.env.APP_BASE_URL && c.env.APP_BASE_URL.replace(/\/+$/, "")) || new URL(c.req.url).origin;
      await sendResetEmail(c.env, user.email, `${origin}/?reset=${raw}`);
    } else {
      await hashToken(generateResetToken()); // equalize timing for an unknown email
    }
  }
  return c.body(null, 204);
});

// Consume a reset token and set a new password. The token is single-use and short-lived;
// a successful reset bumps token_version (revoking all existing sessions) and signs the
// user in on this device. Invalid / expired / used tokens all return the same 400.
auth.post("/reset", async (c) => {
  if (await throttled(c, "reset")) return RATE_LIMITED(c);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "invalid_input", 400);
  }
  const token = String(body?.token ?? "");
  const password = String(body?.password ?? "");
  const pwIssue = passwordIssue(password);
  if (pwIssue) return jsonError(c, "invalid_input", 400, pwIssue);

  const invalid = () => jsonError(c, "invalid_or_expired", 400, "This reset link is invalid or has expired.");
  if (!token) return invalid();
  const row = await findValidReset(c.env.DB, await hashToken(token), Math.floor(Date.now() / 1000));
  if (!row) return invalid();
  const user = await getUserById(c.env.DB, row.user_id);
  if (!user) return invalid();

  const cost = iterations(c.env);
  const { hash, salt } = await hashPassword(password, cost);
  await updateUserPasswordAndRevoke(c.env.DB, user.id, hash, salt, cost); // bumps token_version
  await markResetUsed(c.env.DB, row.id); // single-use
  const fresh = await getUserById(c.env.DB, user.id);
  if (fresh) await issueSession(c, fresh); // land signed in against the new token_version
  return c.json({ user: { id: user.id, email: user.email } });
});

export default auth;
