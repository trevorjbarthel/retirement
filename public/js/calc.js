// ===== calc.js =====
// Pure, DOM-free data + calculation logic shared by the front-end (loaded as an
// ES module over HTTP) and the test suite. No document/window access here.
// Extracted verbatim from the original single-file app, plus new helpers.

// Pay tables are generated from official DFAS data (scripts/update-pay-tables.mjs).
// PAY_TABLES is year-keyed ({ "2026": {...} }); BASE_PAY_2026 is the latest year, kept as a
// named export because the front end and tests already import it.
import { BASE_PAY_2026, PAY_TABLES } from './pay-tables.generated.js';
export { BASE_PAY_2026, PAY_TABLES };

// Available pay-table years, newest first. Derived from the data rather than hardcoded so a
// label can never claim a vintage the table doesn't actually contain.
export const PAY_TABLE_YEARS = Object.keys(PAY_TABLES).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
export const PAY_TABLE_YEAR = PAY_TABLE_YEARS[0] ?? null;

export const SKILLBRIDGE_LIMITS = {
  'Army': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 90, 'E-7': 90, 'E-8': 60, 'E-9': 60, 'W-1': 90, 'W-2': 90, 'W-3': 90, 'W-4': 60, 'W-5': 60, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 90, 'O-5': 60 },
  'Air Force': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 90, 'E-7': 90, 'E-8': 60, 'E-9': 60, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 90, 'O-5': 60 },
  'Navy': { 'E-2': 180, 'E-3': 180, 'E-4': 180, 'E-5': 180, 'E-6': 120, 'E-7': 120, 'E-8': 120, 'E-9': 120, 'W-1': 120, 'W-2': 120, 'W-3': 120, 'W-4': 120, 'W-5': 120, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 120, 'O-5': 90 },
  'Space Force': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 120, 'E-7': 120, 'E-8': 120, 'E-9': 90, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 120, 'O-5': 90 },
  'Marine Corps': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 90, 'E-7': 90, 'E-8': 90, 'E-9': 90, 'W-1': 90, 'W-2': 90, 'W-3': 90, 'W-4': 90, 'W-5': 90, 'O-1': 90, 'O-2': 90, 'O-3': 90, 'O-4': 90, 'O-5': 90, 'O-6': 90, 'O-7': 90 },
  'Coast Guard': {}
};


// Veteran-alone (no dependents) monthly rates, effective Dec 1, 2025 COLA.
// Verified against VA published figures (va.gov/disability/compensation-rates/veteran-rates)
// — keep the whole table on one vintage, and update DATA_VINTAGE.vaRates in the same change.
// NOTE: deliberately NOT named for a year. The old `VA_RATES_2025` name disagreed with both
// the COLA vintage in this comment and DATA_VINTAGE.vaRates, which is exactly the drift that
// makes the next refresh dangerous. The vintage lives in DATA_VINTAGE, in one place.
/** @type {Record<number, number>} */
export const VA_RATES = { 0:0, 10:180.42, 20:356.66, 30:552.47, 40:795.84, 50:1132.90, 60:1435.02, 70:1808.45, 80:2102.15, 90:2362.30, 100:3938.58 };

// Dependent rates, same Dec 1 2025 vintage. VA publishes these as full replacement rates for
// the three common configurations plus per-dependent add-ons, NOT as a single additive rule —
// so they are stored the way VA publishes them rather than derived. Ratings under 30% pay no
// dependent allowance at all, which is why this table starts at 30.
// Source: va.gov/disability/compensation-rates/veteran-rates
export const VA_RATES_WITH_DEPENDENTS = {
  30:  { spouse: 617.47,  spouseChild: 666.47,  child: 596.47,  addChildU18: 32.00,  addChildSchool: 105.00,  spouseAA: 61.00 },
  40:  { spouse: 882.84,  spouseChild: 947.84,  child: 853.84,  addChildU18: 43.00,  addChildSchool: 140.00,  spouseAA: 81.00 },
  50:  { spouse: 1241.90, spouseChild: 1322.90, child: 1205.90, addChildU18: 54.00,  addChildSchool: 176.00,  spouseAA: 101.00 },
  60:  { spouse: 1566.02, spouseChild: 1663.02, child: 1523.02, addChildU18: 65.00,  addChildSchool: 211.00,  spouseAA: 121.00 },
  70:  { spouse: 1961.45, spouseChild: 2074.45, child: 1910.45, addChildU18: 76.00,  addChildSchool: 246.00,  spouseAA: 141.00 },
  80:  { spouse: 2277.15, spouseChild: 2406.15, child: 2219.15, addChildU18: 87.00,  addChildSchool: 281.00,  spouseAA: 161.00 },
  90:  { spouse: 2559.30, spouseChild: 2704.30, child: 2494.30, addChildU18: 98.00,  addChildSchool: 317.00,  spouseAA: 181.00 },
  100: { spouse: 4158.17, spouseChild: 4318.99, child: 4085.43, addChildU18: 109.11, addChildSchool: 352.45, spouseAA: 201.41 },
};

// Monthly VA compensation for a rating and household. Every VA figure in the app routes
// through here so the veteran-alone table is never silently applied to a married retiree
// (which understated a married 100% retiree by $219.59/mo before this existed).
/**
 * @param {{rating?: number, spouse?: boolean, childrenU18?: number,
 *   childrenSchool?: number, spouseAidAttendance?: boolean}} [opts]
 * @returns {number}
 */
export function vaCompensation({ rating = 0, spouse = false, childrenU18 = 0, childrenSchool = 0, spouseAidAttendance = false } = {}) {
  const r = Number(rating) || 0;
  const alone = VA_RATES[r];
  if (alone === undefined) return 0;
  const dep = VA_RATES_WITH_DEPENDENTS[r];
  // Under 30% VA pays no dependent allowance, so the veteran-alone rate is the whole answer.
  if (!dep) return alone;
  const u18 = Math.max(0, Math.trunc(Number(childrenU18) || 0));
  const school = Math.max(0, Math.trunc(Number(childrenSchool) || 0));
  const hasSpouse = !!spouse;

  let base, u18Counted = 0, schoolCounted = 0;
  if (hasSpouse && (u18 + school) > 0) {
    // The published "spouse + 1 child" rate already contains one child; bill the rest as add-ons.
    base = dep.spouseChild;
    if (u18 > 0) { u18Counted = u18 - 1; schoolCounted = school; }
    else { schoolCounted = school - 1; }
  } else if (hasSpouse) {
    base = dep.spouse;
  } else if ((u18 + school) > 0) {
    base = dep.child;
    if (u18 > 0) { u18Counted = u18 - 1; schoolCounted = school; }
    else { schoolCounted = school - 1; }
  } else {
    base = alone;
  }

  let total = base
    + Math.max(0, u18Counted) * dep.addChildU18
    + Math.max(0, schoolCounted) * dep.addChildSchool;
  if (hasSpouse && spouseAidAttendance) total += dep.spouseAA;
  return Math.round(total * 100) / 100;
}

export const STATE_TAX_DATA = {
  'AL': { name:'Alabama', militaryRetirementTax:'exempt', topRate:5.0, note:'Military retirement pay is fully exempt from Alabama income tax.' },
  'AK': { name:'Alaska', militaryRetirementTax:'exempt', topRate:0, note:'Alaska has no state income tax.' },
  'AZ': { name:'Arizona', militaryRetirementTax:'exempt', topRate:2.5, note:'Military retirement pay is fully exempt from Arizona income tax (as of 2021).' },
  'AR': { name:'Arkansas', militaryRetirementTax:'partial', topRate:3.9, note:'Military retirement pay is partially exempt (first $6,000 exempt for under age 59½; fully exempt at 59½+).' },
  'CA': { name:'California', militaryRetirementTax:'partial', topRate:13.3, note:'Up to $20,000 of military retirement pay exempt for AGI ≤$125,000 (single) / ≤$250,000 (joint), tax years 2025–2029 (SB 132).' },
  'CO': { name:'Colorado', militaryRetirementTax:'partial', topRate:4.4, note:'Up to $24,000 of military retirement pay exempt for those 65+; $20,000 for ages 55–64.' },
  'CT': { name:'Connecticut', militaryRetirementTax:'exempt', topRate:6.99, lastVerified:'2026-08', note:'Military retirement pay is fully exempt from Connecticut income tax. (The old 50%-under-$75k/$100k-AGI rule was superseded — full exemption has been in effect since 2015.)' },
  'DE': { name:'Delaware', militaryRetirementTax:'partial', topRate:6.6, note:'Up to $12,500 of military retirement pay is exempt.' },
  'FL': { name:'Florida', militaryRetirementTax:'exempt', topRate:0, note:'Florida has no state income tax — very favorable for retirees.' },
  'GA': { name:'Georgia', militaryRetirementTax:'partial', topRate:4.99, note:'Up to $65,000 of military retirement pay exempt for retirees of any age, starting tax year 2026.' },
  'HI': { name:'Hawaii', militaryRetirementTax:'exempt', topRate:11.0, note:'Military retirement pay is fully exempt from Hawaii income tax.' },
  'ID': { name:'Idaho', militaryRetirementTax:'partial', topRate:5.3, note:'Exempt up to the indexed max Social Security benefit (~$40,536 for 2026) for retirees who are disabled, 62+, or otherwise required to file.' },
  'IL': { name:'Illinois', militaryRetirementTax:'exempt', topRate:4.95, note:'Military retirement pay is fully exempt from Illinois income tax.' },
  'IN': { name:'Indiana', militaryRetirementTax:'exempt', topRate:3.05, note:'Military retirement pay is fully exempt from Indiana income tax.' },
  'IA': { name:'Iowa', militaryRetirementTax:'exempt', topRate:3.8, note:'Military retirement pay is fully exempt from Iowa income tax (flat 3.8% rate as of 2026).' },
  'KS': { name:'Kansas', militaryRetirementTax:'exempt', topRate:5.58, note:'Military retirement pay is fully exempt from Kansas income tax.' },
  'KY': { name:'Kentucky', militaryRetirementTax:'partial', topRate:3.5, note:'Up to $31,110 of military retirement pay is exempt; retirees who left service before 1/1/1998 are fully exempt.' },
  'LA': { name:'Louisiana', militaryRetirementTax:'exempt', topRate:3.0, note:'Military retirement pay is fully exempt from Louisiana income tax.' },
  'ME': { name:'Maine', militaryRetirementTax:'exempt', topRate:7.15, note:'Military retirement pay is fully exempt; expanded in 2026 to cover Space Force and NOAA Corps retirees.' },
  'MD': { name:'Maryland', militaryRetirementTax:'partial', topRate:5.75, note:'Up to $5,000 exempt under age 55; up to $15,000 exempt at 55+. Local taxes also apply.' },
  'MA': { name:'Massachusetts', militaryRetirementTax:'exempt', topRate:5.0, note:'Military retirement pay is fully exempt from Massachusetts income tax.' },
  'MI': { name:'Michigan', militaryRetirementTax:'exempt', topRate:4.25, note:'Military retirement pay is fully exempt from Michigan income tax regardless of age or retirement date.' },
  'MN': { name:'Minnesota', militaryRetirementTax:'taxed', topRate:9.85, note:'Minnesota taxes military retirement pay as regular income (limited exemption for some Combat-Related Special Compensation).' },
  'MS': { name:'Mississippi', militaryRetirementTax:'exempt', topRate:4.7, note:'Military retirement pay is fully exempt from Mississippi income tax.' },
  'MO': { name:'Missouri', militaryRetirementTax:'exempt', topRate:4.8, note:'Military retirement pay is fully exempt from Missouri income tax (as of 2016).' },
  'MT': { name:'Montana', militaryRetirementTax:'partial', topRate:5.65, note:'Working military retirees with MT-source earned income may deduct up to 50% of retirement pay; the prior 5-year limit was removed starting 2026.' },
  'NE': { name:'Nebraska', militaryRetirementTax:'exempt', topRate:3.84, note:'Military retirement pay is fully exempt from Nebraska income tax (as of 2022).' },
  'NV': { name:'Nevada', militaryRetirementTax:'exempt', topRate:0, note:'Nevada has no state income tax.' },
  'NH': { name:'New Hampshire', militaryRetirementTax:'exempt', topRate:0, note:'New Hampshire has no income tax on wages/retirement (only taxes interest/dividends, phasing out by 2025).' },
  'NJ': { name:'New Jersey', militaryRetirementTax:'exempt', topRate:10.75, note:'Military retirement pay is fully exempt from New Jersey income tax.' },
  'NM': { name:'New Mexico', militaryRetirementTax:'partial', topRate:5.9, lastVerified:'2026-08', note:'Up to $30,000 of military retirement pay is exempt (phased in $10k 2022 → $20k 2023 → $30k for tax year 2024 and after).' },
  'NY': { name:'New York', militaryRetirementTax:'exempt', topRate:10.9, note:'Military retirement pay from the US government is fully exempt from New York income tax.' },
  'NC': { name:'North Carolina', militaryRetirementTax:'partial', topRate:4.5, note:'Military retirement pay exempt if member had 5+ years of creditable service before August 12, 1989; otherwise taxed.' },
  'ND': { name:'North Dakota', militaryRetirementTax:'exempt', topRate:2.5, note:'Military retirement pay is fully exempt from North Dakota income tax.' },
  'OH': { name:'Ohio', militaryRetirementTax:'exempt', topRate:3.5, note:'Military retirement pay is fully exempt from Ohio income tax.' },
  'OK': { name:'Oklahoma', militaryRetirementTax:'exempt', topRate:4.75, lastVerified:'2026-08', note:'Military retirement pay is 100% exempt from Oklahoma income tax for tax year 2022 and after (SB 401, 2021). The prior $10,000 cap no longer applies.' },
  'OR': { name:'Oregon', militaryRetirementTax:'partial', topRate:9.9, note:'Federal pension subtraction may apply up to certain limits; Oregon has one of the highest tax rates.' },
  'PA': { name:'Pennsylvania', militaryRetirementTax:'exempt', topRate:3.07, note:'Military retirement pay is fully exempt from Pennsylvania income tax.' },
  'RI': { name:'Rhode Island', militaryRetirementTax:'partial', topRate:5.99, note:'Military retirement pay may be partially exempt for those over 59½ up to $20,000.' },
  'SC': { name:'South Carolina', militaryRetirementTax:'exempt', topRate:6.2, note:'Military retirement pay is fully exempt from South Carolina income tax (as of 2022).' },
  'SD': { name:'South Dakota', militaryRetirementTax:'exempt', topRate:0, note:'South Dakota has no state income tax.' },
  'TN': { name:'Tennessee', militaryRetirementTax:'exempt', topRate:0, note:'Tennessee has no state income tax on wages or retirement income.' },
  'TX': { name:'Texas', militaryRetirementTax:'exempt', topRate:0, note:'Texas has no state income tax — very favorable for military retirees.' },
  'UT': { name:'Utah', militaryRetirementTax:'exempt', topRate:4.65, lastVerified:'2026-08', note:'Military retirement pay is effectively fully exempt: SB 11 (2021) created a nonrefundable credit equal to the tax on military retirement pay, for retirees of ANY age, retroactive to 1/1/2021. (Utah’s separate 65+ retirement credit is a different provision.)' },
  'VT': { name:'Vermont', militaryRetirementTax:'partial', topRate:8.75, note:'Fully exempt for AGI ≤$125,000; phases out $125,000–$175,000; fully taxed above $175,000 (effective 2025, Act 71).' },
  'VA': { name:'Virginia', militaryRetirementTax:'partial', topRate:5.75, lastVerified:'2026-08', note:'Up to $40,000 of military benefits may be subtracted for tax year 2025 and after, with NO age requirement (the age-55 floor was removed starting tax year 2023). Phased in $10k/yr from 2022.' },
  'WA': { name:'Washington', militaryRetirementTax:'exempt', topRate:0, note:'Washington has no state income tax.' },
  'WV': { name:'West Virginia', militaryRetirementTax:'exempt', topRate:4.82, note:'Military retirement pay is fully exempt from West Virginia income tax.' },
  'WI': { name:'Wisconsin', militaryRetirementTax:'taxed', topRate:7.65, note:'Wisconsin taxes military retirement pay as regular income.' },
  'WY': { name:'Wyoming', militaryRetirementTax:'exempt', topRate:0, note:'Wyoming has no state income tax.' },
  'DC': { name:'District of Columbia', militaryRetirementTax:'taxed', topRate:10.75, note:'DC taxes military retirement pay as regular income.' },
};

export const ANNUITY_FACTORS = {
  38: 4.20, 40: 4.35, 42: 4.52, 44: 4.70, 45: 4.80, 46: 4.90,
  48: 5.12, 50: 5.35, 52: 5.60, 54: 5.87, 55: 6.02, 56: 6.17,
  58: 6.50, 60: 6.86, 62: 7.25, 64: 7.68, 65: 7.91, 67: 8.42,
  70: 9.35
};

// Bracket selection against an arbitrary year's table. Non-finite YOS falls to the lowest
// bracket rather than returning undefined (which rendered as "$NaN" downstream).
function payFromTable(table, rank, yearsOfService) {
  const rankData = table && table[rank];
  if (!rankData) return null;
  const brackets = Object.keys(rankData).map(Number).sort((a, b) => a - b);
  const y = Number(yearsOfService);
  let selected = brackets[0];
  if (Number.isFinite(y)) {
    for (const b of brackets) {
      if (y >= b) selected = b;
      else break;
    }
  }
  return rankData[selected];
}

export function getBasePay2026(rank, yearsOfService) {
  return payFromTable(BASE_PAY_2026, rank, yearsOfService);
}

// Basic pay for a specific calendar year, falling back to the nearest year we actually have.
// Returns { pay, year, exact } so a caller can tell the user when a figure was estimated
// from a different year's table instead of silently presenting it as fact.
export function getBasePayForYear(year, rank, yearsOfService) {
  if (!PAY_TABLE_YEARS.length) return null;
  const want = Number(year);
  let use = PAY_TABLE_YEARS[0];
  if (Number.isFinite(want)) {
    if (PAY_TABLES[String(want)]) use = want;
    else {
      // Nearest available year; ties go to the older table (a real prior-year figure beats
      // extrapolating a future raise we have no data for).
      use = PAY_TABLE_YEARS.reduce((best, y) =>
        Math.abs(y - want) < Math.abs(best - want) || (Math.abs(y - want) === Math.abs(best - want) && y < best) ? y : best,
      PAY_TABLE_YEARS[0]);
    }
  }
  const pay = payFromTable(PAY_TABLES[String(use)], rank, yearsOfService);
  return pay === null || pay === undefined ? null : { pay, year: use, exact: use === want };
}

// One grade down, used to estimate the months before a promotion. Returns null at the floor.
function previousGrade(grade) {
  const m = /^([EWO])-(\d+)$/.exec(String(grade || ''));
  if (!m) return null;
  const n = Number(m[2]);
  return n > 1 ? `${m[1]}-${n - 1}` : null;
}

// ----- High-3 -----
// Retired pay is a percentage of the average of the HIGHEST 36 MONTHS of basic pay, not of
// current basic pay. Multiplying current pay (what the app did before) biases the result high
// for anyone promoted or crossing a longevity step inside the last three years — and that one
// number seeds retired pay, SBP, CRDP/CRSC, the domicile comparison and the income table.
//
// For a normal (monotonically rising) career the highest 36 months are the last 36, so we walk
// back month by month from the separation date, applying the correct pay-table YEAR and the
// member's YOS bracket at that month. If the Date of Rank falls inside the window, the earlier
// months were served at a lower grade; we estimate those one grade down and flag it, because
// the alternative — charging them at the current grade — is exactly the overstatement being
// fixed here.
/**
 * @param {{grade: string, yos: number, sepDate: string|Date,
 *   dateOfRank?: string|Date|null, months?: number}} opts
 */
export function computeHigh3({ grade, yos, sepDate, /** @type {string|Date|null} */ dateOfRank = null, months = 36 }) {
  const sep = sepDate instanceof Date ? sepDate : new Date(String(sepDate) + 'T00:00:00');
  if (!(sep instanceof Date) || isNaN(sep.getTime())) return null;
  const dor = dateOfRank
    ? (dateOfRank instanceof Date ? dateOfRank : new Date(String(dateOfRank) + 'T00:00:00'))
    : null;
  const validDor = dor && !isNaN(dor.getTime()) ? dor : null;
  const totalYos = Number(yos);
  const n = Math.max(1, Math.trunc(Number(months) || 36));

  const samples = [];
  let promotionInWindow = false;
  let inexactYear = false;
  const yearsUsed = new Set();

  for (let i = 1; i <= n; i++) {
    // The month that is i months before separation.
    const m = new Date(sep.getFullYear(), sep.getMonth() - i, 1);
    const yosAt = Number.isFinite(totalYos) ? Math.max(0, totalYos - i / 12) : totalYos;
    let gradeAt = grade;
    if (validDor && m < validDor) {
      const prev = previousGrade(grade);
      if (prev) { gradeAt = prev; promotionInWindow = true; }
    }
    let row = getBasePayForYear(m.getFullYear(), gradeAt, yosAt);
    // A grade one step down may not exist in the table (or the estimate may be unusable);
    // fall back to the real grade rather than dropping the month out of the average.
    if (!row) row = getBasePayForYear(m.getFullYear(), grade, yosAt);
    if (!row) continue;
    if (!row.exact) inexactYear = true;
    yearsUsed.add(row.year);
    samples.push(row.pay);
  }

  if (!samples.length) return null;
  // "Highest 36" — sort descending and take the window, so a pay freeze or a table without
  // prior years can't drag the average below the member's actual best three years.
  samples.sort((a, b) => b - a);
  const window = samples.slice(0, n);
  const avg = window.reduce((t, v) => t + v, 0) / window.length;

  return {
    monthly: Math.round(avg * 100) / 100,
    monthsSampled: window.length,
    yearsUsed: [...yearsUsed].sort((a, b) => a - b),
    promotionInWindow,
    // True when at least one month had to borrow a different year's table — i.e. the app does
    // not yet hold pay tables covering the whole 36-month window.
    estimatedFromSingleYear: inexactYear,
  };
}

export function parseStateFromLocation(locationStr) {
  if (!locationStr) return null;
  const upper = locationStr.trim().toUpperCase();
  // Direct 2-letter state code
  if (STATE_TAX_DATA[upper]) return upper;
  // District of Columbia — must precede the "WASHINGTON" full-name match (which would
  // otherwise grab "Washington DC" as Washington STATE).
  if (/\bD\.?C\.?\b/.test(upper) || upper.includes('DISTRICT OF COLUMBIA')) return 'DC';
  // Strip a trailing country and ZIP/ZIP+4 before looking for a state abbreviation. The old
  // pattern anchored the abbreviation to end-of-string, so "San Antonio, TX 78205" — the most
  // common way an American writes an address — returned null, which silently blanked the whole
  // State Tax panel and left the Best-State comparison empty.
  const trimmed = upper
    .replace(/[\s,]+(U\.?S\.?A\.?|UNITED STATES( OF AMERICA)?)\.?\s*$/, '')
    .replace(/[\s,]*\b\d{5}(-\d{4})?\s*$/, '')
    .trim();
  // Take the LAST ", XX" that is a real state code, so "Portland, OR" still wins in a string
  // that happens to contain an earlier abbreviation. \b after the pair keeps a full state name
  // ("…, MISSOURI") from matching its own first two letters.
  const codes = [...trimmed.matchAll(/,\s*([A-Z]{2})\b/g)]
    .map((m) => m[1])
    .filter((c) => STATE_TAX_DATA[c]);
  if (codes.length) return codes[codes.length - 1];
  // Full state name search — longest names first so "West Virginia" wins over "Virginia".
  const byNameLen = Object.entries(STATE_TAX_DATA).sort((a, b) => b[1].name.length - a[1].name.length);
  for (const [code, data] of byNameLen) {
    if (trimmed.includes(data.name.toUpperCase())) return code;
  }
  return null;
}

// The app's two age-indexed lookups (annuity factor, life expectancy) are both "clamp to the
// table's range, exact hit if present, otherwise linear-interpolate between neighbours". That
// was written out twice with subtly different clamp floors (38 vs 45); it lives here once so
// the two can't drift apart again. Non-finite input falls back to the table's low end rather
// than propagating NaN through every downstream dollar figure.
export const AGE_TABLE_RANGE = { min: 38, max: 70 };

function lookupByAge(table, age) {
  const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
  const n = Number(age);
  const a = Number.isFinite(n) ? Math.max(ages[0], Math.min(ages[ages.length - 1], n)) : ages[0];
  if (table[a] !== undefined) return table[a];
  let lower = ages[0], upper = ages[ages.length - 1];
  for (let i = 0; i < ages.length - 1; i++) {
    if (ages[i] <= a && ages[i + 1] >= a) { lower = ages[i]; upper = ages[i + 1]; break; }
  }
  const ratio = (a - lower) / (upper - lower);
  return table[lower] + ratio * (table[upper] - table[lower]);
}

export function interpolateAnnuityFactor(age) {
  return lookupByAge(ANNUITY_FACTORS, age);
}

// IRS Single Life Expectancy Table (Treas. Reg. § 1.401(a)(9)-9(b), the post-2022 values),
// which is the table TSP applies to life-expectancy installment payments before RMD age.
//
// This previously held six anchor points that were all exactly `92.5 - age` — an invented
// straight line, not an IRS table, despite the UI attributing it to the IRS. Because the
// distribution period is the DIVISOR for the installment estimate, an over-long period
// understates the payment: at 55 the fake table said 37.5 years ($1,333/mo on $600k) where
// the real table says 31.6 ($1,582/mo) — a 19% understatement of the headline number.
export const IRS_SINGLE_LIFE_TABLE = {
  38: 47.5, 39: 46.5, 40: 45.7, 41: 44.8, 42: 43.8, 43: 42.9, 44: 41.9, 45: 41.0,
  46: 40.0, 47: 39.0, 48: 38.1, 49: 37.1, 50: 36.2, 51: 35.3, 52: 34.3, 53: 33.4,
  54: 32.5, 55: 31.6, 56: 30.6, 57: 29.8, 58: 28.9, 59: 28.0, 60: 27.1, 61: 26.2,
  62: 25.4, 63: 24.5, 64: 23.7, 65: 22.9, 66: 22.0, 67: 21.2, 68: 20.4, 69: 19.6,
  70: 18.8,
};

export function getLifeExpDistributionPeriod(age) {
  return lookupByAge(IRS_SINGLE_LIFE_TABLE, age);
}

export function subDays(d, n) { const r = new Date(d); r.setDate(r.getDate() - n); return r; }

export function addDays(d, n) { return subDays(d, -n); }

export function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

export function firstOfNextMonth(d) { const r = new Date(d.getFullYear(), d.getMonth() + 1, 1); return r; }

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function getRankGrade(rankStr) {
  if (!rankStr) return '';
  const match = rankStr.match(/^([EWO]-\d+)/);
  return match ? match[1] : '';
}

export function getSkillbridgeAuthorizedMax(branch, rankGrade) {
  if (!branch || !rankGrade) return null;
  const branchLimits = SKILLBRIDGE_LIMITS[branch] || {};
  return branchLimits[rankGrade] !== undefined ? branchLimits[rankGrade] : null;
}


// ===== NEW PURE HELPERS (added during the Workers/D1 migration) =====

// Basic Allowance for Subsistence, monthly. Flat per category, so unlike BAH these are safe
// to ship as constants. They lived inline in index.html, where a refresh could silently
// diverge from DATA_VINTAGE; every consumer reads them from here now.
export const BAS_RATES = { officer: 328.48, enlisted: 476.95 };
export function getBAS(rankCat) { return rankCat === 'O' ? BAS_RATES.officer : BAS_RATES.enlisted; }

// Data provenance — surfaced in the UI so future updates are obvious.
// basePay is DERIVED from the generated table rather than typed out: the January pay-table
// refresh workflow only commits the two generated files, so a hardcoded label was guaranteed
// to keep saying "2026 tables" while the app computed the following year's pay.
export const DATA_VINTAGE = {
  asOf: 'August 2026',
  basePay: PAY_TABLE_YEAR
    ? `${PAY_TABLE_YEAR} DFAS Basic Pay Tables (effective Jan 1 ${PAY_TABLE_YEAR})`
    : 'DFAS Basic Pay Tables',
  vaRates: 'VA disability compensation rates (Dec 1 2025 COLA)',
  stateTax: '2026 enacted state tax law',
  bas: '2026 Basic Allowance for Subsistence',
  tsp: 'IRS Single Life Expectancy Table; annuity factors approximate',
};

// General/flag officers: basic pay is statutorily capped at Executive Schedule
// Level II, so BASE_PAY_2026 intentionally omits exact O-8..O-10 rows until the
// official figures are dropped in. The UI gives these grades a tailored
// manual-entry prompt instead of a wrong auto-populated number.
export const FLAG_OFFICER_GRADES = ['O-8', 'O-9', 'O-10'];

export const RETIREMENT_SYSTEMS = ['high3', 'brs', 'redux'];

// Gross monthly retirement pay under High-3 (2.5%/yr), BRS (2.0%/yr), or CSB/REDUX.
//
// CSB/REDUX applies to anyone who took the $30,000 Career Status Bonus at 15 years: the
// multiplier is 40% at 20 years and +3.5% for each year beyond, reaching the same 75% cap
// at 30 years. A 24-year REDUX retiree earns 54%, not the 60% a High-3 assumption produces —
// a permanent overstatement of roughly $600/mo on typical E-8/O-4 pay. REDUX also carries a
// reduced (CPI − 1%) COLA with a one-time catch-up at age 62; that is disclosed in the UI
// rather than modeled here, since this function returns the initial monthly figure only.
export function computeRetirementPay({ basePay, yos, system }) {
  const bp = Math.max(0, Number(basePay) || 0);
  const y = Math.max(0, Number(yos) || 0);
  let pct;
  let mult;
  if (system === 'redux') {
    mult = 0.035;
    // Below 20 years there is no REDUX retirement to compute; fall back to the High-3 ladder
    // so a mid-career "what if" still returns a sane number instead of a negative multiplier.
    pct = y >= 20 ? clamp(0.40 + 0.035 * (y - 20), 0.40, 0.75) : y * 0.025;
  } else {
    mult = system === 'brs' ? 0.02 : 0.025;
    pct = y * mult;
  }
  return { monthly: Math.round(bp * pct), mult, pct, system: system || 'high3' };
}

// ----- VA waiver / concurrent receipt, as ONE function -----
// A retiree who accepts VA compensation waives an equal amount of retired pay (38 U.S.C. 5305).
// CRDP restores it, but ONLY at 20+ years of service AND a 50%+ rating (10 U.S.C. 1414).
// Below that threshold, a rating is a tax-free SWAP, not new money — so `retiredPay + vaComp`
// overstates income by the full VA amount for every rating from 10% to 40%.
//
// The income table, bar chart, insight cards and full income summary all previously did that
// sum inline, each with its own `r >= 50` CRDP test that omitted the 20-year condition. They
// all route through here now so they cannot disagree with each other or with
// compareConcurrentReceipt.
export function applyVAWaiver({ grossRetiredPay = 0, vaComp = 0, yos = 0, rating = 0, isRetirement = true }) {
  const gross = Math.max(0, Number(grossRetiredPay) || 0);
  const va = Math.max(0, Number(vaComp) || 0);
  if (!isRetirement) {
    // A non-retiree draws no retired pay, so there is nothing to waive.
    return { crdpEligible: false, waived: 0, retiredPayAfterWaiver: 0, vaComp: va, total: va };
  }
  const crdpEligible = (Number(yos) || 0) >= 20 && (Number(rating) || 0) >= 50;
  const waived = crdpEligible ? 0 : Math.min(gross, va);
  const retiredPayAfterWaiver = gross - waived;
  return {
    crdpEligible,
    waived,
    retiredPayAfterWaiver,
    vaComp: va,
    total: retiredPayAfterWaiver + va,
  };
}

// Single source of truth for milestone urgency, shared by the card grid and the
// horizontal timeline so their colors always agree.
export function milestoneStatus(diffDays) {
  if (diffDays < 0) return 'past';
  if (diffDays === 0) return 'today';
  if (diffDays <= 30) return 'soon';
  return 'future';
}

// The full transition deadline engine: every milestone/deadline date the app surfaces,
// derived purely from the plan and today's date. Extracted from the inline script so
// it's unit-testable — this had zero test coverage despite being the app's core
// domain logic (every date on the milestone grid, the horizontal timeline, and the
// calendar comes from here). No DOM access; the caller renders the returned data.
//
// Returns { milestones, termStart, ptdyStart, ptdyEnd, sbStart, sbEnd, tapDeadline,
// firstRetPay } — the non-milestones fields are also consumed directly by the
// calendar and phase-checklist renderers.
export function computeMilestones(s, today, sep) {
  const isRet = s.transType === 'Retirement';

  const termStart = subDays(sep, s.leaveDays);
  const ptdyEnd = termStart;
  const ptdyStart = subDays(termStart, s.ptdyDays);
  const sbEnd = s.ptdy ? ptdyStart : termStart;
  const sbStart = subDays(sbEnd, s.sbDays);
  // 10 U.S.C. 1142(a)(3): pre-separation/TAP counseling must begin no later than 365
  // days before separation for ALL separations, not just retirement.
  const tapDeadline = subDays(sep, 365);
  const cmdApproval = s.sb ? subDays(sbStart, 60) : null;
  const firstRetPay = isRet ? firstOfNextMonth(sep) : null;
  // TRICARE's 90-day enrollment window OPENS at separation (a QLE) and runs forward —
  // it is not a pre-separation deadline. This applies to RETIREES, who remain eligible;
  // a non-retiring separatee's TRICARE ends at separation instead (see TAMP/CHCBP below).
  const tricareDeadline = addDays(sep, 90);

  const milestones = [];
  milestones.push({ label: 'Today', date: today, icon: 'calendar-check' });
  milestones.push({ label: 'TAP Must Begin By', date: tapDeadline, icon: 'book-open' });
  // VA will not accept a pre-discharge claim 12 months out: the Benefits Delivery at
  // Discharge window OPENS at 180 days and CLOSES at 90 days; inside 90 days you file a
  // standard claim instead. The old single "VA Claim Recommended By" milestone sat at
  // sep-365, so milestoneStatus() painted it 'past'/overdue for every user inside a year
  // — flagging a blown deadline that never existed. The 12-month item is real advice but
  // it is preparation, not a deadline, so it moves to `advisories` (below) where nothing
  // renders it as overdue.
  if (s.vaClaim) {
    milestones.push({ label: 'BDD Filing Window Opens (earliest VA accepts)', date: subDays(sep, 180), icon: 'file-text',
      description: 'Benefits Delivery at Discharge: the earliest VA will accept a pre-discharge claim. Filing at the open of this window is what buys you a pre-discharge exam and a decision near your discharge date.' });
  }
  if (s.sb && cmdApproval) milestones.push({ label: 'Commander Approval Needed', date: cmdApproval, icon: 'shield-check' });
  if (isRet) {
    milestones.push({ label: 'TRICARE Enrollment Window Closes', date: tricareDeadline, icon: 'heart-pulse',
      description: 'Retirement is a Qualifying Life Event: you have 90 days from your retirement date to enroll in a TRICARE retiree plan (Prime or Select).' });
  } else {
    // A separatee's TRICARE ends at 23:59 on the last day of active duty. TAMP (if eligible)
    // extends it 180 days. CHCBP is the buy-in bridge afterward and must be PURCHASED within
    // 60 days of losing TRICARE/TAMP — there is no late enrollment, which makes it the one
    // health deadline a separatee cannot recover from. Neither appeared anywhere in the app.
    milestones.push({ label: 'TAMP Coverage Ends (if eligible)', date: addDays(sep, 180), icon: 'heart-pulse',
      description: 'Transitional Assistance Management Program: 180 days of TRICARE after separation for eligible members (involuntary separation and certain other categories). Not everyone qualifies — verify with your personnel office.' });
    milestones.push({ label: 'CHCBP Purchase Deadline', date: addDays(sep, 240), icon: 'shield-alert',
      description: 'Continued Health Care Benefit Program must be PURCHASED within 60 days of losing TRICARE or TAMP coverage. This date assumes 180 days of TAMP; if you are NOT TAMP-eligible your deadline is 60 days after separation instead. There is no late enrollment.' });
  }
  if (s.sb) {
    milestones.push({ label: 'SkillBridge Start', date: sbStart, icon: 'briefcase' });
    milestones.push({ label: 'SkillBridge End', date: sbEnd, icon: 'check-circle' });
  }
  if (s.ptdy) {
    milestones.push({ label: 'Permissive TDY Start', date: ptdyStart, icon: 'map-pin' });
    milestones.push({ label: 'Permissive TDY End', date: ptdyEnd, icon: 'map-pin-off' });
  }
  milestones.push({ label: 'Terminal Leave Begins', date: termStart, icon: 'plane' });
  milestones.push({ label: `${s.transType} Date`, date: sep, icon: 'flag' });
  if (firstRetPay) milestones.push({ label: 'First Retirement Pay', date: firstRetPay, icon: 'dollar-sign' });

  // ----- Decision / benefit deadlines (retirement-depth expansion) -----
  if (s.vaClaim) milestones.push({ label: 'BDD Filing Window Closes', date: subDays(sep, 90), icon: 'file-clock',
    description: 'Last day to file under Benefits Delivery at Discharge. With 89 or fewer days left you can still file, but as a standard pre-discharge claim rather than BDD.' });
  // TEB requires the transfer be APPROVED while the member has fewer than 16 years of
  // total service and can commit to 4 more years — it is not available at separation
  // itself. Anchoring this to `sep` put the deadline AFTER the point of ineligibility,
  // which is backwards: the real deadline is the member's own 16-year mark, which for
  // anyone still eligible falls well before separation.
  if (s.giBill && s.yos < 16) {
    milestones.push({ label: 'GI Bill Transfer (TEB) — Approve Before 16 Years of Service',
      date: addDays(today, Math.round((16 - s.yos) * 365.25)), icon: 'graduation-cap',
      description: 'A Transfer of Education Benefits must be APPROVED while you have fewer than 16 years of total service, and it obligates 4 more years. This date is your projected 16-year mark.' });
  }
  // FEDVIP eligibility for uniformed-service members is limited to RETIREES and their
  // families — a non-retiring separatee is not eligible at all, so showing them a FEDVIP
  // deadline is an invitation to chase a benefit they cannot have.
  if (isRet) milestones.push({ label: 'FEDVIP Dental/Vision Enrollment Closes', date: addDays(sep, 60), icon: 'smile' });
  if (s.married || s.hasDependents) milestones.push({ label: 'FSGLI Spouse Conversion Deadline', date: addDays(sep, 120), icon: 'heart-handshake' });
  milestones.push({ label: 'VGLI: No Health Questions Deadline', date: addDays(sep, 240), icon: 'shield-plus' });
  milestones.push({ label: 'VGLI Final Application Deadline', date: addDays(sep, 485), icon: 'shield-alert' });
  milestones.push({ label: 'Military OneSource Eligibility Ends', date: addDays(sep, 365), icon: 'life-buoy' });
  // MIC3's post-service protection runs to the children of members who RETIRE or are
  // medically discharged, not to a voluntary separatee's household.
  if (isRet && (s.married || s.hasDependents)) milestones.push({ label: 'MIC3 School-Compact Protection Ends', date: addDays(sep, 365), icon: 'school' });
  if (s.clearance) milestones.push({ label: 'Clearance Reinstatement Window Closes', date: addDays(sep, 730), icon: 'lock' });
  if (isRet && firstRetPay) {
    const sbpOpen = new Date(firstRetPay.getFullYear(), firstRetPay.getMonth() + 25, 1);
    const sbpClose = new Date(firstRetPay.getFullYear(), firstRetPay.getMonth() + 36, 1);
    milestones.push({ label: 'SBP Withdrawal Window Opens', date: sbpOpen, icon: 'calendar-clock' });
    milestones.push({ label: 'SBP Withdrawal Window Closes', date: sbpClose, icon: 'calendar-x' });
  }
  if (isRet && s.vaClaim) {
    // DFAS runs CRDP/CRSC open season Jan 1-31 each year (not Dec-Jan).
    let osYear = today.getFullYear();
    if (today > new Date(osYear, 0, 31)) osYear += 1;
    milestones.push({ label: 'CRDP/CRSC Open Season (Jan 1–31)', date: new Date(osYear, 0, 1), icon: 'repeat' });
  }

  // Final move entitlements. These are two DIFFERENT constraints, not one: the 1-year
  // figure is the free-storage cap; the actual move/shipment deadline for retirees is
  // 3 years (extendable to 6) per MAP 68-24, effective for terminations on/after
  // June 24, 2022. Separatees get 180 days for shipment, no equivalent 3-year benefit.
  // Non-temporary storage at government expense is 1 year for RETIREES but only 180 days
  // for a non-retiring separatee. Telling a separatee they have a year is what leaves them
  // personally liable for the back half of it.
  milestones.push({ label: isRet ? 'HHG Free Storage Deadline (1 yr)' : 'HHG Free Storage Deadline (180 days)',
    date: addDays(sep, isRet ? 365 : 180), icon: 'archive' });
  milestones.push({ label: isRet ? 'Final Move / HHG Shipment Deadline (3 yrs)' : 'HHG Shipment Deadline (180 days)', date: isRet ? addDays(sep, 3 * 365) : addDays(sep, 180), icon: 'truck' });

  milestones.sort((a, b) => a.date - b.date);

  // Advisories are dated GUIDANCE, not deadlines. They are returned separately so the
  // milestone grid and horizontal timeline never run them through milestoneStatus() and
  // paint them red/overdue — the failure mode that made "VA Claim Recommended By" tell
  // every user inside 12 months that they had already missed something.
  const advisories = [];
  if (s.vaClaim) {
    advisories.push({
      label: 'Start gathering VA claim evidence',
      date: subDays(sep, 365),
      icon: 'folder-search',
      detail: 'About 12 months out: request your Service Treatment Records, line up DBQs and any nexus letters, and get every condition documented in your medical record while you still have military healthcare. VA will not accept the claim itself until 180 days before separation.',
    });
  }

  return { milestones, advisories, termStart, ptdyStart, ptdyEnd, sbStart, sbEnd, tapDeadline, firstRetPay };
}

// ===== SCENARIO COMPARISON =====
// "Should I go in March or September?" is the decision transitioning members agonize over
// most, and it is not a matter of taste: moving a separation date can cross a longevity step
// or a whole year of service, which changes the multiplier AND the High-3 average — while
// also costing (or paying) months of active-duty compensation. The app modelled exactly one
// plan, so there was no way to see the two sides against each other.
//
// Pure: give it a plan and it returns the figures that actually differ between dates.
export function summarizeScenario(s, today) {
  const sep = s.sepDate instanceof Date ? s.sepDate : new Date(String(s.sepDate) + 'T00:00:00');
  if (isNaN(sep.getTime())) return null;
  const grade = getRankGrade(s.rank);
  const isRet = s.transType === 'Retirement';
  const m = computeMilestones(s, today, sep);
  const high3 = computeHigh3({ grade, yos: s.yos, sepDate: sep, dateOfRank: s.dateOfRank || null });
  // Fall back to the current-year table when we can't build a High-3 (unknown grade, or a
  // hand-entered flag-officer figure), so a comparison still works rather than showing $0.
  const basePay = high3 ? high3.monthly : (getBasePay2026(grade, s.yos) ?? Number(s.payBasePay) ?? 0);
  const pay = isRet
    ? computeRetirementPay({ basePay, yos: s.yos, system: s.payRetSystem || 'high3' })
    : { monthly: 0, pct: 0, mult: 0, system: s.payRetSystem || 'high3' };

  return {
    sepDate: sep,
    yos: Number(s.yos) || 0,
    isRetirement: isRet,
    daysUntilSeparation: daysBetween(today, sep),
    high3Monthly: Math.round(basePay * 100) / 100,
    retiredPayMonthly: pay.monthly,
    retiredPayAnnual: pay.monthly * 12,
    multiplierPct: Math.round(pay.pct * 1000) / 10,
    terminalLeaveStart: m.termStart,
    skillbridgeStart: s.sb ? m.sbStart : null,
    tapDeadline: m.tapDeadline,
    firstRetirementPay: m.firstRetPay,
    high3Estimated: !high3 || high3.estimatedFromSingleYear,
  };
}

/**
 * @param {any} planA
 * @param {any} planB
 * @param {Date} today
 * @param {{monthlyAllowances?: number}} [opts] BAH + BAS, for valuing the extra time served
 */
export function compareScenarios(planA, planB, today, opts = {}) {
  const a = summarizeScenario(planA, today);
  const b = summarizeScenario(planB, today);
  if (!a || !b) return null;

  const extraDays = b.daysUntilSeparation - a.daysUntilSeparation;
  const extraMonths = extraDays / 30.44;
  const allowances = Math.max(0, Number(opts.monthlyAllowances) || 0);
  const monthlyDelta = b.retiredPayMonthly - a.retiredPayMonthly;

  // Pay earned during the extra time served (or forgone by leaving earlier). Base pay is
  // taxable and allowances are not, so they're reported separately rather than as one number
  // that quietly mixes pre- and post-tax dollars.
  const activeDutyBaseDelta = Math.round(b.high3Monthly * extraMonths);
  const activeDutyAllowanceDelta = Math.round(allowances * extraMonths);

  return {
    a,
    b,
    deltas: {
      days: extraDays,
      months: Math.round(extraMonths * 10) / 10,
      yos: b.yos - a.yos,
      high3Monthly: Math.round((b.high3Monthly - a.high3Monthly) * 100) / 100,
      multiplierPct: Math.round((b.multiplierPct - a.multiplierPct) * 10) / 10,
      retiredPayMonthly: monthlyDelta,
      retiredPayAnnual: monthlyDelta * 12,
      activeDutyBaseDelta,
      activeDutyAllowanceDelta,
      // Retired pay is for life, so a small monthly change compounds far past any one-off
      // difference in active-duty pay. 20 years is an illustrative horizon, NOT a
      // present-value calculation — no COLA, no discounting. The UI says so.
      retiredPayOver20Years: monthlyDelta * 12 * 20,
    },
  };
}

// ===== PHASE CHECKLIST =====
// The app's largest domain dataset — 7 phases, ~110 conditional tasks — previously lived
// inline in index.html where nothing could import it, nothing typechecked it, and no test
// asserted that task ids are unique or that migrateChecks' legacy ids still resolve to
// real tasks. Since checklist progress is keyed BY TASK ID, a duplicated or renamed id
// silently loses a user's ticked boxes.
//
// Pure: takes the plan plus the dates computeMilestones already derived, and returns
// { id, name, from, to, tasks: [{ id, text }] }. Date FORMATTING stays in the renderer —
// returning Date objects keeps this testable without a locale dependency.
/**
 * @param {any} s plan state
 * @param {{today: Date, sep: Date, termStart: Date, ptdyStart: Date, ptdyEnd: Date,
 *   sbStart: Date, sbEnd: Date, tapDeadline: Date}} dates
 * @returns {Array<{id: string, name: string, from: Date, to: Date,
 *   tasks: Array<{id: string, text: string}>}>}
 */
export function buildPhases(s, dates) {
  const { today, sep, termStart, ptdyStart, ptdyEnd, sbStart, sbEnd, tapDeadline } = dates;
  const isRet = s.transType === 'Retirement';
  const m18 = subDays(sep, 547);
  const tapMinus6 = subDays(tapDeadline, 180);
  const sbPrepStart = s.sb ? subDays(sbStart, 180) : subDays(sep, 365);
  const firstRetPay = isRet ? firstOfNextMonth(sep) : null;
  const hasFamily = s.married || s.hasDependents;
  // Tasks carry a STABLE id (not an array index) so saved progress survives insertion,
  // reordering, and conditional show/hide. Falsy entries are filtered so conditional
  // tasks read inline.
  const T = (id, text) => ({ id, text });
  const loc = s.postLocation ? ` (${s.postLocation})` : '';

  return [
    // The start is clamped to "today" so a phase already under way doesn't advertise a start
    // date in the past — but only while today is still INSIDE the window. Clamping
    // unconditionally printed an inverted range ("Aug 2, 26 — Jun 3, 26") for anyone whose
    // Phase 1 window had already closed.
    { id: 'p1', name: 'Phase 1: Foundation',
      from: (today > m18 && today <= subDays(tapMinus6, 1)) ? today : m18,
      to: subDays(tapMinus6, 1),
      tasks: [
        T('finance-plan','Create/update financial plan and emergency fund'),
        T('tsp-review','Review TSP allocations and contributions'),
        T('service-records','Collect and organize all service records'),
        T('ompf-download','Download your full OMPF/personnel file to encrypted storage while you still have CAC and network access'),
        T('records-vault','Start a secure, encrypted "records vault" (DD-214, OMPF, service treatment records, evaluations, award & retirement orders)'),
        T('linkedin','Create or update LinkedIn profile'),
        T('va-gov-account','Set up and identity-verify your VA.gov account (Login.gov or ID.me) — the gateway to VA benefits'),
        T('va-doc','Begin VA disability documentation — gather medical records'),
        T('va-intent-to-file','File a VA Intent to File (VA Form 21-0966) to lock your earliest effective date; complete the full claim within 1 year'),
        s.giBill ? T('teb','Submit and get APPROVAL of your Post-9/11 GI Bill transfer (TEB) in milConnect — it must be approved before 16 years of service and cannot be done after you retire') : null,
        T('housing-research','Research housing options in target location' + loc),
        T('domicile','Confirm or change your state of legal residence (DD Form 2058) — SCRA/MSRRA tax protection ends at retirement'),
        T('estate-docs','Update will, power of attorney, and advance directive'),
        T('sgli-review','Review SGLI beneficiary designations'),
        T('budget','Build a detailed post-transition budget'),
        T('mypay-access','Verify myPay account access and settings'),
        s.payRetSystem === 'brs' ? T('tsp-vesting','Verify your TSP Service Computation Date and that agency Automatic 1% contributions are vested') : null,
        s.payRetSystem === 'redux' ? T('redux-cola','CSB/REDUX: plan for the reduced COLA (CPI − 1%) and the one-time catch-up at age 62 — your pay loses ground to inflation until then') : null,
        hasFamily ? T('deers-students','Update DEERS full-time-student status for children ages 21–23 (DD Form 1172-2 + registrar letter)') : null,
      ].filter(Boolean) },
    { id: 'p2', name: 'Phase 2: TAP & Benefits', from: tapMinus6, to: tapDeadline,
      tasks: [
        T('tap-register','Register for Transition Assistance Program (TAP)'),
        T('tap-core','Complete 5-day TAP core curriculum'),
        T('itp','Complete Individual Transition Plan (ITP)'),
        T('tap-track','Choose TAP track: Employment / Education / Entrepreneurship'),
        T('capstone','Complete Capstone requirements'),
        T('va-claim', s.vaClaim ? 'File VA disability claim — the BDD window opens 180 days out and closes at 90 days' : 'Research VA disability claim process'),
        s.vaClaim ? T('vso','Appoint a free VA-accredited VSO (VA Form 21-22); verify at va.gov/ogc — avoid paid claim consultants') : null,
        T('tricare-research','Research TRICARE options for post-transition healthcare'),
        !isRet ? T('chcbp-research','Research CHCBP — you must PURCHASE it within 60 days of losing TRICARE/TAMP, and there is no late enrollment') : null,
        T('career-fields','Identify target career fields and required certifications'),
        T('cred-assist','Use your branch Credentialing Assistance / COOL to earn civilian certifications while it is still free'),
        T('hiring-events','Attend veteran hiring events and career fairs'),
        T('record-review','Conduct a personnel record review — confirm every award, badge, and evaluation is recorded before it reaches your DD-214'),
        T('training-records','Request copies of training records and evaluations'),
        s.married ? T('spouse-seco','Connect your spouse to SECO/SpouseWorks and apply for MyCAA before retirement ends eligibility') : null,
        s.married ? T('spouse-tap','Have your spouse attend TAP classes and the online VA Benefits course') : null,
      ].filter(Boolean) },
    s.sb
      ? { id: 'p3', name: 'Phase 3: SkillBridge Prep', from: sbPrepStart, to: subDays(sbStart, 1),
          tasks: [
            T('sb-research','Research SkillBridge employers at skillbridge.osd.mil'),
            T('sb-top3','Identify top 3 SkillBridge program choices'),
            T('sb-cmd-pkg','Submit commander approval package (60+ days before start)'),
            T('sb-memo','Get SkillBridge approval memo signed'),
            T('resume','Finalize and tailor civilian resume'),
            T('linkedin-optimize','Optimize LinkedIn — headline, summary, keywords'),
            T('cp-exam','Schedule C&P exams for VA disability (if applicable)'),
            T('edu-research', s.giBill ? 'Research GI Bill benefits and eligible programs' : 'Research education benefits options'),
            T('cert-research','Research professional certifications in target field'),
            T('sb-network','Network with SkillBridge alumni in your career field'),
            s.vaClaim ? T('vre','Research and apply for VR&E (Chapter 31, VA Form 28-1900) — separate from the GI Bill') : null,
            s.federalJob ? T('vow-cert',"Request a VOW Act certification of expected discharge to claim Veterans' Preference before your DD-214") : null,
            s.federalJob ? T('fed-packet','Assemble your federal-hiring packet — SF-15, VA rating letter, DD-214; identify your path (VEOA, VRA, 30%, Schedule A)') : null,
            s.vaClaim ? T('fdc-evidence','Prepare an FDC-style evidence package — completed DBQs and, where causation is contested, a nexus letter') : null,
          ].filter(Boolean) }
      : { id: 'p3', name: 'Phase 3: Job Search & Networking', from: sbPrepStart, to: subDays(s.ptdy ? ptdyStart : termStart, 1),
          tasks: [
            T('resume','Finalize and tailor civilian resume for target roles'),
            T('linkedin-optimize','Optimize LinkedIn profile for civilian job search'),
            T('job-apps','Begin submitting job applications'),
            T('info-interviews','Conduct informational interviews in target industry'),
            T('job-fairs','Attend veteran-specific job fairs and networking events'),
            T('cert-research','Research professional certifications in target field'),
            T('edu-research', s.giBill ? 'Research GI Bill benefits and school options' : 'Research continuing education options'),
            T('cp-exam','Schedule C&P exams for VA disability (if applicable)'),
            T('build-network','Build professional network in target location'),
            T('mock-interview','Practice interviewing — use ACP or Hire Heroes USA mock interviews'),
            s.vaClaim ? T('vre','Research and apply for VR&E (Chapter 31, VA Form 28-1900) — separate from the GI Bill') : null,
            s.federalJob ? T('vow-cert','Request a VOW Act certification of expected discharge to claim Veterans’ Preference before your DD-214') : null,
            s.federalJob ? T('fed-packet','Assemble your federal-hiring packet — SF-15, VA rating letter, DD-214; identify your path (VEOA, VRA, 30%, Schedule A)') : null,
            s.vaClaim ? T('fdc-evidence','Prepare an FDC-style evidence package — completed DBQs and, where causation is contested, a nexus letter') : null,
          ].filter(Boolean) },
    { id: 'p4', name: s.sb ? 'Phase 4: SkillBridge & Active Prep' : 'Phase 4: Final Active Duty Prep',
      from: s.sb ? sbStart : subDays(s.ptdy ? ptdyStart : termStart, 180),
      to: s.sb ? sbEnd : subDays(s.ptdy ? ptdyStart : termStart, 1),
      tasks: [
        T('sb-or-apps', s.sb ? 'Begin SkillBridge program — treat it like your first civilian job' : 'Continue civilian job applications and interviews'),
        T('ref-letters','Request reference/recommendation letters from leadership'),
        T('pre-ret-brief','Complete pre-retirement briefing (if retiring)'),
        isRet ? T('dfas-setup','Confirm DFAS retirement pay setup') : null,
        isRet ? T('tricare-enroll','Enroll in TRICARE retiree plan (90-day window from your retirement date)') : null,
        isRet ? T('fedvip','Enroll in FEDVIP dental and vision via BENEFEDS before your retirement date (TRDP no longer exists; window closes 60 days after retirement)') : null,
        !isRet ? T('tamp-check','Confirm whether you are TAMP-eligible (180 days of TRICARE after separation) — it is not automatic for every separation') : null,
        T('retiree-id','Register for retired/veteran ID card'),
        T('shpe','Complete your Separation History & Physical Exam (DD 2807-1 + DD 2808) and document every condition you intend to claim'),
        T('eye-exam','Complete any needed eye exam and order glasses/contacts before separation (routine vision is covered by FEDVIP, not TRICARE)'),
        T('va-healthcare','Apply for VA health care enrollment (VA Form 10-10EZ) — separate from your disability claim'),
        isRet ? T('sbp-election','Complete your SBP election on DD Form 2656; if declining or reducing, obtain your spouse’s notarized concurrence') : null,
        T('va-home-loan','Research VA home loan eligibility and pre-approval'),
        T('tsp-final-max','Maximize your final TSP payroll contributions and capture remaining agency match before final pay'),
        s.federalJob ? T('ethics','Obtain an ethics opinion (18 U.S.C. 207) before accepting a contractor offer or launching a venture') : null,
        T('resume-update','Update resume with SkillBridge experience (if applicable)'),
      ].filter(Boolean) },
    { id: 'p5', name: 'Phase 5: Out-Processing' + (s.ptdy ? ' & PTDY' : ''),
      from: s.ptdy ? ptdyStart : subDays(termStart, 14), to: s.ptdy ? ptdyEnd : termStart,
      tasks: [
        T('outprocess-start','Begin formal out-processing checklist'),
        T('hhg-schedule','Schedule your final HHG shipment and non-temporary storage before the orders-based deadline'),
        T('return-equipment','Return all government equipment and property'),
        T('clear-agencies','Clear all base agencies (finance, housing, medical, etc.)'),
        T('ptdy-hunt','Complete house/job hunting during PTDY (if applicable)'),
        T('str-download','Download your own certified copy of your full Service Treatment Records (medical + dental) before portal access ends'),
        T('dd93','Verify and update DD Form 93 (death gratuity + emergency notification) before clearing personnel'),
        s.clearance ? T('diss-record','Document your DISS clearance record and investigation type/date before clearing the security office') : null,
        T('dd214-pickup','Pick up DD-214 on final out-processing day'),
        T('dd214-review','Review DD-214 carefully for accuracy and errors'),
        T('dd214-register','Register DD-214 with local county clerk'),
        isRet ? T('retiree-id-appt','Book your retiree ID (USID) appointment for the day AFTER your retirement date; confirm DEERS shows "Retired" before enrolling in TRICARE') : null,
        T('final-pay','Confirm final leave and pay settlement'),
        T('final-les','Save your final LES and retirement points / service-computation records before active myPay access ends'),
        T('transfer-medical','Transfer medical records to VA'),
        T('confirm-orders','Confirm retirement/separation orders are correct'),
        s.oconus ? T('pov-return','Book government return shipment of one POV and sign DD Form 788 within the 1-year window') : null,
      ].filter(Boolean) },
    { id: 'p6', name: 'Phase 6: Terminal Leave & Freedom', from: termStart, to: sep,
      tasks: [
        T('job-final','Continue job search or accept final offer before separation'),
        isRet ? T('tricare-activate','Activate TRICARE post-service coverage') : T('chcbp-purchase','If you need CHCBP, PURCHASE it within 60 days of TRICARE/TAMP ending — there is no late enrollment'),
        T('first-pay-confirm','Confirm first retirement pay date and amount (if retiring)'),
        T('civilian-beneficiaries','Update all beneficiary designations for civilian accounts'),
        T('state-benefits','Apply for state veteran benefits in ' + (s.postLocation || 'your new state')),
        T('va-tracking','Open VA.gov claim tracking — monitor status'),
        T('civilian-healthcare','Set up civilian healthcare if not using TRICARE'),
        T('final-pcs','Complete final PCS move (if applicable)'),
        T('dl-vehicle','Update driver\'s license and vehicle registration'),
        T('dl-veteran-designation','Request the veteran designation on your driver\'s license / REAL ID (bring DD-214 Member-4)'),
        T('routine','Build a written daily routine and join a VSO or veteran community group within your first 30 days'),
        T('celebrate','Celebrate your service and transition! 🎉'),
      ].filter(Boolean) },
    isRet
      ? { id: 'p7', name: 'Phase 7: First-Year Post-Retirement', from: firstRetPay, to: addDays(sep, 365),
          tasks: [
            T('w4p','Submit Form W-4P in myPay for federal withholding and elect state withholding (DFAS defaults to single/no adjustments and withholds NO state tax)'),
            T('retired-pay-verify','Verify your retired pay setup in myPay within 30 days — direct deposit, address, and SBP/allotments'),
            T('beneficiary-audit','Run a beneficiary audit — DD 2894 (Arrears of Pay), TSP-3, SGLV/VGLI, IRA/401k, bank POD, brokerage TOD — confirm all match your will'),
            T('vgli','Apply for VGLI to replace SGLI (no health questions if within 240 days of separation)'),
            T('tsp3','Update your TSP beneficiary (Form TSP-3) — it overrides your will and divorce decree'),
            T('address-everywhere','Update your address in every system separately — DFAS retired pay (myPay) is NOT linked to DEERS, TRICARE, VA, IRS, banks, or TSP'),
            (s.vaClaim && hasFamily) ? T('dependency-claim','File VA Form 21-686c to add dependents within 1 year of a 30%+ rating to capture retroactive pay') : null,
            s.vaClaim ? T('crsc','If rated 50%+ with combat-related disabilities, apply for CRSC via DD Form 2860 (separate from automatic CRDP)') : null,
            T('solid-start','Update your contact info in VA.gov and expect VA Solid Start calls at about 90, 180, and 365 days'),
            T('mil-onesource','Use Military OneSource non-medical counseling for yourself, spouse, and kids before the 365-day eligibility cutoff'),
            T('crisis-line','Save the Veterans/Military Crisis Line (988 then 1) and locate your nearest Vet Center (1-877-927-8387)'),
            T('travel-voucher','File your final-move travel voucher (DD 1351-2 / SmartVoucher); file a separate voucher for separately-traveling dependents'),
            T('pet-reimburse','Claim PCS pet relocation reimbursement (one pet: $550 CONUS / $2,000 OCONUS) if you moved a pet on orders'),
            (s.vaClaim && s.homeowner) ? T('property-tax','Apply for your state’s disabled-veteran property tax exemption as soon as your VA rating posts (watch county filing deadlines)') : null,
            T('ras-reconcile','Each January/February, reconcile your Retiree Account Statement (RAS) against your IRS 1099-R'),
            T('bcmr','File DD Form 149 with your service’s Board for Correction of Military Records for any record error a DD-215 can’t fix (3-year clock)'),
          ].filter(Boolean) }
      : null,
  ].filter(Boolean);
}

// Legacy checklist keys were array indices ("p1-0"). They are now stable task ids. This maps
// the old per-phase order (accounting for the SkillBridge variant of p3) onto the new ids so
// a returning user keeps their progress. Exported so a test can assert every legacy id still
// resolves to a task that actually exists.
export function legacyTaskIds(s) {
  return {
    p1: ['finance-plan','tsp-review','service-records','linkedin','va-doc','housing-research','estate-docs','sgli-review','budget','mypay-access'],
    p2: ['tap-register','tap-core','itp','tap-track','capstone','va-claim','tricare-research','career-fields','hiring-events','training-records'],
    p3: s.sb
      ? ['sb-research','sb-top3','sb-cmd-pkg','sb-memo','resume','linkedin-optimize','cp-exam','edu-research','cert-research','sb-network']
      : ['resume','linkedin-optimize','job-apps','info-interviews','job-fairs','cert-research','edu-research','cp-exam','build-network','mock-interview'],
    p4: ['sb-or-apps','ref-letters','pre-ret-brief','dfas-setup','tricare-enroll','retiree-id','shpe','sbp-election','va-home-loan','resume-update'],
    p5: ['outprocess-start','return-equipment','clear-agencies','ptdy-hunt','dd214-pickup','dd214-review','dd214-register','final-pay','transfer-medical','confirm-orders'],
    p6: ['job-final','tricare-activate','first-pay-confirm','civilian-beneficiaries','state-benefits','va-tracking','civilian-healthcare','final-pcs','dl-vehicle','celebrate'],
  };
}

export function migrateChecks(checks, s) {
  if (!checks || typeof checks !== 'object') return {};
  if (!Object.keys(checks).some((k) => /^p\d+-\d+$/.test(k))) return checks; // already stable ids
  const map = legacyTaskIds(s);
  const out = {};
  for (const [k, v] of Object.entries(checks)) {
    const m = k.match(/^(p\d+)-(\d+)$/);
    if (m && map[m[1]] && map[m[1]][+m[2]]) out[map[m[1]][+m[2]]] = v;
    else out[k] = v;
  }
  return out;
}

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
    // A LONE \r survived the pattern above and would end a content line early in any parser
    // that splits on CR. That now matters: the subscribable feed serves a user-supplied
    // firstName (in X-WR-CALNAME) to third-party calendar clients, so a stray control
    // character is no longer confined to a file the author downloaded themselves.
    .replace(/[\r --]/g, '');
}

// IMPORTANT: build YYYYMMDD from LOCAL date parts. Milestone dates are created
// as local midnight (new Date(str + 'T00:00:00')), so toISOString() would shift
// the day across a timezone boundary.
function icsDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function icsStamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// Stable, content-derived slug for the event UID.
function icsSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'milestone';
}

// RFC 5545 § 3.1: content lines are limited to 75 OCTETS, folded with CRLF followed by a
// single space. Long DESCRIPTION/SUMMARY values previously emitted one unfolded line, which
// is spec-invalid (tolerated by most clients today, but not something to rely on).
const icsEncoder = new TextEncoder();
function icsFold(line) {
  if (icsEncoder.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let curBytes = 0;
  let budget = 75; // continuation lines spend one octet on the leading space
  // Iterate by code point so a surrogate pair is never split across a fold.
  for (const ch of line) {
    const b = icsEncoder.encode(ch).length;
    if (curBytes + b > budget) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
      budget = 74;
    }
    cur += ch;
    curBytes += b;
  }
  if (cur) parts.push(cur);
  return parts.join('\r\n ');
}

// RFC 5545 calendar with one all-day VEVENT per milestone.
export function buildICS(milestones, opts = {}) {
  const prodId = opts.prodId || '-//Military Transition Calculator//EN';
  const calName = opts.calName || 'Transition Plan';
  const stamp = icsStamp(opts.now instanceof Date ? opts.now : new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(calName)}`,
  ];
  (milestones || []).forEach((m) => {
    const start = m.date;
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    lines.push('BEGIN:VEVENT');
    // UID is derived from the event's DATE + LABEL, never its array index. With an index,
    // toggling any plan flag (SkillBridge, VA claim, …) renumbered every later milestone,
    // so re-importing the .ics overwrote the WRONG existing calendar events.
    lines.push(`UID:mtc-${icsDate(start)}-${icsSlug(m.label)}@military-transition-calc`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(end)}`);
    lines.push(`SUMMARY:${icsEscape(m.label)}`);
    if (m.description) lines.push(`DESCRIPTION:${icsEscape(m.description)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n');
}

// Compact, URL-safe encoding of a plan.
//
// DEAD as of the capability-URL migration: sharing is now `/p/<id>` + `#k=<key>`, and
// nothing in the app calls these — their only remaining callers are their own tests.
// Kept (rather than deleted) because the JSON backup/import feature is the natural place
// they'd be needed again, and they are the one correct implementation of the
// encodeURIComponent-before-btoa dance that keeps accented names and emoji from throwing
// the Latin-1 exception. If a future change doesn't use them, delete both and their test.
export function encodeState(obj) {
  const b64 = btoa(encodeURIComponent(JSON.stringify(obj)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeState(str) {
  try {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const obj = JSON.parse(decodeURIComponent(atob(s)));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

// ===== DECISION-AID CALCULATORS (added for the retirement-depth expansion) =====
// All pure: given inputs, return numbers/flags. The UI owns formatting + disclaimers.
// Figures are fact-checked as of 2026 against DFAS / VA / TRICARE / TSP sources.

// --- Survivor Benefit Plan (SBP) ---
// Spouse premium is 6.5% of the elected base amount; survivor annuity is 55% of
// the base amount; coverage is "paid-up" only after 360 payments AND age 70.
export const SBP_PARAMS = { premiumRate: 0.065, annuityRate: 0.55, paidUpPayments: 360, paidUpAge: 70 };

export function computeSBP({ baseAmount, retireeAge = 45, spouseAge = null, hasChildren = false }) {
  baseAmount = Math.max(0, Number(baseAmount) || 0);
  retireeAge = Number(retireeAge) || 0;
  const monthlyPremium = baseAmount * SBP_PARAMS.premiumRate;
  const survivorMonthly = baseAmount * SBP_PARAMS.annuityRate;
  // Premiums stop at the later of 360 payments or reaching age 70.
  const paymentsByAge = Math.round(Math.max(0, SBP_PARAMS.paidUpAge - retireeAge) * 12);
  const paidUpPayments = Math.max(SBP_PARAMS.paidUpPayments, paymentsByAge);
  const totalPremiums = monthlyPremium * paidUpPayments;
  const breakEvenMonths = survivorMonthly > 0 ? Math.ceil(totalPremiums / survivorMonthly) : 0;
  return {
    monthlyPremium, annualPremium: monthlyPremium * 12,
    survivorMonthly, survivorAnnual: survivorMonthly * 12,
    paidUpPayments, totalPremiums,
    breakEvenMonths, breakEvenYears: +(breakEvenMonths / 12).toFixed(1),
    hasChildren: !!hasChildren, spouseAge,
  };
}

// --- CRDP vs CRSC (concurrent receipt) ---
// VA compensation offsets retired pay dollar-for-dollar (the "VA waiver"). CRDP
// (auto at 20yr + 50%+, TAXABLE) restores the full waiver; CRSC (combat-related,
// TAX-FREE, requires DD 2860) restores the combat-related portion of the waiver.
export function compareConcurrentReceipt({ grossRetiredPay, vaRating = 0, combatRelatedPct = 0, marginalRate = 0.22, yos = 20 }) {
  grossRetiredPay = Math.max(0, Number(grossRetiredPay) || 0);
  const vaComp = VA_RATES[vaRating] || 0;
  const waived = Math.min(grossRetiredPay, vaComp);
  const residualRetired = grossRetiredPay - waived;
  combatRelatedPct = clamp(Number(combatRelatedPct) || 0, 0, 100);
  marginalRate = clamp(Number(marginalRate) || 0, 0, 0.5);
  const crdpEligible = (Number(yos) >= 20) && (Number(vaRating) >= 50);
  // Net (after-tax) take-home under each path. VA comp is always tax-free.
  const baselineNet = residualRetired * (1 - marginalRate) + vaComp;
  const crdpNet = grossRetiredPay * (1 - marginalRate) + vaComp; // full retired pay restored (taxable)
  const crscAmount = waived * (combatRelatedPct / 100);          // tax-free
  const crscNet = residualRetired * (1 - marginalRate) + vaComp + crscAmount;
  const candidates = [{ key: 'baseline', net: baselineNet }];
  if (crdpEligible) candidates.push({ key: 'crdp', net: crdpNet });
  if (crscAmount > 0) candidates.push({ key: 'crsc', net: crscNet });
  candidates.sort((a, b) => b.net - a.net);
  return {
    vaComp, waived, residualRetired, crdpEligible,
    baselineNet, crdpNet, crscAmount, crscNet,
    recommend: candidates[0].key,
  };
}

// --- TRICARE retiree fees (CY2026) + healthcare cost estimate ---
export const TRICARE_FEES_2026 = {
  select: {
    groupA: { individual: 186.96, family: 375 },
    groupB: { individual: 594.96, family: 1191 },
  },
  note: 'CY2026 TRICARE Select retiree annual enrollment fees. Medically retired members/families and survivors of active-duty sponsors (Group A) pay $0. Group A = sponsor initial enlistment or appointment before Jan 1, 2018; Group B = on/after that date.',
};

export function estimateRetireeHealthcareCost({ group = 'A', coverage = 'family', annualRx = 0, fedvipMonthly = 0 }) {
  const g = group === 'B' ? 'groupB' : 'groupA';
  const cov = coverage === 'individual' ? 'individual' : 'family';
  const enrollmentFee = TRICARE_FEES_2026.select[g][cov];
  annualRx = Math.max(0, Number(annualRx) || 0);
  const annualFedvip = Math.max(0, (Number(fedvipMonthly) || 0) * 12);
  const totalAnnual = enrollmentFee + annualRx + annualFedvip;
  return { enrollmentFee, annualRx, annualFedvip, totalAnnual, monthlyEquivalent: totalAnnual / 12 };
}

// --- TRICARE Prime vs Select decision aid (qualitative scoring) ---
export function compareTricarePrimeSelect({ expectedVisits = 'low', valuesLowCost = true, needsFlexibility = false }) {
  let prime = 0, select = 0;
  if (valuesLowCost) prime += 2;
  if (needsFlexibility) select += 2;
  if (expectedVisits === 'high') prime += 1;       // predictable copays favor Prime
  else if (expectedVisits === 'low') select += 1;  // light users avoid Prime's PCM friction
  const recommendation = prime === select ? 'either' : (prime > select ? 'prime' : 'select');
  return {
    recommendation,
    primePros: ['Lowest out-of-pocket costs', 'Predictable copays', 'Care coordinated by a Primary Care Manager'],
    primeCons: ['Must use a PCM and get referrals for specialists', 'Less provider choice', 'Only where Prime is offered'],
    selectPros: ['See any TRICARE-authorized provider', 'No referrals needed', 'Available everywhere'],
    selectCons: ['Higher cost-shares and deductibles', 'Annual enrollment fee for retirees (Group A & B)'],
  };
}

// --- Best state of residence (domicile) tax comparison ---
// Reuses STATE_TAX_DATA. topRate is the state's TOP marginal rate; a military pension
// sits well below the top bracket in graduated states, so the raw top rate badly
// overstates the real liability. Damp it toward an effective rate (~0.55x) — 'partial'
// exemptions further halve it on top of that (real exemptions vary widely by state).
// This is the single source of truth for the state-tax estimate: both the "State Tax
// Impact" panel and the "Best State of Residence" comparison tool call this function,
// so the two never disagree with each other on the same numbers.
const STATE_TAX_EFFECTIVE_FACTOR = 0.55;
export function estimateStateTaxOnRetiredPay(code, annualRetiredPay) {
  const d = STATE_TAX_DATA[code];
  if (!d) return null;
  annualRetiredPay = Math.max(0, Number(annualRetiredPay) || 0);
  let estAnnualTax = 0;
  let note = d.note;
  if (d.militaryRetirementTax === 'exempt') {
    estAnnualTax = 0;
    note = 'Fully exempt';
  } else if (d.militaryRetirementTax === 'taxed') {
    estAnnualTax = annualRetiredPay * (d.topRate / 100) * STATE_TAX_EFFECTIVE_FACTOR;
    note = `Approx. ~$${Math.round(estAnnualTax).toLocaleString('en-US')}/yr (effective estimate; ${d.topRate}% top marginal rate — your actual rate is lower in graduated brackets)`;
  } else {
    // partial — effective-rate estimate, further halved for the partial exemption
    estAnnualTax = annualRetiredPay * (d.topRate / 100) * STATE_TAX_EFFECTIVE_FACTOR * 0.5;
    note = `Partial exemption — approx. ~$${Math.round(estAnnualTax).toLocaleString('en-US')}/yr (varies by age/income)`;
  }
  return {
    code, name: d.name, status: d.militaryRetirementTax, topRate: d.topRate,
    note: annualRetiredPay > 0 ? note : d.note,
    estAnnualTax: Math.round(estAnnualTax),
  };
}

// --- 180-day meter classification ---
// There is no single DoD rule capping "SkillBridge + PTDY + terminal leave" combined
// at 180 days — see the caller for the full explanation. This is a faithful proxy for
// "how many days before separation does SkillBridge start" (DoDI 1322.29's actual
// 180-day rule) ONLY when SkillBridge is in use; with it off, no combined cap applies
// at all. Pure classification logic, split out from the DOM-writing renderer so the
// three threshold boundaries (0/150/180) are covered by tests instead of only ever
// being exercised by manually adjusting sliders in the browser.
export function classifyDayMeter(totalDays, sbActive) {
  const pct = Math.min((totalDays / 180) * 100, 100);
  if (!sbActive) {
    return { level: 'none', pct, icon: 'info', title: `${totalDays} days planned`,
      detail: "No combined-day cap applies here since SkillBridge isn't in use — PTDY and terminal leave are each governed by their own, separate limits." };
  }
  if (totalDays > 180) {
    return { level: 'danger', pct, icon: 'alert-triangle', title: "Exceeds SkillBridge's window",
      detail: `${totalDays} days planned before separation — SkillBridge (DoDI 1322.29) may not start more than 180 days out. Reduce your leave plan.` };
  }
  if (totalDays > 150) {
    return { level: 'warning', pct, icon: 'info', title: 'Approaching the limit',
      detail: `Your SkillBridge start is ${totalDays} days before separation (${180 - totalDays} of the 180-day window remaining).` };
  }
  return { level: 'success', pct, icon: 'check-circle', title: 'Within limits',
    detail: `Your SkillBridge start is ${totalDays} days before separation, within the 180-day window DoDI 1322.29 allows.` };
}

export function compareStates(codes, annualRetiredPay) {
  return (codes || [])
    .map(c => estimateStateTaxOnRetiredPay(c, annualRetiredPay))
    .filter(Boolean)
    .sort((a, b) => a.estAnnualTax - b.estAnnualTax);
}

// State tax on ORDINARY WAGES. The military-retirement exemptions in STATE_TAX_DATA do not
// apply to a civilian paycheck, so this deliberately ignores `militaryRetirementTax` and uses
// only the damped effective rate.
function estimateStateTaxOnWages(code, annualWages) {
  const d = STATE_TAX_DATA[code];
  if (!d) return 0;
  return Math.max(0, Number(annualWages) || 0) * (d.topRate / 100) * STATE_TAX_EFFECTIVE_FACTOR;
}

// ===== FEDERAL TAX (2026) =====
// Rev. Proc. 2025-32 / OBBBA-adjusted 2026 parameters. Thresholds are TAXABLE income (after
// the standard deduction). Kept as data, with the vintage in DATA_VINTAGE, so the annual
// refresh is a table swap rather than a hunt through formulas.
export const FEDERAL_TAX_2026 = {
  standardDeduction: { single: 16100, joint: 32200 },
  brackets: {
    single: [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37]],
    joint:  [[0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]],
  },
};

// FICA. The Social Security half stops at the annual wage base; this applies the combined
// 7.65% with no cap, which is exact for the salary range this tool is used at and slightly
// conservative (overstates tax) above the wage base. Retired pay is NOT subject to FICA.
export const FICA_RATE = 0.0765;

export function federalIncomeTax(taxableIncome, filing = 'single') {
  const brackets = FEDERAL_TAX_2026.brackets[filing === 'joint' ? 'joint' : 'single'];
  let income = Math.max(0, Number(taxableIncome) || 0);
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [floor, rate] = brackets[i];
    const ceiling = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    if (income <= floor) break;
    tax += (Math.min(income, ceiling) - floor) * rate;
  }
  return tax;
}

// --- "What civilian salary do I need to break even?" ---
// The single most-asked question in TAP employment counseling, and the one number this app
// had every input for but never joined up. Military compensation is deceptively high because
// BAH and BAS are federal-tax-free and healthcare is nearly free; a naive "my base pay is
// $90k so I need $90k" comparison understates the civilian salary required, often badly.
//
// Model, stated explicitly rather than buried:
//   military net  = base pay − federal − FICA − state + BAH + BAS   (BAH/BAS untaxed)
//   civilian net  = salary + retired pay − federal − FICA(salary only) − state − healthcare
// and we solve for the salary that makes the two equal. Retired pay is included because it
// continues after transition and therefore reduces the salary needed.
//
// An employer 401(k) match is reported SEPARATELY and never folded into take-home: it is
// deferred compensation, not money in this month's budget.
/**
 * @param {{basePay?: number, bah?: number, bas?: number, retiredPayMonthly?: number,
 *   filing?: string, stateCode?: string|null, civilianHealthcareMonthly?: number,
 *   retireeHealthcareAnnual?: number, employer401kMatchPct?: number}} [opts]
 */
export function requiredCivilianSalary({
  basePay = 0,
  bah = 0,
  bas = 0,
  retiredPayMonthly = 0,
  filing = 'single',
  /** @type {string|null} */
  stateCode = null,
  civilianHealthcareMonthly = 0,
  retireeHealthcareAnnual = 0,
  employer401kMatchPct = 0,
} = {}) {
  const monthly = (v) => Math.max(0, Number(v) || 0);
  const baseAnnual = monthly(basePay) * 12;
  const allowancesAnnual = (monthly(bah) + monthly(bas)) * 12;
  const retiredAnnual = monthly(retiredPayMonthly) * 12;
  const filingKey = filing === 'joint' ? 'joint' : 'single';
  const stdDeduction = FEDERAL_TAX_2026.standardDeduction[filingKey];
  const healthcareAnnual = monthly(civilianHealthcareMonthly) * 12 + Math.max(0, Number(retireeHealthcareAnnual) || 0);

  // --- Current military take-home ---
  const milFederal = federalIncomeTax(Math.max(0, baseAnnual - stdDeduction), filingKey);
  const milFica = baseAnnual * FICA_RATE;
  const milState = estimateStateTaxOnWages(stateCode, baseAnnual);
  const militaryNetAnnual = baseAnnual - milFederal - milFica - milState + allowancesAnnual;

  // --- Civilian take-home for a given gross salary ---
  const retiredStateTax = (() => {
    const r = estimateStateTaxOnRetiredPay(stateCode, retiredAnnual);
    return r ? r.estAnnualTax : 0;
  })();
  const civilianNetFor = (salary) => {
    const federal = federalIncomeTax(Math.max(0, salary + retiredAnnual - stdDeduction), filingKey);
    const fica = salary * FICA_RATE; // retired pay is not FICA-taxed
    const state = estimateStateTaxOnWages(stateCode, salary) + retiredStateTax;
    return salary + retiredAnnual - federal - fica - state - healthcareAnnual;
  };

  // Bisection. civilianNetFor is continuous and strictly increasing in salary, so this
  // converges to the cent well inside the iteration budget — and unlike a closed-form
  // inversion it stays correct if the bracket table changes shape.
  let lo = 0;
  let hi = 1_000_000;
  if (civilianNetFor(hi) < militaryNetAnnual) {
    return {
      requiredSalary: null,
      unreachable: true,
      militaryNetAnnual: Math.round(militaryNetAnnual),
      militaryMonthlyNet: Math.round(militaryNetAnnual / 12),
      taxFreeAllowancesAnnual: Math.round(allowancesAnnual),
      retiredPayAnnual: Math.round(retiredAnnual),
      healthcareAnnual: Math.round(healthcareAnnual),
      employer401kMatchAnnual: 0,
      filing: filingKey,
      stateCode: stateCode || null,
    };
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (civilianNetFor(mid) < militaryNetAnnual) lo = mid;
    else hi = mid;
  }
  const requiredSalary = Math.round(hi);

  return {
    requiredSalary,
    unreachable: false,
    militaryNetAnnual: Math.round(militaryNetAnnual),
    militaryMonthlyNet: Math.round(militaryNetAnnual / 12),
    // The premium over base pay — the part people are surprised by.
    premiumOverBasePay: Math.round(requiredSalary - baseAnnual),
    taxFreeAllowancesAnnual: Math.round(allowancesAnnual),
    retiredPayAnnual: Math.round(retiredAnnual),
    healthcareAnnual: Math.round(healthcareAnnual),
    // Deferred compensation, reported alongside but NOT counted toward break-even.
    employer401kMatchAnnual: Math.round(requiredSalary * (clamp(Number(employer401kMatchPct) || 0, 0, 25) / 100)),
    filing: filingKey,
    stateCode: stateCode || null,
  };
}

// --- PPM/DITY move incentive estimate ---
// Incentive is 100% of the Government Constructed Cost (GCC) for moves in 2025+;
// profit (incentive minus documented expenses) is taxable, withheld at ~22%.
export function estimatePPM({ gcc, expenses = 0, withholdingRate = 0.22 }) {
  gcc = Math.max(0, Number(gcc) || 0);
  expenses = Math.max(0, Number(expenses) || 0);
  const incentive = gcc;
  const profit = Math.max(0, incentive - expenses);
  const taxWithheld = profit * withholdingRate;
  return { incentive, expenses, profit, taxWithheld, netProfit: profit - taxWithheld };
}

// --- Terminal leave vs. selling leave back at separation ---
// Selling accrued leave pays a one-time lump sum of BASE PAY ONLY for the days sold —
// no BAH, no BAS — and is taxed as supplemental wages (federal withholding defaults
// to 22%, same convention used for the PPM incentive above). Taking the same days as
// terminal leave instead means you're still on active duty (and drawing full pay +
// BAH + BAS, which is federal-tax-exempt) right up to your actual separation date —
// it just pushes that date out by the number of days taken. This compares the two
// purely as take-home dollars for the same block of days; it does NOT capture the
// often-larger factor of terminal leave letting you start terminal-leave job hunting
// or a civilian job earlier while still drawing military pay, which sell-back forfeits.
// 37 U.S.C. 501 caps leave sell-back at 60 days over an entire CAREER. The UI previously
// accepted up to 120 with no warning, so a member could plan around selling days that cannot
// legally be sold.
export const LEAVE_SELLBACK_CAREER_CAP = 60;

export function compareLeaveSellBack({ basePay = 0, bah = 0, bas = 0, days = 0, withholdingRate = 0.22, daysAlreadySold = 0 }) {
  basePay = Math.max(0, Number(basePay) || 0);
  bah = Math.max(0, Number(bah) || 0);
  bas = Math.max(0, Number(bas) || 0);
  days = Math.max(0, Number(days) || 0);
  const alreadySold = clamp(Number(daysAlreadySold) || 0, 0, LEAVE_SELLBACK_CAREER_CAP);
  const sellableRemaining = Math.max(0, LEAVE_SELLBACK_CAREER_CAP - alreadySold);
  // Days beyond the statutory cap simply cannot be sold; they can only be taken as leave.
  const sellableDays = Math.min(days, sellableRemaining);
  const unsellableDays = days - sellableDays;
  const dailyBase = basePay / 30;
  const dailyBah = bah / 30;
  const dailyBas = bas / 30;

  // Only days within the career cap can actually be sold.
  const sellBackGross = dailyBase * sellableDays;
  const sellBackTaxWithheld = sellBackGross * withholdingRate;
  const sellBackNet = sellBackGross - sellBackTaxWithheld;

  // BAH/BAS are federal-tax-exempt, so only the base-pay portion is withheld against.
  const terminalLeaveGross = (dailyBase + dailyBah + dailyBas) * days;
  const terminalLeaveTaxWithheld = dailyBase * days * withholdingRate;
  const terminalLeaveNet = terminalLeaveGross - terminalLeaveTaxWithheld;

  // Terminal leave is algebraically incapable of losing this comparison: it pays the same
  // base pay PLUS untaxed BAH/BAS for the same days. Reporting "terminal leave wins" as if it
  // were a finding is therefore vacuous. What a member can actually act on is the per-day
  // premium — what each extra day on active duty is worth versus selling it — so that is the
  // headline number, and the UI frames it that way instead of announcing a winner.
  const perDayAdvantage = days > 0 ? (terminalLeaveNet - sellBackNet) / days : (dailyBah + dailyBas);

  return {
    days,
    sellableDays,
    unsellableDays,
    sellbackCap: LEAVE_SELLBACK_CAREER_CAP,
    // True when the request exceeds what 37 U.S.C. 501 allows to be sold.
    exceedsSellbackCap: unsellableDays > 0,
    sellBackGross: Math.round(sellBackGross),
    sellBackNet: Math.round(sellBackNet),
    terminalLeaveGross: Math.round(terminalLeaveGross),
    terminalLeaveNet: Math.round(terminalLeaveNet),
    netDifference: Math.round(terminalLeaveNet - sellBackNet), // positive => terminal leave nets more
    perDayAdvantage: Math.round(perDayAdvantage * 100) / 100,
  };
}

// --- TSP keep-in vs roll-out checker (rules + fee-drag projection) ---
export function tspKeepVsRoll({ ageAtSeparation = 45, tradBalance = 0, rothBalance = 0, advisoryFeePct = 1.0, tspFeePct = 0.05, years = 20, growthPct = 6 }) {
  const total = (Number(tradBalance) || 0) + (Number(rothBalance) || 0);
  const flags = [];
  if (Number(ageAtSeparation) >= 55) {
    flags.push('You are separating in or after the year you turn 55: money LEFT IN the TSP can be withdrawn penalty-free now. Rolling to an IRA re-imposes the 10% early-withdrawal penalty until age 59½.');
  } else {
    flags.push('Under 55 at separation: the 10% early-withdrawal penalty generally applies before age 59½ in both the TSP and an IRA (limited exceptions).');
  }
  flags.push('The age-50 public-safety early-withdrawal exception does NOT apply to military retired pay or the TSP.');
  if ((Number(rothBalance) || 0) > 0) flags.push('Roth TSP qualified (tax-free) withdrawals require BOTH the 5-year rule and age 59½.');
  flags.push('Traditional TSP required minimum distributions (RMDs) begin at age 73 (75 if born in 1960 or later). Roth TSP has no lifetime RMDs.');
  const g = (Number(growthPct) || 0) / 100;
  const yrs = Math.max(0, Number(years) || 0);
  const endValue = (feePct) => total * Math.pow(1 + g - ((Number(feePct) || 0) / 100), yrs);
  const tspEnd = endValue(tspFeePct);
  const advisoryEnd = endValue(advisoryFeePct);
  return {
    total, years: yrs, flags,
    tspEnd: Math.round(tspEnd),
    advisoryEnd: Math.round(advisoryEnd),
    // SIGNED, deliberately. The old Math.max(0, …) floor meant that when the rolled-out
    // option was genuinely cheaper (an IRA fee below the TSP's), the tool reported "could
    // cost roughly $0" instead of showing the user they'd come out ahead. Positive = staying
    // in the TSP wins; negative = rolling out wins by that amount.
    feeDrag: Math.round(tspEnd - advisoryEnd),
  };
}

export const VALID_BRANCHES = ['Army', 'Navy', 'Air Force', 'Marine Corps', 'Space Force', 'Coast Guard'];

// ===== PLAN SHAPE =====
// One declarative spec drives BOTH validation and sanitization, so the two can't disagree —
// and so a field the UI writes can never be missing from the validator (the drift that made
// a legitimate `payRetSystem` or a typed-in `tspRetAge` of 30 turn every save into a silent
// 400 with nothing but "Couldn't save" to go on).
//
// `req` fields must be present and valid. Everything else is optional but, when present,
// must match. `max`/`min` are inclusive.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PLAN_FIELDS = {
  // --- identity / required ---
  firstName:      { type: 'string', req: true, max: 100, nonEmpty: true },
  branch:         { type: 'enum',   req: true, values: VALID_BRANCHES },
  rankCat:        { type: 'enum',   req: true, values: ['E', 'W', 'O'] },
  yos:            { type: 'number', req: true, min: 1, max: 40 },
  transType:      { type: 'enum',   req: true, values: ['Retirement', 'Separation'] },
  sepDate:        { type: 'date',   req: true },
  // --- optional strings ---
  rank:           { type: 'string', max: 100 },
  postLocation:   { type: 'string', max: 100 },
  careerInterest: { type: 'string', max: 100 },
  // Optional dates accept '' (the empty <input type="date">) but not arbitrary text — a
  // length-only check let "garbage" through and rendered "NaN years" / "Invalid Date".
  dateOfRank:     { type: 'date', allowEmpty: true },
  todayDate:      { type: 'date', allowEmpty: true },
  // --- enums ---
  payRetSystem:       { type: 'enum', values: RETIREMENT_SYSTEMS },
  tspContribMode:     { type: 'enum', values: ['fixed', 'pct'] },
  tspWithdrawalMethod:{ type: 'enum', values: ['fixed', 'life', 'annuity'] },
  // --- booleans ---
  ptdy:          { type: 'boolean' },
  sb:            { type: 'boolean' },
  giBill:        { type: 'boolean' },
  vaClaim:       { type: 'boolean' },
  married:       { type: 'boolean' },
  homeowner:     { type: 'boolean' },
  clearance:     { type: 'boolean' },
  federalJob:    { type: 'boolean' },
  oconus:        { type: 'boolean' },
  hasDependents: { type: 'boolean' },
  // --- numbers ---
  sbDays:           { type: 'number', min: 0, max: 180 },
  ptdyDays:         { type: 'number', min: 0, max: 30 },
  leaveDays:        { type: 'number', min: 0, max: 120 },
  selectedVARating: { type: 'number', min: 0, max: 100 },
  tspRetAge:        { type: 'number', min: 38, max: 70 },
  tspBalance:       { type: 'number', min: 0, max: 1e9 },
  tspFixedAmount:   { type: 'number', min: 0, max: 1e7 },
  tspRate:          { type: 'number', min: 0, max: 20 },
  tspYearsToRet:    { type: 'number', min: 0, max: 50 },
  tspContribution:  { type: 'number', min: 0, max: 1e6 },
  tspContribPct:    { type: 'number', min: 0, max: 100 },
  payBasePay:       { type: 'number', min: 0, max: 1e6 },
  bah:              { type: 'number', min: 0, max: 1e5 },
  // --- maps ---
  // Checklist progress: stable kebab-case task ids → boolean.
  checks: { type: 'map', maxKeys: 400, keyRe: /^[a-z0-9][a-z0-9-]{0,63}$/, valueType: 'boolean' },
  // Decision-tool overrides: input element id → that control's raw value. Text/number/select
  // inputs contribute strings; checkboxes contribute BOOLEANS (dtPsLowCost, dtPsFlex). Both
  // must be accepted — a string-only rule silently 400s every save the moment a visitor
  // touches the Prime-vs-Select checkboxes, which is exactly the "valid UI state fails
  // validation" direction that costs a user their data rather than protecting them.
  tools:  { type: 'map', maxKeys: 100, keyRe: /^[A-Za-z][A-Za-z0-9_-]{0,63}$/, valueType: 'scalar', maxValueLength: 64 },
};

function fieldValid(spec, v) {
  switch (spec.type) {
    case 'string':
      return typeof v === 'string' && v.length <= spec.max && (!spec.nonEmpty || v.trim() !== '');
    case 'enum':
      return spec.values.includes(v);
    case 'number':
      return typeof v === 'number' && isFinite(v) && v >= spec.min && v <= spec.max;
    case 'boolean':
      return typeof v === 'boolean';
    case 'date':
      if (spec.allowEmpty && v === '') return true;
      return typeof v === 'string' && DATE_RE.test(v);
    case 'map': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
      const keys = Object.keys(v);
      if (keys.length > spec.maxKeys) return false;
      return keys.every((k) => {
        if (!spec.keyRe.test(k)) return false;
        const val = v[k];
        if (spec.valueType === 'boolean') return typeof val === 'boolean';
        // 'scalar': a form control's value — string, boolean (checkbox), or number.
        if (typeof val === 'boolean') return true;
        if (typeof val === 'number') return isFinite(val);
        return typeof val === 'string' && val.length <= spec.maxValueLength;
      });
    }
    default:
      return false;
  }
}

// Allow-list validation for untrusted plans (imported files / shared links / API writes).
// Defense-in-depth alongside output-escaping: it rejects wrong-typed or oversized values for
// the fields that later flow into the DOM, and pins branch to a known key (an unknown branch
// would also crash rendering at BRANCH_META).
export function isValidState(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  for (const [name, spec] of Object.entries(PLAN_FIELDS)) {
    const v = obj[name];
    if (v === undefined) {
      if (spec.req) return false;
      continue;
    }
    if (!fieldValid(spec, v)) return false;
  }
  return true;
}

// Returns a NEW object containing only known, valid fields — unknown keys are dropped rather
// than persisted. isValidState alone never rejected extra keys, so `POST /api/p` would store
// whatever else was attached to the object, at 64 KiB a row with no expiry. Storing the
// projection instead of the caller's object means the database only ever holds plan shape.
export function sanitizeState(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out = {};
  for (const [name, spec] of Object.entries(PLAN_FIELDS)) {
    const v = obj[name];
    if (v === undefined) {
      if (spec.req) return null;
      continue;
    }
    if (!fieldValid(spec, v)) return null;
    if (spec.type === 'map') {
      const m = {};
      for (const k of Object.keys(v)) m[k] = v[k];
      out[name] = m;
    } else {
      out[name] = v;
    }
  }
  return out;
}
