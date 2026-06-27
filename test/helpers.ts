import { SELF } from "cloudflare:test";

const BASE = "https://example.com";

interface ApiOpts {
  method?: string;
  body?: unknown;
}

export function api(path: string, opts: ApiOpts = {}): Promise<Response> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return SELF.fetch(BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** Create a plan and return its identifiers + the create response. */
export async function createPlan(plan: unknown = { firstName: "Pat", sepDate: "2027-06-01" }, schemaVersion = 5) {
  const res = await api("/api/p", { method: "POST", body: { plan, schema_version: schemaVersion } });
  const body = res.ok ? await res.clone().json<{ id: string; edit_key: string; rev: number }>() : null;
  return { res, ...(body ?? { id: "", edit_key: "", rev: 0 }) };
}
