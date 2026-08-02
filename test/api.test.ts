import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { api, createPlan, validPlan } from "./helpers";

describe("create plan", () => {
  it("POST /api/p returns 201 with an id, an edit key, and rev 1", async () => {
    const res = await api("/api/p", { method: "POST", body: { plan: validPlan(), schema_version: 5 } });
    expect(res.status).toBe(201);
    const body = await res.json<{ id: string; edit_key: string; rev: number; schema_version: number }>();
    expect(body.id).toBeTruthy();
    expect(body.edit_key).toBeTruthy();
    expect(body.id).not.toBe(body.edit_key);
    expect(body.rev).toBe(1);
    expect(body.schema_version).toBe(5);
  });

  it("gives every plan a distinct id and edit key", async () => {
    const a = await createPlan();
    const b = await createPlan();
    expect(a.id).not.toBe(b.id);
    expect(a.edit_key).not.toBe(b.edit_key);
  });

  it("rejects a non-object plan (400) and an oversized plan (413)", async () => {
    expect((await api("/api/p", { method: "POST", body: { plan: [1, 2, 3] } })).status).toBe(400);
    const huge = { blob: "x".repeat(70 * 1024) };
    expect((await api("/api/p", { method: "POST", body: { plan: huge } })).status).toBe(413);
  });

  it("counts the size limit in UTF-8 bytes, not UTF-16 code units", async () => {
    const multibyte = { blob: "界".repeat(24 * 1024) }; // ~72 KiB UTF-8, ~24k code units
    expect((await api("/api/p", { method: "POST", body: { plan: multibyte } })).status).toBe(413);
  });

  // Server-side enforcement of the same allow-list the browser uses (calc.js
  // isValidState) is what makes a hostile plan unable to reach the database at all —
  // without this, transType/branch could be set to arbitrary strings that later reach
  // an unescaped innerHTML sink client-side when someone opens the shared link.
  it("rejects a plan missing required fields, and one with an out-of-enum transType", async () => {
    expect((await api("/api/p", { method: "POST", body: { plan: { firstName: "Pat" } } })).status).toBe(400);
    const hostile = validPlan({ transType: "<img src=x onerror=alert(1)>" });
    expect((await api("/api/p", { method: "POST", body: { plan: hostile } })).status).toBe(400);
  });

  it("rejects the same hostile shape on PUT, not just POST", async () => {
    const { id, edit_key } = await createPlan();
    const hostile = validPlan({ branch: "<script>alert(1)</script>" });
    const res = await api(`/api/p/${id}`, { method: "PUT", body: { plan: hostile, edit_key, base_rev: 1 } });
    expect(res.status).toBe(400);
  });
});

describe("read plan", () => {
  it("GET /api/p/:id returns the stored plan (no key needed — read-only)", async () => {
    const plan = validPlan({ firstName: "Hank", checks: { "p1-0": true } });
    const { id } = await createPlan(plan);
    const res = await api(`/api/p/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json<{ plan: any; rev: number }>();
    expect(body.plan).toEqual(plan);
    expect(body.rev).toBe(1);
  });

  it("returns 404 for an unknown id", async () => {
    expect((await api("/api/p/does-not-exist")).status).toBe(404);
  });

  it("does NOT leak the edit key on read", async () => {
    const { id } = await createPlan();
    const body = await (await api(`/api/p/${id}`)).json<Record<string, unknown>>();
    expect(body).not.toHaveProperty("edit_key");
    expect(body).not.toHaveProperty("edit_key_hash");
  });
});

describe("update plan", () => {
  it("PUT with the correct edit key updates and bumps rev", async () => {
    const { id, edit_key } = await createPlan(validPlan({ postLocation: "v1" }));
    const put = await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "v2" }), schema_version: 5, edit_key, base_rev: 1 } });
    expect(put.status).toBe(200);
    expect((await put.json<{ rev: number }>()).rev).toBe(2);
    expect((await (await api(`/api/p/${id}`)).json<{ plan: any }>()).plan).toEqual(validPlan({ postLocation: "v2" }));
  });

  it("rejects a PUT with a wrong/missing edit key (403) and never mutates the plan", async () => {
    const { id, edit_key } = await createPlan(validPlan({ postLocation: "v1" }));
    expect((await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "v9" }), edit_key: "wrong-key", base_rev: 1 } })).status).toBe(403);
    expect((await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "v9" }), base_rev: 1 } })).status).toBe(403);
    // unchanged
    expect((await (await api(`/api/p/${id}`)).json<{ plan: any }>()).plan).toEqual(validPlan({ postLocation: "v1" }));
    // sanity: the real key still works
    expect((await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "v2" }), edit_key, base_rev: 1 } })).status).toBe(200);
  });

  it("returns 404 when updating an unknown id", async () => {
    expect((await api("/api/p/nope", { method: "PUT", body: { plan: validPlan(), edit_key: "k", base_rev: 0 } })).status).toBe(404);
  });

  it("a stale base_rev (second tab) is rejected with 409 + the server's current plan", async () => {
    const { id, edit_key } = await createPlan(validPlan({ postLocation: "v1" })); // rev 1
    await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "A" }), edit_key, base_rev: 1 } }); // rev 2
    const tabB = await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "B" }), edit_key, base_rev: 1 } });
    expect(tabB.status).toBe(409);
    const body = await tabB.json<{ current: { plan: any; rev: number } }>();
    expect(body.current.plan).toEqual(validPlan({ postLocation: "A" }));
    expect(body.current.rev).toBe(2);
    // reconcile at the server rev → succeeds → rev 3
    const retry = await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "B" }), edit_key, base_rev: 2 } });
    expect(retry.status).toBe(200);
    expect((await retry.json<{ rev: number }>()).rev).toBe(3);
  });

  it("rejects a negative base_rev with 400 (before checking the key)", async () => {
    const { id, edit_key } = await createPlan();
    expect((await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan(), edit_key, base_rev: -1 } })).status).toBe(400);
  });
});

describe("stored shape is a sanitized projection", () => {
  it("drops unknown keys instead of persisting them", async () => {
    // isValidState alone never rejected extra keys, so /api/p would store whatever else was
    // attached — an unauthenticated 64 KiB blob host with no expiry.
    const { id } = await createPlan(validPlan({ trackingBlob: "x".repeat(2000), __proto__: { polluted: true } } as any));
    const body = await (await api(`/api/p/${id}`)).json<{ plan: any }>();
    expect(body.plan).not.toHaveProperty("trackingBlob");
    expect(body.plan).not.toHaveProperty("polluted");
    expect(body.plan.firstName).toBe("Pat");
  });

  it("keeps the checklist and decision-tool maps, bounded", async () => {
    const plan = validPlan({ checks: { "finance-plan": true }, tools: { dtSbpBase: "4500" } });
    const { id } = await createPlan(plan);
    const body = await (await api(`/api/p/${id}`)).json<{ plan: any }>();
    expect(body.plan.checks).toEqual({ "finance-plan": true });
    expect(body.plan.tools).toEqual({ dtSbpBase: "4500" });
  });

  it("rejects a malformed checks map and an out-of-enum payRetSystem", async () => {
    expect((await api("/api/p", { method: "POST", body: { plan: validPlan({ checks: { "<script>": true } }) } })).status).toBe(400);
    expect((await api("/api/p", { method: "POST", body: { plan: validPlan({ payRetSystem: "nonsense" }) } })).status).toBe(400);
    expect((await api("/api/p", { method: "POST", body: { plan: validPlan({ payRetSystem: "redux" }) } })).status).toBe(201);
  });

  it("rejects a malformed body that isn't JSON at all", async () => {
    const res = await SELF.fetch("https://example.com/api/p", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("delete plan", () => {
  it("DELETE with the correct edit key removes the plan", async () => {
    const { id, edit_key } = await createPlan();
    const del = await api(`/api/p/${id}`, { method: "DELETE", body: { edit_key } });
    expect(del.status).toBe(200);
    expect((await del.json<{ deleted: boolean }>()).deleted).toBe(true);
    expect((await api(`/api/p/${id}`)).status).toBe(404);
  });

  it("refuses a wrong or missing edit key and leaves the plan intact", async () => {
    const { id, edit_key } = await createPlan(validPlan({ postLocation: "keep-me" }));
    expect((await api(`/api/p/${id}`, { method: "DELETE", body: { edit_key: "wrong" } })).status).toBe(403);
    expect((await api(`/api/p/${id}`, { method: "DELETE", body: {} })).status).toBe(403);
    const still = await (await api(`/api/p/${id}`)).json<{ plan: any }>();
    expect(still.plan.postLocation).toBe("keep-me");
    // the real key still works
    expect((await api(`/api/p/${id}`, { method: "DELETE", body: { edit_key } })).status).toBe(200);
  });

  it("returns 404 for an unknown id", async () => {
    expect((await api("/api/p/does-not-exist", { method: "DELETE", body: { edit_key: "k" } })).status).toBe(404);
  });

  it("accepts the key as a Bearer token too", async () => {
    const { id, edit_key } = await createPlan();
    const res = await SELF.fetch(`https://example.com/api/p/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${edit_key}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("unconditional writes still compare-and-set", () => {
  it("a PUT with no base_rev returns the REAL next rev, not a stale guess", async () => {
    const { id, edit_key } = await createPlan(validPlan({ postLocation: "v1" })); // rev 1
    await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "v2" }), edit_key, base_rev: 1 } }); // rev 2
    // No base_rev — "just write it". The old code returned current.rev + 1 computed from a
    // row read before the write, so a client adopting it 409'd on its very next save.
    const put = await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "v3" }), edit_key } });
    expect(put.status).toBe(200);
    const rev = (await put.json<{ rev: number }>()).rev;
    expect(rev).toBe(3);
    // The returned rev must actually be usable for the next conditional write.
    const next = await api(`/api/p/${id}`, { method: "PUT", body: { plan: validPlan({ postLocation: "v4" }), edit_key, base_rev: rev } });
    expect(next.status).toBe(200);
    expect((await next.json<{ rev: number }>()).rev).toBe(4);
  });
});

describe("API responses are never cacheable", () => {
  it("sets no-store on reads (public/_headers does not apply to Worker responses)", async () => {
    const { id } = await createPlan();
    const res = await api(`/api/p/${id}`);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("subscribable calendar feed", () => {
  it("serves a valid VCALENDAR for a plan id, with no edit key", async () => {
    const { id } = await createPlan(validPlan({ vaClaim: true, sb: true, sbDays: 90 }));
    const res = await api(`/p/${id}/calendar.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
    // The corrected milestone set, straight from calc.js — proving the feed shares the
    // deadline engine rather than reimplementing it.
    expect(body).toContain("BDD Filing Window Opens");
  });

  it("every line is within the RFC 5545 75-octet limit", async () => {
    const { id } = await createPlan(validPlan({ vaClaim: true }));
    const body = await (await api(`/p/${id}/calendar.ics`)).text();
    for (const line of body.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("is byte-identical across polls while the plan is unchanged", async () => {
    const { id } = await createPlan();
    const a = await (await api(`/p/${id}/calendar.ics`)).text();
    const b = await (await api(`/p/${id}/calendar.ics`)).text();
    expect(a).toBe(b);
  });

  it("404s for an unknown plan", async () => {
    expect((await api("/p/nope/calendar.ics")).status).toBe(404);
  });
});

describe("routing", () => {
  it("unknown /api/* route is a JSON 404", async () => {
    const res = await api("/api/nope");
    expect(res.status).toBe(404);
    expect((await res.json<{ error: string }>()).error).toBe("not_found");
  });
});
