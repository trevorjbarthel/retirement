// Worker environment bindings. D1Database / Fetcher come from @cloudflare/workers-types
// (loaded globally via tsconfig "types").
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  APP_ENV: string;
  PBKDF2_ITERATIONS: string;
  SESSION_TTL_SECONDS: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: { userId?: number };
};
