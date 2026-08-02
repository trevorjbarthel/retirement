// Generates public/js/icons.generated.js — the inline SVG path data for exactly the icons
// this app uses, and nothing else.
//
// Replaces a 96 KB-gzipped `lucide.min.js` from unpkg that shipped all ~1,600 icons to draw
// about 60. Beyond the bytes, that CDN <script> was the only remaining third-party origin in
// the CSP's script-src; dropping it lets script-src become plain 'self'.
//
// Icon names are DISCOVERED by scanning the source rather than hand-listed, so adding an
// icon to a template can't silently produce a blank space. A referenced icon that lucide
// doesn't have is a hard error.
//
// Run: npm run build:icons
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ICON_DIR = "node_modules/lucide-static/icons";
const OUT = "public/js/icons.generated.js";
const SOURCES = ["public/index.html", "public/js/app.js", "public/js/calc.js"];

// Icons referenced somewhere the scanner can't see them literally (none today). Kept as an
// explicit escape hatch so a future dynamic case has an honest home instead of a silent gap.
const EXTRA = [];

function collectNames() {
  const names = new Set(EXTRA);
  for (const file of SOURCES) {
    const src = readFileSync(file, "utf8");
    // <i data-lucide="flag">
    for (const m of src.matchAll(/data-lucide="([a-z0-9][a-z0-9-]*)"/g)) names.add(m[1]);
    // { icon: 'flag' } — milestone/advisory/day-meter definitions in calc.js and app.js
    for (const m of src.matchAll(/\bicon:\s*['"]([a-z0-9][a-z0-9-]*)['"]/g)) names.add(m[1]);
  }
  return [...names].sort();
}

// Pull the inner markup out of a lucide SVG file and normalise whitespace. The wrapper
// <svg> is discarded: the runtime supplies its own with the caller's classes and sizing.
function innerOf(name) {
  const file = join(ICON_DIR, `${name}.svg`);
  if (!existsSync(file)) {
    const near = readdirSync(ICON_DIR)
      .map((f) => f.replace(/\.svg$/, ""))
      .filter((n) => n.startsWith(name.slice(0, 4)))
      .slice(0, 5);
    throw new Error(
      `Icon "${name}" is referenced in the source but does not exist in lucide-static.` +
        (near.length ? ` Did you mean: ${near.join(", ")}?` : ""),
    );
  }
  const svg = readFileSync(file, "utf8");
  const body = svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"));
  return body.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, " ").trim();
}

const names = collectNames();
const entries = names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(innerOf(n))},`);

const version = JSON.parse(readFileSync("node_modules/lucide-static/package.json", "utf8")).version;
const out = `// ===== icons.generated.js =====
// GENERATED FILE — do not edit by hand. Run \`npm run build:icons\`.
//
// Inline path data for the ${names.length} Lucide icons this app actually references,
// extracted from lucide-static v${version} (ISC licensed). See scripts/build-icons.mjs.
//
// Icon names are discovered by scanning the source, so this file follows the templates
// automatically; \`npm run check:icons\` fails the build if it has drifted.

/** @type {Record<string, string>} */
export const ICON_PATHS = {
${entries.join("\n")}
};
`;

const prev = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;
if (process.argv.includes("--check")) {
  if (prev !== out) {
    console.error(
      "public/js/icons.generated.js is stale.\n" +
        "Run `npm run build:icons` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`icons.generated.js is up to date (${names.length} icons).`);
} else {
  writeFileSync(OUT, out, "utf8");
  console.log(`Wrote ${OUT} — ${names.length} icons, ${(out.length / 1024).toFixed(1)} KB.`);
}
