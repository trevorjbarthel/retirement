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
  SESSION_SECRET: string;
  APP_ENV: string;
  PBKDF2_ITERATIONS: string;
  SESSION_TTL_SECONDS: string;
  // Optional per-IP/account auth throttle. When the binding is absent (local dev,
  // tests, or an un-configured deploy) the throttle is a no-op — see src/routes/auth.ts.
  AUTH_LIMITER?: RateLimiter;
  // Password-reset email (Resend). When RESEND_API_KEY is unset the reset link is logged
  // instead of emailed (dev). RESET_EMAIL_FROM/APP_BASE_URL are optional overrides.
  RESEND_API_KEY?: string;
  RESET_EMAIL_FROM?: string;
  APP_BASE_URL?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: { userId?: number };
};
