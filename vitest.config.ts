import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const migrations = await readD1Migrations(path.join(root, "migrations"));

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Migrations are handed to the setup file via this binding.
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: "test-secret-0123456789abcdef0123456789",
            APP_ENV: "development",
            PBKDF2_ITERATIONS: "1000", // low for fast tests
            SESSION_TTL_SECONDS: "3600",
          },
        },
      },
    },
  },
});
