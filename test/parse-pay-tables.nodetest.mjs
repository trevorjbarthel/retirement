// Pure-parser tests for the DFAS pay-table pipeline. Run with Node's built-in
// runner (not vitest, which uses the Workers runtime): `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseThreshold,
  keyForColumn,
  parseMoney,
  extractGrade,
  buildTables,
  validatePayTable,
  validateYearOverYear,
} from "../scripts/parse-pay-tables.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const em = readFileSync(path.join(dir, "fixtures", "dfas-em.html"), "utf8");
const co = readFileSync(path.join(dir, "fixtures", "dfas-co.html"), "utf8");

test("threshold + key mapping (floor → 0, Over N → N: the completed-years rate starts)", () => {
  assert.deepEqual(parseThreshold("2 or less"), { kind: "floor" });
  assert.deepEqual(parseThreshold("Over 6"), { kind: "over", n: 6 });
  assert.equal(parseThreshold("Years of Service"), null);
  assert.equal(keyForColumn({ kind: "floor" }), 0);
  assert.equal(keyForColumn({ kind: "over", n: 6 }), 6);
});

test("money + grade extraction", () => {
  assert.equal(parseMoney("$3,342.90"), 3342.9);
  assert.equal(parseMoney("--"), null);
  assert.equal(extractGrade("E-5 Sergeant"), "E-5");
  assert.equal(extractGrade("Major General O-8"), "O-8");
  assert.equal(extractGrade("O-1E"), "O-1E");
});

test("enlisted page: flats collapsed, keys are the completed years each rate starts at", () => {
  const t = buildTables([em]);
  assert.deepEqual(t["E-5"], { 0: 3342.9, 2: 3598.2, 3: 3775.8, 4: 3946.8, 6: 4110, 8: 4299.9, 10: 4395.3, 12: 4421.7 });
  // E-8 has 5 leading blanks (doesn't exist <8 yrs), a duplicate at Over 28, and trailing flats.
  assert.deepEqual(t["E-8"], { 8: 5656.5, 10: 5907, 12: 6061.8, 14: 6247.2, 16: 6448.2, 18: 6811.2, 20: 6995.4, 22: 7308.3, 24: 7481.7, 26: 7908.9, 30: 8067.3 });
});

test("officer page: known grades + a NEW grade (O-8) is populated", () => {
  const t = buildTables([co]);
  assert.deepEqual(t["O-1"], { 0: 4150.2, 2: 4320, 3: 5222.4 });
  assert.equal(Object.keys(t["O-3"]).length, 9);
  // O-8 was absent from the original table; the parser fills it from the DFAS row.
  assert.deepEqual(t["O-8"], { 20: 12000, 22: 12300, 24: 12600, 26: 13000, 30: 13500 });
});

test("validation flags missing grades but accepts present ones", () => {
  const t = buildTables([em, co]);
  const errors = validatePayTable(t);
  assert.ok(errors.some((e) => e.startsWith("missing grade")), "subset should report missing grades");
  // No range/monotonic problems for the grades that ARE present.
  assert.equal(errors.filter((e) => !e.startsWith("missing")).length, 0);
});

test("validation catches a non-monotonic / out-of-range cell", () => {
  const bad = { "E-5": { 2: 3342.9, 3: 3000.0 }, "E-1": { 2: 999999 } };
  const errors = validatePayTable(bad);
  assert.ok(errors.some((e) => e.includes("not monotonic")));
  assert.ok(errors.some((e) => e.includes("out of plausible range")));
});

test("year-over-year check flags a table that's suspiciously unchanged from last year", () => {
  const prev = { "E-5": { 2: 3342.9, 3: 3598.2 }, "O-1": { 2: 4150.2 } };
  const stale = { "E-5": { 2: 3342.9, 3: 3598.2 }, "O-1": { 2: 4150.2 } }; // identical — looks like a pre-publish scrape
  const errors = validateYearOverYear(stale, prev);
  assert.ok(errors.length > 0, "an unchanged table year-over-year should be flagged");
});

test("year-over-year check passes a table with a real raise applied", () => {
  const prev = { "E-5": { 2: 3342.9, 3: 3598.2 }, "O-1": { 2: 4150.2 } };
  const raised = { "E-5": { 2: 3470.9, 3: 3735.0 }, "O-1": { 2: 4308.0 } }; // ~3.8% raise
  assert.deepEqual(validateYearOverYear(raised, prev), []);
});

test("year-over-year check is a no-op when there's no prior year to compare", () => {
  assert.deepEqual(validateYearOverYear({ "E-5": { 2: 3342.9 } }, undefined), []);
});
