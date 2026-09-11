// Retention policy for stored plans.
//
// A plan holds a name, rank, separation date, location, TSP balance and VA rating, and until
// now nothing ever removed one: rows accumulated forever unless the owner found the Delete
// button. There is also no email to warn an owner before deletion, so the window is long and
// the definition of "in use" is generous — any EDIT or any READ (opening the link, a
// calendar client polling the feed) counts, not just edits.
//
// The sweep runs from the Worker's cron trigger (wrangler.jsonc `triggers.crons`); the SQL
// lives in src/db/queries.ts. Deletion is irreversible: the D1 Time Travel bookmark recorded
// by the deploy workflow is the only way back, and only for 30 days.
import { purgeStalePlans } from "../db/queries";

export const RETENTION_DAYS = 730; // two years since the plan was last edited OR opened

export function retentionCutoff(nowSeconds = Math.floor(Date.now() / 1000)): number {
  return nowSeconds - RETENTION_DAYS * 86400;
}

export async function runRetentionSweep(db: D1Database, nowSeconds?: number): Promise<number> {
  const removed = await purgeStalePlans(db, retentionCutoff(nowSeconds));
  console.log(`[retention] removed ${removed} plan(s) untouched for ${RETENTION_DAYS} days`);
  return removed;
}
