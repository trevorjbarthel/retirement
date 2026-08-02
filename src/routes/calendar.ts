import { Hono } from "hono";
import type { AppContext } from "../env";
import { jsonError } from "../lib/json";
import { getPlan } from "../db/queries";
// calc.js is already the single source of truth for the deadline engine and is imported by
// the write path too — the feed therefore cannot drift from what the page shows.
import { computeMilestones, buildICS, isValidState } from "../../public/js/calc.js";

const cal = new Hono<AppContext>();

// GET /p/:id/calendar.ics — a SUBSCRIBABLE feed of a plan's milestones.
//
// The one-shot .ics download the page already offers goes stale the moment the plan is
// edited, and separation dates slip constantly. A subscription re-fetches, so a member who
// moves their date once sees every downstream deadline move in their own calendar.
//
// Read-only and keyed on the public id, exactly like /p/<id>: no edit key, no writes.
cal.get("/:id/calendar.ics", async (c) => {
  const id = c.req.param("id");
  const row = await getPlan(c.env.DB, id);
  if (!row) return jsonError(c, "not_found", 404);

  let plan: any;
  try {
    plan = JSON.parse(row.plan_json);
  } catch {
    return jsonError(c, "server_error", 500, "This plan's data could not be read.");
  }
  if (!isValidState(plan)) return jsonError(c, "server_error", 500, "This plan's data could not be read.");

  // The Worker runs in UTC, so "today" and the separation date must both be built from
  // explicit local-midnight parts — the same convention calc.js uses in the browser.
  // Without this the milestone dates shift by a day for anyone west of UTC.
  const sep = parseLocalDate(plan.sepDate);
  if (!sep) return jsonError(c, "server_error", 500, "This plan's separation date could not be read.");
  const today = parseLocalDate(plan.todayDate) ?? startOfUtcDay(new Date());

  const { milestones } = computeMilestones(plan, today, sep);
  const ics = buildICS(milestones, {
    calName: `${plan.firstName}'s Transition Plan`,
    prodId: "-//Military Transition Calculator//Feed//EN",
    // Deterministic DTSTAMP derived from the row's own version, so an unchanged plan
    // produces a byte-identical feed and polling clients don't see spurious updates.
    now: new Date(row.updated_at * 1000),
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="transition-plan.ics"`,
      // Subscribers poll on their own schedule; a short cache keeps a popular plan from
      // hammering D1 without letting an edit sit stale for long.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
});

function parseLocalDate(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

function startOfUtcDay(d: Date): Date {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export default cal;
