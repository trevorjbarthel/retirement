// Worker environment bindings. D1Database / Fetcher come from @cloudflare/workers-types
// (loaded globally via tsconfig "types").

// Minimal shape of a Cloudflare Rate Limiting binding (avoids depending on the exact
// generated type name). See https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
  // Optional per-IP throttle on plan creation. No-op when the binding is absent.
  CREATE_LIMITER?: RateLimiter;
}

export type AppContext = {
  Bindings: Env;
};
