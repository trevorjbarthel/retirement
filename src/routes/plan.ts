import { Hono } from "hono";
import type { AppContext } from "../env";
import { jsonError } from "../lib/json";
import { createPlan, getPlan, updatePlanCAS } from "../db/queries";
import { randomToken, hashToken } from "../lib/tokens";

const api = new Hono<AppContext>();

const MAX_PLAN_BYTES = 64 * 1024;
const enc = new TextEncoder();

// Returns the JSON string, null if not a plain object, or "__too_large__" if over budget.
function validPlanJson(plan: unknown): string | null {
  if (typeof plan !== "object" || plan === null || Array.isArray(plan)) return null;
  const planJson = JSON.stringify(plan);
  if (enc.encode(planJson).byteLength > MAX_PLAN_BYTES) return "__too_large__";
  return planJson;
}

function schemaVersionOf(body: any): number {
  const raw = Math.trunc(Number(body?.schema_version));
  return Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : 1;
}

// Create a new plan → returns its public id and the secret edit key (shown once).
api.post("/p", async (c) => {
  const len = Number(c.req.header("content-length"));
  if (Number.isFinite(len) && len > MAX_PLAN_BYTES * 2) return jsonError(c, "too_large", 413, "Plan is too large.");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "invalid_input", 400);
  }
  const planJson = validPlanJson(body?.plan);
  if (planJson === null) return jsonError(c, "invalid_input", 400, "plan must be an object.");
  if (planJson === "__too_large__") return jsonError(c, "too_large", 413, "Plan is too large.");

  const editKey = randomToken(16);
  const editKeyHash = await hashToken(editKey);
  const schemaVersion = schemaVersionOf(body);

  // Retry on the (astronomically unlikely) id collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomToken(12);
    try {
      const { updated_at, rev } = await createPlan(c.env.DB, { id, editKeyHash, planJson, schemaVersion });
      return c.json({ id, edit_key: editKey, schema_version: schemaVersion, updated_at, rev }, 201);
    } catch (e) {
      if (/UNIQUE constraint failed/i.test(String((e as Error)?.message ?? "")) && attempt < 4) continue;
      throw e;
    }
  }
  return jsonError(c, "server_error", 500); // unreachable in practice
});

// Read a plan by id (read-only; no key needed).
api.get("/p/:id", async (c) => {
  const row = await getPlan(c.env.DB, c.req.param("id"));
  if (!row) return jsonError(c, "not_found", 404);
  let plan: unknown = null;
  try {
    plan = JSON.parse(row.plan_json);
  } catch {
    plan = null;
  }
  return c.json({ plan, schema_version: row.schema_version, updated_at: row.updated_at, rev: row.rev });
});

// Update a plan. Requires the edit key; uses optimistic concurrency on rev.
api.put("/p/:id", async (c) => {
  const id = c.req.param("id");
  const len = Number(c.req.header("content-length"));
  if (Number.isFinite(len) && len > MAX_PLAN_BYTES * 2) return jsonError(c, "too_large", 413, "Plan is too large.");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, "invalid_input", 400);
  }
  const planJson = validPlanJson(body?.plan);
  if (planJson === null) return jsonError(c, "invalid_input", 400, "plan must be an object.");
  if (planJson === "__too_large__") return jsonError(c, "too_large", 413, "Plan is too large.");

  const editKey = String(body?.edit_key ?? "");
  if (!editKey) return jsonError(c, "forbidden", 403, "This is a read-only link.");
  const editKeyHash = await hashToken(editKey);

  const rawBaseRev = body?.base_rev;
  const expectedRev = rawBaseRev === undefined || rawBaseRev === null ? 0 : Math.trunc(Number(rawBaseRev));
  if (!Number.isInteger(expectedRev) || expectedRev < 0) {
    return jsonError(c, "invalid_input", 400, "base_rev must be a non-negative integer.");
  }

  const r = await updatePlanCAS(c.env.DB, id, editKeyHash, planJson, schemaVersionOf(body), expectedRev);
  if (r.ok) return c.json({ updated_at: r.updated_at, rev: r.rev });
  if (r.reason === "not_found") return jsonError(c, "not_found", 404);
  if (r.reason === "forbidden") return jsonError(c, "forbidden", 403, "This is a read-only link.");
  // conflict
  let plan: unknown = null;
  try {
    plan = JSON.parse(r.current.plan_json);
  } catch {
    plan = null;
  }
  return c.json(
    { error: "conflict", current: { plan, schema_version: r.current.schema_version, updated_at: r.current.updated_at, rev: r.current.rev } },
    409,
  );
});

export default api;
