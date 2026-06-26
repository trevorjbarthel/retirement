import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { getUserById } from "../db/queries";
import type { AppContext } from "../env";

async function resolveUserId(c: Context<AppContext>): Promise<number | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifySessionToken(token, c.env.SESSION_SECRET);
  if (!payload) return null;
  const user = await getUserById(c.env.DB, payload.userId);
  if (!user || user.token_version !== payload.tokenVersion) return null;
  return user.id;
}

/** Sets userId when a valid session exists; never blocks. */
export const optionalAuth = createMiddleware<AppContext>(async (c, next) => {
  const id = await resolveUserId(c);
  if (id) c.set("userId", id);
  await next();
});

/** Requires a valid session; 401 otherwise. */
export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const id = await resolveUserId(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", id);
  await next();
});

/**
 * CSRF posture for a same-origin JSON SPA: state-changing requests must carry a
 * custom header that a cross-site HTML form cannot set without a CORS preflight.
 */
export const csrfGuard = createMiddleware<AppContext>(async (c, next) => {
  const m = c.req.method;
  if (m === "POST" || m === "PUT" || m === "DELETE" || m === "PATCH") {
    if (c.req.header("X-Requested-With") !== "fetch") {
      return c.json({ error: "csrf" }, 403);
    }
  }
  await next();
});
