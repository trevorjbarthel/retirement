// DOM-layer tests for the front-end modules (public/js/*.js) in happy-dom.
//
// Separate from vitest.config.ts, which runs the Worker/D1 suite inside Miniflare: the two
// environments cannot share a config, and the browser modules import each other by the
// absolute URL path the BROWSER resolves ('/js/calc.js'), which is aliased back to the
// filesystem here. Run with `npm run test:dom`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Vite treats a directory named "public" as static assets and refuses to import from it;
  // this project's front-end SOURCE lives there (Workers Static Assets serves it verbatim).
  publicDir: false,
  // Its own cache: on Windows the Miniflare suite's worker teardown can leave Vite's shared
  // cache dir busy (EBUSY), which stalled this suite's dynamic imports when run right after it.
  cacheDir: "node_modules/.vite-dom",
  resolve: {
    alias: [{ find: /^\/js\/(.*)$/, replacement: path.join(root, "public/js/$1") }],
  },
  test: {
    environment: "happy-dom",
    include: ["test/dom/**/*.test.ts"],
    setupFiles: ["./test/dom/setup.ts"],
    // The first test in a file pays for loading every front-end module plus an 80 KB page.
    testTimeout: 20000,
  },
});
