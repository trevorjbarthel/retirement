#!/usr/bin/env node
// Fetch the official DFAS basic-pay pages, parse them, validate, and (with
// --write) regenerate public/js/pay-tables.generated.js + public/data/pay-tables.json.
//
// Usage:
//   node scripts/update-pay-tables.mjs                 # dry run, current year, live fetch
//   node scripts/update-pay-tables.mjs --year 2027 --write --strict
//   node scripts/update-pay-tables.mjs --fixture       # parse test fixtures (always dry run)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildTables, validatePayTable } from "./parse-pay-tables.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const a = { write: false, fixture: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--write") a.write = true;
    else if (t === "--fixture" || t === "--from-fixture") a.fixture = true;
    else if (t === "--strict") a.strict = true;
    else if (t === "--year") a.year = argv[++i];
    else if (t.startsWith("--year=")) a.year = t.slice(7);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const YEAR = (args.year && args.year.trim()) || String(new Date().getFullYear());

const SOURCES = [
  ["enlisted", "em", "https://www.dfas.mil/MilitaryMembers/payentitlements/Pay-Tables/Basic-Pay/EM/"],
  ["officer", "co", "https://www.dfas.mil/MilitaryMembers/payentitlements/Pay-Tables/Basic-Pay/CO/"],
  ["warrant", "wo", "https://www.dfas.mil/MilitaryMembers/payentitlements/Pay-Tables/Basic-Pay/WO/"],
];

async function getHtml(slug, url) {
  if (args.fixture) {
    return readFileSync(path.join(ROOT, "test", "fixtures", `dfas-${slug}.html`), "utf8");
  }
  const res = await fetch(url, { headers: { "user-agent": "mtc-paytable-bot/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const htmls = [];
for (const [name, slug, url] of SOURCES) {
  try {
    htmls.push(await getHtml(slug, url));
    console.log(`fetched ${name}`);
  } catch (e) {
    console.error(`WARN: ${name} unavailable — ${e.message}`);
  }
}
if (!htmls.length) {
  console.error("No source pages could be retrieved.");
  process.exit(1);
}

const table = buildTables(htmls);
const errors = validatePayTable(table);
console.log(`parsed ${Object.keys(table).length} grades for ${YEAR}`);
if (errors.length) {
  console.error(`validation issues (${errors.length}):\n - ${errors.join("\n - ")}`);
  if (args.strict) process.exit(1);
}

const writing = args.write && !args.fixture; // never overwrite committed data from fixtures
if (!writing) {
  console.log(args.fixture ? "(fixture mode — dry run)" : "(dry run — pass --write to update committed files)");
  console.log("sample E-5:", JSON.stringify(table["E-5"] || table["O-1"] || {}));
  process.exit(0);
}

const genPath = path.join(ROOT, "public", "js", "pay-tables.generated.js");
const jsonPath = path.join(ROOT, "public", "data", "pay-tables.json");
let payTables = {};
try {
  payTables = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch {
  /* first run */
}
payTables[YEAR] = table;
const latest = Object.keys(payTables).sort().at(-1);
const banner =
  "// ===== pay-tables.generated.js =====\n" +
  "// GENERATED FILE — do not edit by hand.\n" +
  "// Produced by scripts/update-pay-tables.mjs from the official DFAS basic-pay tables.\n";
const gen =
  `${banner}export const PAY_TABLES = ${JSON.stringify(payTables, null, 2)};\n\n` +
  `// Active table consumed by calc.js (latest available year).\n` +
  `export const BASE_PAY_2026 = PAY_TABLES["${latest}"];\n`;
writeFileSync(genPath, gen);
writeFileSync(jsonPath, JSON.stringify(payTables, null, 2) + "\n");
console.log(`wrote ${YEAR}; active table = ${latest}`);
