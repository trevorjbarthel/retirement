import { Hono } from "hono";
import type { Context } from "hono";
import type { AppContext } from "../env";
import { jsonError } from "../lib/json";
import { isValidEmail, normalizeEmail, passwordIssue } from "../lib/validate";
import { hashPassword, verifyPassword } from "../auth/password";
import { clearSession, issueSession } from "../auth/session";
import { requireAuth } from "../auth/middleware";
import {
  createUser,
  getUserByEmail,
  getUserById,
  updateUserHash,
  updateUserPasswordAndRevoke,
} from "../db/queries";

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

export default auth;
