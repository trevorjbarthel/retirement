// Copies the Inter woff2 files this app uses out of @fontsource/inter into public/fonts.
//
// The fonts were loaded from fonts.googleapis.com + fonts.gstatic.com. Self-hosting removes
// the last third-party origins from the CSP, stops every visitor's browser announcing this
// tool to a third party (this app's whole posture is "no accounts, no tracking"), and removes
// a render-blocking cross-origin round trip.
//
// Committed to the repo so a deploy never depends on this running; re-run after bumping
// @fontsource/inter.
import { copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";

const WEIGHTS = [400, 500, 600, 700];
const SRC = "node_modules/@fontsource/inter/files";
const DEST = "public/fonts";

if (!existsSync(SRC)) {
  console.error(`${SRC} not found — run \`npm install\` first.`);
  process.exit(1);
}
mkdirSync(DEST, { recursive: true });

let total = 0;
for (const w of WEIGHTS) {
  const from = `${SRC}/inter-latin-${w}-normal.woff2`;
  const to = `${DEST}/inter-${w}.woff2`;
  copyFileSync(from, to);
  total += statSync(to).size;
}
console.log(`Copied ${WEIGHTS.length} Inter weights to ${DEST} (${(total / 1024).toFixed(0)} KB).`);
