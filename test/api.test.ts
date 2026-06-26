import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { hashToken } from "../src/auth/tokens";
import { api, register, login, firstCookie } from "./helpers";

async function userIdByEmail(email: string): Promise<number> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>();
  return row!.id;
}
async function liveResetCount(userId: number): Promise<number> {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND used_at IS NULL")
    .bind(userId)
    .first<{ n: number }>();
  return row!.n;
}
async function seedReset(userId: number, raw: string, opts: { expiresAt?: number; used?: boolean } = {}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare("INSERT INTO password_resets (user_id, token_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, await hashToken(raw), opts.expiresAt ?? now + 3600, opts.used ? now : null, now)
    .run();
}

describe("auth: register", () => {
  it("creates a user and sets an HttpOnly session cookie", async () => {
    const { res } = await register("alice@example.com");
    expect(res.status).toBe(201);
    const body = await res.json<{ user: { id: number; email: string } }>();
    expect(body.user.email).toBe("alice@example.com");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("rejects a duplicate email with 409", async () => {
    await register("dupe@example.com");
    const { res } = await register("dupe@example.com");
    expect(res.status).toBe(409);
    expect((await res.json<{ error: string }>()).error).toBe("email_taken");
  });

  it("rejects a weak/short password with 400", async () => {
    const res = await api("/api/auth/register", { body: { email: "weak@example.com", password: "short" } });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_input");
  });

  it("rejects an invalid email with 400", async () => {
    const res = await api("/api/auth/register", { body: { email: "notanemail", password: "correct-horse-battery" } });
    expect(res.status).toBe(400);
  });
});

describe("auth: login", () => {
  it("succeeds with correct credentials and sets a cookie", async () => {
    await register("bob@example.com", "correct-horse-battery");
    const { res, cookie } = await login("bob@example.com", "correct-horse-battery");
    expect(res.status).toBe(200);
    expect(cookie).toMatch(/session=/);
  });

  it("returns 401 invalid_credentials for a wrong password (no enumeration)", async () => {
    await register("carol@example.com", "correct-horse-battery");
    const { res } = await login("carol@example.com", "wrong-password-here");
    expect(res.status).toBe(401);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_credentials");
  });

  it("returns the same 401 for an unknown email", async () => {
    const { res } = await login("nobody@example.com", "correct-horse-battery");
    expect(res.status).toBe(401);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_credentials");
  });
});

describe("session", () => {
  it("/api/me returns the user with a valid cookie and null without", async () => {
    const { cookie } = await register("dave@example.com");
    const meAuthed = await api("/api/me", { cookie });
    expect((await meAuthed.json<{ user: any }>()).user.email).toBe("dave@example.com");

    const meGuest = await api("/api/me");
    expect((await meGuest.json<{ user: any }>()).user).toBeNull();
  });

  it("rejects a tampered cookie signature", async () => {
    const { cookie } = await register("erin@example.com");
    const tampered = (cookie ?? "").slice(0, -3) + "xyz";
    const me = await api("/api/me", { cookie: tampered });
    expect((await me.json<{ user: any }>()).user).toBeNull();
  });

  it("rejects a structurally malformed cookie (no signature delimiter)", async () => {
    const me = await api("/api/me", { cookie: "session=not-a-valid-token" });
    expect((await me.json<{ user: any }>()).user).toBeNull();
  });

  it("rejects a password change to the same password (400)", async () => {
    const { cookie } = await register("noah@example.com", "correct-horse-battery");
    const res = await api("/api/auth/change-password", {
      body: { current: "correct-horse-battery", next: "correct-horse-battery" },
      cookie,
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_input");
  });

  it("invalidates existing cookies when token_version is bumped (password change)", async () => {
    const { cookie } = await register("frank@example.com", "correct-horse-battery");
    const change = await api("/api/auth/change-password", {
      body: { current: "correct-horse-battery", next: "a-brand-new-password" },
      cookie,
    });
    expect(change.status).toBe(204);
    // The OLD cookie (token_version 1) must no longer authenticate.
    const me = await api("/api/me", { cookie });
    expect((await me.json<{ user: any }>()).user).toBeNull();
  });
});

describe("plan", () => {
  it("GET returns null before any save", async () => {
    const { cookie } = await register("gina@example.com");
    const res = await api("/api/plan", { cookie });
    expect(res.status).toBe(200);
    expect((await res.json<{ plan: any }>()).plan).toBeNull();
  });

  it("PUT upserts then GET returns the same payload (round-trip)", async () => {
    const { cookie } = await register("hank@example.com");
    const plan = { firstName: "Hank", branch: "Army", checks: { "p1-0": true } };
    const put = await api("/api/plan", { method: "PUT", body: { plan, schema_version: 5 }, cookie });
    expect(put.status).toBe(200);
    const get = await api("/api/plan", { cookie });
    const body = await get.json<{ plan: any; schema_version: number }>();
    expect(body.plan).toEqual(plan);
    expect(body.schema_version).toBe(5);
  });

  it("PUT a second time updates the single per-user row", async () => {
    const { cookie } = await register("ivy@example.com");
    await api("/api/plan", { method: "PUT", body: { plan: { v: 1 }, schema_version: 5 }, cookie });
    await api("/api/plan", { method: "PUT", body: { plan: { v: 2 }, schema_version: 5 }, cookie });
    const get = await api("/api/plan", { cookie });
    expect((await get.json<{ plan: any }>()).plan).toEqual({ v: 2 });
  });

  it("requires auth → 401 without a cookie", async () => {
    expect((await api("/api/plan")).status).toBe(401);
    expect((await api("/api/plan", { method: "PUT", body: { plan: {} } })).status).toBe(401);
  });

  it("rejects an oversized plan with 413", async () => {
    const { cookie } = await register("jane@example.com");
    const huge = { blob: "x".repeat(70 * 1024) };
    const res = await api("/api/plan", { method: "PUT", body: { plan: huge, schema_version: 5 }, cookie });
    expect(res.status).toBe(413);
  });

  it("measures the size limit in UTF-8 bytes, not UTF-16 code units", async () => {
    const { cookie } = await register("mia@example.com");
    // ~24k 3-byte chars ≈ 72 KiB UTF-8 but only ~24k code units — would pass a .length check.
    const multibyte = { blob: "界".repeat(24 * 1024) };
    const res = await api("/api/plan", { method: "PUT", body: { plan: multibyte, schema_version: 5 }, cookie });
    expect(res.status).toBe(413);
  });
});

describe("plan concurrency (optimistic rev)", () => {
  it("GET returns rev 0 with no plan, then the stored rev after a write", async () => {
    const { cookie } = await register("olive@example.com");
    expect((await (await api("/api/plan", { cookie })).json<{ rev: number }>()).rev).toBe(0);
    const put = await api("/api/plan", { method: "PUT", body: { plan: { a: 1 }, schema_version: 5, base_rev: 0 }, cookie });
    expect(put.status).toBe(200);
    expect((await put.json<{ rev: number }>()).rev).toBe(1);
    expect((await (await api("/api/plan", { cookie })).json<{ rev: number }>()).rev).toBe(1);
  });

  it("create-only (base_rev 0) conflicts when a plan already exists", async () => {
    const { cookie } = await register("peter@example.com");
    await api("/api/plan", { method: "PUT", body: { plan: { a: 1 }, schema_version: 5, base_rev: 0 }, cookie });
    const again = await api("/api/plan", { method: "PUT", body: { plan: { a: 2 }, schema_version: 5, base_rev: 0 }, cookie });
    expect(again.status).toBe(409);
    const body = await again.json<{ error: string; current: { plan: any; rev: number } }>();
    expect(body.error).toBe("conflict");
    expect(body.current.plan).toEqual({ a: 1 });
    expect(body.current.rev).toBe(1);
  });

  it("update with the correct base_rev succeeds and increments rev", async () => {
    const { cookie } = await register("quinn@example.com");
    await api("/api/plan", { method: "PUT", body: { plan: { v: 1 }, schema_version: 5, base_rev: 0 }, cookie });
    const up = await api("/api/plan", { method: "PUT", body: { plan: { v: 2 }, schema_version: 5, base_rev: 1 }, cookie });
    expect(up.status).toBe(200);
    expect((await up.json<{ rev: number }>()).rev).toBe(2);
    expect((await (await api("/api/plan", { cookie })).json<{ plan: any }>()).plan).toEqual({ v: 2 });
  });

  it("a stale base_rev (second tab) is rejected with 409 and the server's current plan", async () => {
    const { cookie } = await register("rosa@example.com");
    await api("/api/plan", { method: "PUT", body: { plan: { v: 1 }, schema_version: 5, base_rev: 0 }, cookie }); // rev 1
    await api("/api/plan", { method: "PUT", body: { plan: { v: "A" }, schema_version: 5, base_rev: 1 }, cookie }); // rev 2 (tab A)
    const tabB = await api("/api/plan", { method: "PUT", body: { plan: { v: "B" }, schema_version: 5, base_rev: 1 }, cookie });
    expect(tabB.status).toBe(409);
    const body = await tabB.json<{ current: { plan: any; rev: number } }>();
    expect(body.current.plan).toEqual({ v: "A" });
    expect(body.current.rev).toBe(2);
    // Reconcile: retry at the server's rev → succeeds → rev 3.
    const retry = await api("/api/plan", { method: "PUT", body: { plan: { v: "B" }, schema_version: 5, base_rev: 2 }, cookie });
    expect(retry.status).toBe(200);
    expect((await retry.json<{ rev: number }>()).rev).toBe(3);
  });

  it("rejects a negative base_rev with 400", async () => {
    const { cookie } = await register("sam@example.com");
    const res = await api("/api/plan", { method: "PUT", body: { plan: { a: 1 }, schema_version: 5, base_rev: -1 }, cookie });
    expect(res.status).toBe(400);
  });

  it("legacy PUT without base_rev upserts unconditionally and still advances rev", async () => {
    const { cookie } = await register("tina@example.com");
    expect((await (await api("/api/plan", { method: "PUT", body: { plan: { v: 1 }, schema_version: 5 }, cookie })).json<{ rev: number }>()).rev).toBe(1);
    expect((await (await api("/api/plan", { method: "PUT", body: { plan: { v: 2 }, schema_version: 5 }, cookie })).json<{ rev: number }>()).rev).toBe(2);
  });
});

describe("csrf", () => {
  it("blocks state-changing requests without the X-Requested-With header (403)", async () => {
    const { cookie } = await register("kyle@example.com");
    const res = await api("/api/plan", { method: "PUT", body: { plan: { a: 1 } }, cookie, csrf: false });
    expect(res.status).toBe(403);
  });
});

describe("account", () => {
  it("DELETE removes the account and cascades the plan", async () => {
    const { cookie } = await register("liz@example.com");
    await api("/api/plan", { method: "PUT", body: { plan: { a: 1 }, schema_version: 5 }, cookie });
    const del = await api("/api/account", { method: "DELETE", cookie });
    expect(del.status).toBe(204);
    // Re-login should now fail (user gone).
    const relog = await login("liz@example.com");
    expect(relog.res.status).toBe(401);
  });
});

describe("password reset: forgot", () => {
  it("returns 204 and creates a token for an existing email", async () => {
    await register("uma@example.com");
    const id = await userIdByEmail("uma@example.com");
    const res = await api("/api/auth/forgot", { body: { email: "uma@example.com" } });
    expect(res.status).toBe(204);
    expect(await liveResetCount(id)).toBe(1);
  });

  it("returns the same 204 for an unknown email (no enumeration)", async () => {
    const res = await api("/api/auth/forgot", { body: { email: "ghost@example.com" } });
    expect(res.status).toBe(204);
  });

  it("keeps only the newest token live when requested twice", async () => {
    await register("vera@example.com");
    const id = await userIdByEmail("vera@example.com");
    await api("/api/auth/forgot", { body: { email: "vera@example.com" } });
    await api("/api/auth/forgot", { body: { email: "vera@example.com" } });
    expect(await liveResetCount(id)).toBe(1);
  });
});

describe("password reset: reset", () => {
  it("sets a new password, revokes old sessions, and signs in", async () => {
    const { cookie } = await register("wes@example.com", "correct-horse-battery");
    await seedReset(await userIdByEmail("wes@example.com"), "raw-token-abc");
    const res = await api("/api/auth/reset", { body: { token: "raw-token-abc", password: "a-brand-new-password" } });
    expect(res.status).toBe(200);
    expect((await res.json<{ user: { email: string } }>()).user.email).toBe("wes@example.com");
    expect(firstCookie(res)).toMatch(/session=/);
    // The pre-reset session no longer authenticates (token_version bumped).
    expect((await (await api("/api/me", { cookie })).json<{ user: any }>()).user).toBeNull();
    // Old password fails, new password works.
    expect((await login("wes@example.com", "correct-horse-battery")).res.status).toBe(401);
    expect((await login("wes@example.com", "a-brand-new-password")).res.status).toBe(200);
  });

  it("rejects a used token (single-use)", async () => {
    await register("xena@example.com");
    await seedReset(await userIdByEmail("xena@example.com"), "tok-used", { used: true });
    expect((await api("/api/auth/reset", { body: { token: "tok-used", password: "a-brand-new-password" } })).status).toBe(400);
  });

  it("rejects an expired token", async () => {
    await register("yuki@example.com");
    await seedReset(await userIdByEmail("yuki@example.com"), "tok-old", { expiresAt: Math.floor(Date.now() / 1000) - 10 });
    expect((await api("/api/auth/reset", { body: { token: "tok-old", password: "a-brand-new-password" } })).status).toBe(400);
  });

  it("rejects a garbage token", async () => {
    expect((await api("/api/auth/reset", { body: { token: "not-a-real-token", password: "a-brand-new-password" } })).status).toBe(400);
  });

  it("rejects a weak new password", async () => {
    const res = await api("/api/auth/reset", { body: { token: "whatever", password: "short" } });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_input");
  });

  it("consuming a valid token invalidates it for reuse", async () => {
    await register("zane@example.com");
    await seedReset(await userIdByEmail("zane@example.com"), "tok-once");
    expect((await api("/api/auth/reset", { body: { token: "tok-once", password: "a-brand-new-password" } })).status).toBe(200);
    // Same token again → rejected.
    expect((await api("/api/auth/reset", { body: { token: "tok-once", password: "another-new-password" } })).status).toBe(400);
  });
});
