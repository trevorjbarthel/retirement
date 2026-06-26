// Stateless session: a signed cookie carrying `userId.tokenVersion.exp`.
// Signature is HMAC-SHA-256 over that payload with SESSION_SECRET. No sessions
// table; revocation is achieved by bumping users.token_version.
import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { AppContext, Env } from "../env";

export const SESSION_COOKIE = "session";

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface SessionPayload {
  userId: number;
  tokenVersion: number;
  exp: number; // unix seconds
}

export async function createSessionToken(p: SessionPayload, secret: string): Promise<string> {
  const payload = `${p.userId}.${p.tokenVersion}.${p.exp}`;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [uid, tv, exp, sig] = parts;
  const payload = `${uid}.${tv}.${exp}`;
  const key = await hmacKey(secret);
  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", key, b64urlDecode(sig), enc.encode(payload));
  } catch {
    return null;
  }
  if (!valid) return null;
  const userId = Number(uid);
  const tokenVersion = Number(tv);
  const expNum = Number(exp);
  if (!Number.isInteger(userId) || !Number.isInteger(tokenVersion) || !Number.isFinite(expNum)) return null;
  if (expNum < Math.floor(Date.now() / 1000)) return null;
  return { userId, tokenVersion, exp: expNum };
}

function ttlSeconds(env: Env): number {
  const n = Number(env.SESSION_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 1209600; // 14 days
}

export async function issueSession(
  c: Context<AppContext>,
  user: { id: number; token_version: number },
): Promise<void> {
  const ttl = ttlSeconds(c.env);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const token = await createSessionToken(
    { userId: user.id, tokenVersion: user.token_version, exp },
    c.env.SESSION_SECRET,
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: c.env.APP_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: ttl,
  });
}

export function clearSession(c: Context<AppContext>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}
