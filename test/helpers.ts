import { SELF } from "cloudflare:test";

const BASE = "https://example.com";

export function firstCookie(res: Response): string | null {
  const sc = res.headers.get("set-cookie");
  if (!sc) return null;
  return sc.split(";")[0]; // "session=<value>"
}

interface ApiOpts {
  method?: string;
  body?: unknown;
  cookie?: string | null;
  csrf?: boolean; // default true for state-changing requests
}

export function api(path: string, opts: ApiOpts = {}): Promise<Response> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const stateChanging = method !== "GET" && method !== "HEAD";
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (stateChanging && opts.csrf !== false) headers["X-Requested-With"] = "fetch";
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  return SELF.fetch(BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export async function register(email: string, password = "correct-horse-battery") {
  const res = await api("/api/auth/register", { body: { email, password } });
  return { res, cookie: firstCookie(res), password };
}

export async function login(email: string, password = "correct-horse-battery") {
  const res = await api("/api/auth/login", { body: { email, password } });
  return { res, cookie: firstCookie(res) };
}
