import { describe, it, expect } from "vitest";
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

describe("routing", () => {
  it("unknown /api/* route is a JSON 404", async () => {
    const res = await api("/api/nope");
    expect(res.status).toBe(404);
    expect((await res.json<{ error: string }>()).error).toBe("not_found");
  });
});
