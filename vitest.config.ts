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
            APP_ENV: "development",
          },
        },
      },
    },
  },
});
