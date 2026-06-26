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
} from "../scripts/parse-pay-tables.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const em = readFileSync(path.join(dir, "fixtures", "dfas-em.html"), "utf8");
const co = readFileSync(path.join(dir, "fixtures", "dfas-co.html"), "utf8");

test("threshold + key mapping (floor → 2, Over N → N+1)", () => {
  assert.deepEqual(parseThreshold("2 or less"), { kind: "floor" });
  assert.deepEqual(parseThreshold("Over 6"), { kind: "over", n: 6 });
  assert.equal(parseThreshold("Years of Service"), null);
  assert.equal(keyForColumn({ kind: "floor" }), 2);
  assert.equal(keyForColumn({ kind: "over", n: 6 }), 7);
});

test("money + grade extraction", () => {
  assert.equal(parseMoney("$3,342.90"), 3342.9);
  assert.equal(parseMoney("--"), null);
  assert.equal(extractGrade("E-5 Sergeant"), "E-5");
  assert.equal(extractGrade("Major General O-8"), "O-8");
  assert.equal(extractGrade("O-1E"), "O-1E");
});

test("enlisted page: flats collapsed, keys on the N+1 convention", () => {
  const t = buildTables([em]);
  assert.deepEqual(t["E-5"], { 2: 3342.9, 3: 3598.2, 4: 3775.8, 5: 3946.8, 7: 4110, 9: 4299.9, 11: 4395.3, 13: 4421.7 });
  // E-8 has 5 leading blanks (doesn't exist <8 yrs), a duplicate at Over 28, and trailing flats.
  assert.deepEqual(t["E-8"], { 9: 5656.5, 11: 5907, 13: 6061.8, 15: 6247.2, 17: 6448.2, 19: 6811.2, 21: 6995.4, 23: 7308.3, 25: 7481.7, 27: 7908.9, 31: 8067.3 });
});

test("officer page: known grades + a NEW grade (O-8) is populated", () => {
  const t = buildTables([co]);
  assert.deepEqual(t["O-1"], { 2: 4150.2, 3: 4320, 4: 5222.4 });
  assert.equal(Object.keys(t["O-3"]).length, 9);
  // O-8 was absent from the original table; the parser fills it from the DFAS row.
  assert.deepEqual(t["O-8"], { 21: 12000, 23: 12300, 25: 12600, 27: 13000, 31: 13500 });
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
