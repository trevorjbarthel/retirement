// Pure parser for the official DFAS "Basic Pay" HTML pages → normalized pay table.
// No network / fs here so it's trivially unit-testable against saved fixtures.
//
// Key convention — the key is the COMPLETED years of service at which a column's rate starts:
//   "2 or less" column      -> key 0
//   "Over N"   column       -> key N
//   consecutive equal (flat) values are collapsed to the first key they appear at.
// DoD FMR Vol. 7A ch. 1: a member draws the "Over N" rate from the day after completing N
// years, so someone who answers "years of service: 20" is paid at "Over 20". The lookup in
// calc.js (highest key <= YOS) then resolves the right cell for an integer OR a fractional
// YOS (19.5 -> "Over 18"), which is what the High-3 month-by-month walk relies on.
//
// The previous convention ("Over N" -> N + 1) read integer YOS as "not yet over N", so a
// 20-year retiree was priced at the Over-18 rate; and the hand-built seed it replaced had
// keyed "Over 4" as 6, "Over 6" as 8, and so on. Both understated pay for most members.

import { parse } from "node-html-parser";

export function parseThreshold(label) {
  const s = String(label || "").toLowerCase().replace(/ /g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.includes("years of service") || s.includes("pay grade") || s === "grade" || s === "rank") return null;
  if (/\b2 (or less|or fewer)\b/.test(s) || /(^|\s)(≤|<=)\s*2\b/.test(s) || /\bunder 2\b/.test(s)) return { kind: "floor" };
  const m = s.match(/over\s*(\d+)/);
  if (m) return { kind: "over", n: Number(m[1]) };
  return null;
}

export function keyForColumn(th) {
  if (!th) return null;
  if (th.kind === "floor") return 0;
  return th.n; // "Over N" applies from the day after completing N years
}

export function parseMoney(s) {
  if (s == null) return null;
  const t = String(s).replace(/[$,\s ]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function extractGrade(s) {
  const m = String(s || "").toUpperCase().match(/\b([EWO]-\d{1,2}E?)\b/);
  return m ? m[1] : null;
}

// Parse one DFAS page into { columns: (key|null)[], rows: [{grade, money:(number|null)[]}] }.
export function parsePayTable(html) {
  const root = parse(html);
  const tables = root.querySelectorAll("table");
  if (!tables.length) throw new Error("no <table> element found");
  const table = tables.find((t) => /over\s*2|2 or less|years of service/i.test(t.text)) || tables[0];
  const trs = table.querySelectorAll("tr");

  let columns = null;
  let headerIdx = -1;
  for (let i = 0; i < trs.length; i++) {
    const cells = trs[i].querySelectorAll("th,td").map((c) => c.text);
    const cols = cells.map((c) => keyForColumn(parseThreshold(c)));
    if (cols.filter((k) => k !== null).length >= 3) {
      columns = cols;
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("could not find a header row with YOS thresholds");

  const rows = [];
  for (let i = headerIdx + 1; i < trs.length; i++) {
    const cells = trs[i].querySelectorAll("th,td").map((c) => c.text);
    if (!cells.length) continue;
    const grade = extractGrade(cells[0]) || cells.map(extractGrade).find(Boolean) || null;
    if (!grade) continue;
    rows.push({ grade, money: cells.map(parseMoney) });
  }
  return { columns, rows };
}

// One grade row → { key: amount }, skipping leading blanks and collapsing flats.
export function buildGrade(columns, money) {
  const out = {};
  let last = null;
  for (let i = 0; i < columns.length; i++) {
    const key = columns[i];
    if (key == null) continue;
    const v = money[i];
    if (v == null) continue;
    if (v === last) continue; // collapse consecutive equal (flat) values
    out[key] = v;
    last = v;
  }
  return out;
}

// Merge one or more pages into a full { grade: {key: amount} } table.
export function buildTables(htmls) {
  const table = {};
  for (const html of htmls) {
    const { columns, rows } = parsePayTable(html);
    for (const { grade, money } of rows) {
      const g = buildGrade(columns, money);
      if (Object.keys(g).length) table[grade] = g;
    }
  }
  return table;
}

function gradeRange(prefix, lo, hi) {
  const out = [];
  for (let n = lo; n <= hi; n++) out.push(`${prefix}-${n}`);
  return out;
}

// Catches the case where the annual refresh runs before DFAS has actually published
// the new year's figures: the fetch "succeeds" but silently returns last year's table,
// which would otherwise get committed and labeled as the new year with no error. A
// real annual pay raise changes virtually every cell, so if the new table is (almost)
// byte-identical to the prior year, that's a signal the scrape came back stale, not
// a legitimate 0% raise. Returns a list of human-readable problems (empty = clean).
export function validateYearOverYear(table, prevTable) {
  if (!prevTable || !Object.keys(prevTable).length) return []; // no prior year to compare (first run)
  let compared = 0;
  let identical = 0;
  for (const [grade, cells] of Object.entries(table)) {
    const prevCells = prevTable[grade];
    if (!prevCells) continue;
    for (const [key, value] of Object.entries(cells)) {
      if (!(key in prevCells)) continue;
      compared++;
      if (prevCells[key] === value) identical++;
    }
  }
  if (compared === 0) return []; // no overlapping grade/key pairs to compare — can't say anything
  const identicalFraction = identical / compared;
  if (identicalFraction > 0.9) {
    return [
      `${identical}/${compared} (${Math.round(identicalFraction * 100)}%) values are byte-identical to the prior ` +
        `year's table — this almost certainly means the source pages haven't been updated yet (DFAS publishes ` +
        `new figures effective Jan 1, sometimes after that date), not a genuine 0% pay raise. Re-run once the ` +
        `official pages reflect the new year, or pass --allow-unchanged if this is intentional.`,
    ];
  }
  return [];
}

// Returns a list of human-readable problems (empty = clean).
export function validatePayTable(table) {
  const errors = [];
  const required = [...gradeRange("E", 1, 9), ...gradeRange("W", 1, 5), ...gradeRange("O", 1, 10)];
  for (const g of required) {
    if (!table[g] || !Object.keys(table[g]).length) errors.push(`missing grade ${g}`);
  }
  for (const [g, m] of Object.entries(table)) {
    const keys = Object.keys(m).map(Number).sort((a, b) => a - b);
    let prevV = 0;
    for (const k of keys) {
      const v = m[k];
      if (!(v > 800 && v < 40000)) errors.push(`${g}@${k} out of plausible range: ${v}`);
      if (v < prevV) errors.push(`${g} not monotonic at key ${k} (${v} < ${prevV})`);
      prevV = v;
    }
  }
  return errors;
}
