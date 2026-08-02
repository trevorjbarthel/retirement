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
  // ALWAYS compare-and-set, even when the caller sent no base_rev. The unconditional branch
  // used to write with a bare `WHERE id = ?` and then return `current.rev + 1` computed from
  // the row read at the top of this function — a value that is already stale if anything
  // wrote in between. The client would adopt that wrong rev and its next save would 409
  // against a revision that never existed. Falling back to the row we just read keeps the
  // "unconditional" contract (a caller with no base_rev still wins) without ever inventing
  // a revision number.
  const casRev = expectedRev >= 1 ? expectedRev : current.rev;
  const res = await db
    .prepare(
      `UPDATE plans SET plan_json = ?, schema_version = ?, updated_at = ?, rev = rev + 1
       WHERE id = ? AND rev = ?`,
    )
    .bind(planJson, schemaVersion, now, id, casRev)
    .run();
  if (res.meta.changes === 1) return { ok: true, updated_at: now, rev: casRev + 1 };
  const fresh = await getPlan(db, id);
  if (!fresh) return { ok: false, reason: "not_found" };
  // A caller that sent no base_rev asked for "just write it" — retry once against the row
  // as it now stands rather than surfacing a conflict it has no way to reason about.
  if (expectedRev < 1) {
    const retry = await db
      .prepare(
        `UPDATE plans SET plan_json = ?, schema_version = ?, updated_at = ?, rev = rev + 1
         WHERE id = ? AND rev = ?`,
      )
      .bind(planJson, schemaVersion, now, id, fresh.rev)
      .run();
    if (retry.meta.changes === 1) return { ok: true, updated_at: now, rev: fresh.rev + 1 };
  }
  return { ok: false, reason: "conflict", current: fresh };
}

/** Result of a key-gated delete. */
export type PlanDeleteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "forbidden" };

/**
 * Delete a plan, but only for a caller who proves the edit key. The key check happens in the
 * WHERE clause so a wrong key can never remove a row, and the two failure modes are
 * distinguished by a follow-up read rather than by trusting the caller.
 */
export async function deletePlanByKey(db: D1Database, id: string, editKeyHash: string): Promise<PlanDeleteResult> {
  const res = await db
    .prepare("DELETE FROM plans WHERE id = ? AND edit_key_hash = ?")
    .bind(id, editKeyHash)
    .run();
  if (res.meta.changes === 1) return { ok: true };
  const still = await getPlan(db, id);
  return still ? { ok: false, reason: "forbidden" } : { ok: false, reason: "not_found" };
}
