// Typed D1 query helpers. One row per plan, addressed by its public `id`.

export interface PlanRow {
  id: string;
  edit_key_hash: string;
  schema_version: number;
  plan_json: string;
  rev: number;
  created_at: number;
  updated_at: number;
}

/** Result of a compare-and-set plan update. */
export type PlanWriteResult =
  | { ok: true; updated_at: number; rev: number }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "forbidden" }
  | { ok: false; reason: "conflict"; current: PlanRow };

const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function getPlan(db: D1Database, id: string): Promise<PlanRow | null> {
  return db.prepare("SELECT * FROM plans WHERE id = ?").bind(id).first<PlanRow>();
}

/** Insert a new plan. Caller supplies a fresh id + edit-key hash; retried on id collision. */
export async function createPlan(
  db: D1Database,
  args: { id: string; editKeyHash: string; planJson: string; schemaVersion: number },
): Promise<{ updated_at: number; rev: number }> {
  const now = nowSeconds();
  await db
    .prepare(
      `INSERT INTO plans (id, edit_key_hash, schema_version, plan_json, rev, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(args.id, args.editKeyHash, args.schemaVersion, args.planJson, now, now)
    .run();
  return { updated_at: now, rev: 1 };
}

/**
 * Update a plan if the caller proves the edit key and (optionally) holds the current rev.
 * `editKeyHash` is the SHA-256 the caller's key hashes to; we compare it to the stored hash.
 * expectedRev >= 1 enforces optimistic concurrency; <= 0 means "unconditional".
 */
export async function updatePlanCAS(
  db: D1Database,
  id: string,
  editKeyHash: string,
  planJson: string,
  schemaVersion: number,
  expectedRev: number,
): Promise<PlanWriteResult> {
  const current = await getPlan(db, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.edit_key_hash !== editKeyHash) return { ok: false, reason: "forbidden" };

  const now = nowSeconds();
  if (expectedRev >= 1) {
    const res = await db
      .prepare(
        `UPDATE plans SET plan_json = ?, schema_version = ?, updated_at = ?, rev = rev + 1
         WHERE id = ? AND rev = ?`,
      )
      .bind(planJson, schemaVersion, now, id, expectedRev)
      .run();
    if (res.meta.changes === 1) return { ok: true, updated_at: now, rev: expectedRev + 1 };
    const fresh = await getPlan(db, id);
    return fresh ? { ok: false, reason: "conflict", current: fresh } : { ok: false, reason: "not_found" };
  }
  await db
    .prepare("UPDATE plans SET plan_json = ?, schema_version = ?, updated_at = ?, rev = rev + 1 WHERE id = ?")
    .bind(planJson, schemaVersion, now, id)
    .run();
  return { ok: true, updated_at: now, rev: current.rev + 1 };
}
