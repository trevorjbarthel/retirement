import { Hono } from "hono";
import type { AppContext } from "../env";
import { jsonError } from "../lib/json";
import { createPlan, getPlan, updatePlanCAS } from "../db/queries";
import { randomToken, hashToken } from "../lib/tokens";
// Reuse the browser's own allow-list validator so the server enforces the exact same
// shape the client does — this is what makes a hostile plan (e.g. transType/branch set
// to a script payload) structurally unable to reach the database at all, rather than
// relying solely on the client to behave.
import { isValidState } from "../../public/js/calc.js";

const api = new Hono<AppContext>();

const MAX_PLAN_BYTES = 64 * 1024;
const MAX_BODY_BYTES = MAX_PLAN_BYTES * 2; // plan + schema_version + edit_key + base_rev envelope
const enc = new TextEncoder();

// Reads and JSON-parses a request body while enforcing maxBytes against the actual
// bytes read from the stream — unlike a Content-Length header check, this can't be
// bypassed by chunked transfer-encoding (no Content-Length header at all), which
// previously let an attacker skip the size check entirely and force a full parse of
// an arbitrarily large body.
async function readJsonCapped(request: Request, maxBytes: number): Promise<{ ok: true; body: any } | { ok: false; tooLarge?: boolean }> {
  const reader = request.body?.getReader();
  if (!reader) {
    try {
      return { ok: true, body: await request.json() };
    } catch {
      return { ok: false };
    }
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { ok: false };
  }
}

// Returns the JSON string, null if not a plain object / fails the shared shape
// validator, or "__too_large__" if over budget. Size is checked before shape so an
// oversized payload is always rejected as "too large" regardless of its content,
// rather than spending cycles deep-validating something we're rejecting anyway.
function validPlanJson(plan: unknown): string | null {
  if (typeof plan !== "object" || plan === null || Array.isArray(plan)) return null;
  const planJson = JSON.stringify(plan);
  if (enc.encode(planJson).byteLength > MAX_PLAN_BYTES) return "__too_large__";
  if (!isValidState(plan)) return null;
  return planJson;
}

function schemaVersionOf(body: any): number {
  const raw = Math.trunc(Number(body?.schema_version));
  return Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : 1;
}

// Best-effort per-IP throttle. No-op when the given limiter isn't bound (local dev /
// tests / unprovisioned deploy); never blocks on a limiter failure.
async function throttled(c: any, limiter: any, keyPrefix: string): Promise<boolean> {
  if (c.env.APP_ENV === "development") return false; // skip in local dev / tests
  if (!limiter) return false;
  const ip = c.req.header("cf-connecting-ip") ?? "ip-unknown";
  try {
    const { success } = await limiter.limit({ key: `${keyPrefix}:${ip}` });
    return !success;
  } catch {
    return false;
  }
}

// Create a new plan → returns its public id and the secret edit key (shown once).
api.post("/p", async (c) => {
  if (await throttled(c, c.env.CREATE_LIMITER, "create")) {
    return jsonError(c, "rate_limited", 429, "Too many new plans from your network. Please wait a moment.");
  }
  const read = await readJsonCapped(c.req.raw, MAX_BODY_BYTES);
  if (!read.ok) return read.tooLarge ? jsonError(c, "too_large", 413, "Plan is too large.") : jsonError(c, "invalid_input", 400);
  const body = read.body;
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
  let plan: unknown;
  try {
    plan = JSON.parse(row.plan_json);
  } catch {
    // A row that fails to parse is a server-side data problem, not "plan is null" —
    // returning 200 here previously let the client cache the null over a good local copy.
    return jsonError(c, "server_error", 500, "This plan's data could not be read.");
  }
  return c.json({ plan, schema_version: row.schema_version, updated_at: row.updated_at, rev: row.rev });
});

// Update a plan. Requires the edit key; uses optimistic concurrency on rev.
api.put("/p/:id", async (c) => {
  if (await throttled(c, c.env.UPDATE_LIMITER, "update")) {
    return jsonError(c, "rate_limited", 429, "Too many edits from your network. Please wait a moment.");
  }
  const id = c.req.param("id");
  const read = await readJsonCapped(c.req.raw, MAX_BODY_BYTES);
  if (!read.ok) return read.tooLarge ? jsonError(c, "too_large", 413, "Plan is too large.") : jsonError(c, "invalid_input", 400);
  const body = read.body;
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
