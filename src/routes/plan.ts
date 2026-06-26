import { Hono } from "hono";
import type { AppContext } from "../env";
import { jsonError } from "../lib/json";
import { optionalAuth, requireAuth } from "../auth/middleware";
import { clearSession } from "../auth/session";
import { deleteUser, getPlan, getUserById, upsertPlan } from "../db/queries";

const api = new Hono<AppContext>();

const MAX_PLAN_BYTES = 64 * 1024;

// Who am I? Drives logged-in vs guest UI on boot.
api.get("/me", optionalAuth, async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ user: null });
  const user = await getUserById(c.env.DB, userId);
  return c.json({ user: user ? { id: user.id, email: user.email } : null });
});

api.get("/plan", requireAuth, async (c) => {
  const userId = c.get("userId")!;
  const row = await getPlan(c.env.DB, userId);
  if (!row) return c.json({ plan: null, schema_version: null, updated_at: null });
  let plan: unknown = null;
  try {
    plan = JSON.parse(row.plan_json);
  } catch {
    plan = null;
  }
  return c.json({ plan, schema_version: row.schema_version, updated_at: row.updated_at });
});

api.put("/plan", requireAuth, async (c) => {
  const userId = c.get("userId")!;
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "invalid_input", 400);
  }
  const plan = body?.plan;
  if (typeof plan !== "object" || plan === null || Array.isArray(plan)) {
    return jsonError(c, "invalid_input", 400, "plan must be an object.");
  }
  const planJson = JSON.stringify(plan);
  if (planJson.length > MAX_PLAN_BYTES) return jsonError(c, "too_large", 413, "Plan is too large.");
  const schemaVersion = Number.isFinite(Number(body?.schema_version)) ? Number(body.schema_version) : 1;
  const updated_at = await upsertPlan(c.env.DB, userId, planJson, schemaVersion);
  return c.json({ updated_at });
});

api.delete("/account", requireAuth, async (c) => {
  const userId = c.get("userId")!;
  await deleteUser(c.env.DB, userId);
  clearSession(c);
  return c.body(null, 204);
});

export default api;
