// Pure parser for the official DFAS "Basic Pay" HTML pages → normalized pay table.
// No network / fs here so it's trivially unit-testable against saved fixtures.
//
// Key convention (correct & consistent, unlike the original hand-built seed):
//   "2 or less" column      -> key 2
//   "Over N"   column       -> key N + 1   (an integer-YOS member is "over N" at N+1)
//   consecutive equal (flat) values are collapsed to the first key they appear at.
// getBasePay2026()'s "highest key <= YOS" lookup then resolves the right cell.

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
  if (th.kind === "floor") return 2;
  return th.n + 1; // "Over N" applies to integer YOS >= N+1
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
