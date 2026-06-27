// Worker environment bindings. D1Database / Fetcher come from @cloudflare/workers-types
// (loaded globally via tsconfig "types").
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
}

export type AppContext = {
  Bindings: Env;
};
