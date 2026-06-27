import { describe, it, expect } from "vitest";
import { api, createPlan } from "./helpers";

describe("create plan", () => {
  it("POST /api/p returns 201 with an id, an edit key, and rev 1", async () => {
    const res = await api("/api/p", { method: "POST", body: { plan: { firstName: "Pat" }, schema_version: 5 } });
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
});

describe("read plan", () => {
  it("GET /api/p/:id returns the stored plan (no key needed — read-only)", async () => {
    const plan = { firstName: "Hank", branch: "Army", checks: { "p1-0": true } };
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
    const { id, edit_key } = await createPlan({ v: 1 });
    const put = await api(`/api/p/${id}`, { method: "PUT", body: { plan: { v: 2 }, schema_version: 5, edit_key, base_rev: 1 } });
    expect(put.status).toBe(200);
    expect((await put.json<{ rev: number }>()).rev).toBe(2);
    expect((await (await api(`/api/p/${id}`)).json<{ plan: any }>()).plan).toEqual({ v: 2 });
  });

  it("rejects a PUT with a wrong/missing edit key (403) and never mutates the plan", async () => {
    const { id, edit_key } = await createPlan({ v: 1 });
    expect((await api(`/api/p/${id}`, { method: "PUT", body: { plan: { v: 9 }, edit_key: "wrong-key", base_rev: 1 } })).status).toBe(403);
    expect((await api(`/api/p/${id}`, { method: "PUT", body: { plan: { v: 9 }, base_rev: 1 } })).status).toBe(403);
    // unchanged
    expect((await (await api(`/api/p/${id}`)).json<{ plan: any }>()).plan).toEqual({ v: 1 });
    // sanity: the real key still works
    expect((await api(`/api/p/${id}`, { method: "PUT", body: { plan: { v: 2 }, edit_key, base_rev: 1 } })).status).toBe(200);
  });

  it("returns 404 when updating an unknown id", async () => {
    expect((await api("/api/p/nope", { method: "PUT", body: { plan: { v: 1 }, edit_key: "k", base_rev: 0 } })).status).toBe(404);
  });

  it("a stale base_rev (second tab) is rejected with 409 + the server's current plan", async () => {
    const { id, edit_key } = await createPlan({ v: 1 }); // rev 1
    await api(`/api/p/${id}`, { method: "PUT", body: { plan: { v: "A" }, edit_key, base_rev: 1 } }); // rev 2
    const tabB = await api(`/api/p/${id}`, { method: "PUT", body: { plan: { v: "B" }, edit_key, base_rev: 1 } });
    expect(tabB.status).toBe(409);
    const body = await tabB.json<{ current: { plan: any; rev: number } }>();
    expect(body.current.plan).toEqual({ v: "A" });
    expect(body.current.rev).toBe(2);
    // reconcile at the server rev → succeeds → rev 3
    const retry = await api(`/api/p/${id}`, { method: "PUT", body: { plan: { v: "B" }, edit_key, base_rev: 2 } });
    expect(retry.status).toBe(200);
    expect((await retry.json<{ rev: number }>()).rev).toBe(3);
  });

  it("rejects a negative base_rev with 400 (before checking the key)", async () => {
    const { id, edit_key } = await createPlan();
    expect((await api(`/api/p/${id}`, { method: "PUT", body: { plan: { v: 1 }, edit_key, base_rev: -1 } })).status).toBe(400);
  });
});

describe("routing", () => {
  it("unknown /api/* route is a JSON 404", async () => {
    const res = await api("/api/nope");
    expect(res.status).toBe(404);
    expect((await res.json<{ error: string }>()).error).toBe("not_found");
  });
});
