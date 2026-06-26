import { Hono } from "hono";
import type { AppContext } from "../env";
import { jsonError } from "../lib/json";
import { optionalAuth, requireAuth } from "../auth/middleware";
import { clearSession } from "../auth/session";
import { deleteUser, getPlan, getUserById, upsertPlan, upsertPlanCAS } from "../db/queries";

const api = new Hono<AppContext>();

const MAX_PLAN_BYTES = 64 * 1024;
const enc = new TextEncoder();

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
  if (!row) return c.json({ plan: null, schema_version: null, updated_at: null, rev: 0 });
  let plan: unknown = null;
  try {
    plan = JSON.parse(row.plan_json);
  } catch {
    plan = null;
  }
  return c.json({ plan, schema_version: row.schema_version, updated_at: row.updated_at, rev: row.rev });
});

// Shape the server's current row for a conflict response (parse plan_json once).
function planView(row: { plan_json: string; schema_version: number; updated_at: number; rev: number } | null) {
  if (!row) return null;
  let plan: unknown = null;
  try {
    plan = JSON.parse(row.plan_json);
  } catch {
    plan = null;
  }
  return { plan, schema_version: row.schema_version, updated_at: row.updated_at, rev: row.rev };
}

api.put("/plan", requireAuth, async (c) => {
  const userId = c.get("userId")!;
  // Cheap early reject before buffering/parsing the body. Content-Length is the whole
  // envelope (larger than the inner plan), so allow generous headroom; the post-stringify
  // byte check below is authoritative. Content-Length may be absent or spoofed.
  const len = Number(c.req.header("content-length"));
  if (Number.isFinite(len) && len > MAX_PLAN_BYTES * 2) return jsonError(c, "too_large", 413, "Plan is too large.");
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
  // Measure UTF-8 bytes (what D1 stores), not UTF-16 code units, so multi-byte
  // content (CJK, emoji) can't slip ~3x past the intended byte budget.
  if (enc.encode(planJson).byteLength > MAX_PLAN_BYTES) return jsonError(c, "too_large", 413, "Plan is too large.");
  // Store a positive, bounded integer schema_version; anything else normalizes to 1.
  const rawVersion = Math.trunc(Number(body?.schema_version));
  const schemaVersion = Number.isInteger(rawVersion) && rawVersion >= 1 && rawVersion <= 1000 ? rawVersion : 1;

  // Optimistic concurrency: a client that sends base_rev gets compare-and-set semantics
  // (stale token → 409 with the server's current plan). A client that omits it (legacy)
  // keeps the old unconditional behavior.
  const rawBaseRev = body?.base_rev;
  if (rawBaseRev === undefined || rawBaseRev === null) {
    const r = await upsertPlan(c.env.DB, userId, planJson, schemaVersion);
    return c.json({ updated_at: r.updated_at, rev: r.rev });
  }
  const expectedRev = Math.trunc(Number(rawBaseRev));
  if (!Number.isInteger(expectedRev) || expectedRev < 0) {
    return jsonError(c, "invalid_input", 400, "base_rev must be a non-negative integer.");
  }
  const r = await upsertPlanCAS(c.env.DB, userId, planJson, schemaVersion, expectedRev);
  if (r.ok) return c.json({ updated_at: r.updated_at, rev: r.rev });
  return c.json({ error: "conflict", current: planView(r.current) }, 409);
});

api.delete("/account", requireAuth, async (c) => {
  const userId = c.get("userId")!;
  await deleteUser(c.env.DB, userId);
  clearSession(c);
  return c.body(null, 204);
});

export default api;
