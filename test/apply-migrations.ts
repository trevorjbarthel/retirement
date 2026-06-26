import { applyD1Migrations, env } from "cloudflare:test";

// Runs once before the suite: build the schema in the isolated local D1.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS as any);
