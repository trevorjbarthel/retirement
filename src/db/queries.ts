// Typed D1 query helpers. One row per user in `plans` (UNIQUE(user_id)); the
// schema keeps room for many plans later.

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  password_salt: string;
  iterations: number;
  token_version: number;
  created_at: number;
  updated_at: number;
}

export interface PlanRow {
  id: number;
  user_id: number;
  schema_version: number;
  plan_json: string;
  updated_at: number;
  rev: number;
}

/** Result of a compare-and-set plan write. */
export type PlanWriteResult =
  | { ok: true; updated_at: number; rev: number }
  | { ok: false; current: PlanRow | null };

const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function createUser(
  db: D1Database,
  args: { email: string; hash: string; salt: string; iterations: number },
): Promise<UserRow> {
  const now = nowSeconds();
  const row = await db
    .prepare(
      `INSERT INTO users (email, password_hash, password_salt, iterations, token_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?) RETURNING *`,
    )
    .bind(args.email, args.hash, args.salt, args.iterations, now, now)
    .first<UserRow>();
  if (!row) throw new Error("createUser: insert returned no row");
  return row;
}

/** Transparent hash upgrade on login — does NOT change token_version (stays logged in). */
export async function updateUserHash(
  db: D1Database,
  id: number,
  hash: string,
  salt: string,
  iterations: number,
): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ?, password_salt = ?, iterations = ?, updated_at = ? WHERE id = ?")
    .bind(hash, salt, iterations, nowSeconds(), id)
    .run();
}

/** Password change — bumps token_version to invalidate all existing sessions. */
export async function updateUserPasswordAndRevoke(
  db: D1Database,
  id: number,
  hash: string,
  salt: string,
  iterations: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
       SET password_hash = ?, password_salt = ?, iterations = ?, token_version = token_version + 1, updated_at = ?
       WHERE id = ?`,
    )
    .bind(hash, salt, iterations, nowSeconds(), id)
    .run();
}

export async function deleteUser(db: D1Database, id: number): Promise<void> {
  // Explicit plan delete in addition to ON DELETE CASCADE, for safety across runtimes.
  await db.batch([
    db.prepare("DELETE FROM plans WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM users WHERE id = ?").bind(id),
  ]);
}

export async function getPlan(db: D1Database, userId: number): Promise<PlanRow | null> {
  return db.prepare("SELECT * FROM plans WHERE user_id = ?").bind(userId).first<PlanRow>();
}

/** Unconditional upsert (legacy / no optimistic-concurrency token). Advances rev. */
export async function upsertPlan(
  db: D1Database,
  userId: number,
  planJson: string,
  schemaVersion: number,
): Promise<{ updated_at: number; rev: number }> {
  const now = nowSeconds();
  const row = await db
    .prepare(
      `INSERT INTO plans (user_id, schema_version, plan_json, updated_at, rev)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET
         plan_json = excluded.plan_json,
         schema_version = excluded.schema_version,
         updated_at = excluded.updated_at,
         rev = plans.rev + 1
       RETURNING updated_at, rev`,
    )
    .bind(userId, schemaVersion, planJson, now)
    .first<{ updated_at: number; rev: number }>();
  if (!row) throw new Error("upsertPlan: upsert returned no row");
  return row;
}

/**
 * Compare-and-set write. expectedRev <= 0 means "create only" (succeeds only when no
 * plan exists yet); expectedRev >= 1 means "update only if the stored rev matches".
 * On a stale token the write is rejected and the server's current row is returned so the
 * caller can reconcile. Each conditional statement is atomic, so no transaction is needed.
 */
export async function upsertPlanCAS(
  db: D1Database,
  userId: number,
  planJson: string,
  schemaVersion: number,
  expectedRev: number,
): Promise<PlanWriteResult> {
  const now = nowSeconds();
  if (expectedRev <= 0) {
    const res = await db
      .prepare(
        `INSERT INTO plans (user_id, schema_version, plan_json, updated_at, rev)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(user_id) DO NOTHING`,
      )
      .bind(userId, schemaVersion, planJson, now)
      .run();
    if (res.meta.changes === 1) return { ok: true, updated_at: now, rev: 1 };
    return { ok: false, current: await getPlan(db, userId) };
  }
  const res = await db
    .prepare(
      `UPDATE plans SET plan_json = ?, schema_version = ?, updated_at = ?, rev = rev + 1
       WHERE user_id = ? AND rev = ?`,
    )
    .bind(planJson, schemaVersion, now, userId, expectedRev)
    .run();
  if (res.meta.changes === 1) return { ok: true, updated_at: now, rev: expectedRev + 1 };
  return { ok: false, current: await getPlan(db, userId) };
}
