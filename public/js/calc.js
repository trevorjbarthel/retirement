// ===== calc.js =====
// Pure, DOM-free data + calculation logic shared by the front-end (loaded as an
// ES module over HTTP) and the test suite. No document/window access here.
// Extracted verbatim from the original single-file app, plus new helpers.

// Pay tables are generated from official DFAS data (scripts/update-pay-tables.mjs).
import { BASE_PAY_2026 } from './pay-tables.generated.js';
export { BASE_PAY_2026 };

export const SKILLBRIDGE_LIMITS = {
  'Army': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 90, 'E-7': 90, 'E-8': 60, 'E-9': 60, 'W-1': 90, 'W-2': 90, 'W-3': 90, 'W-4': 60, 'W-5': 60, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 90, 'O-5': 60 },
  'Air Force': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 90, 'E-7': 90, 'E-8': 60, 'E-9': 60, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 90, 'O-5': 60 },
  'Navy': { 'E-2': 180, 'E-3': 180, 'E-4': 180, 'E-5': 180, 'E-6': 120, 'E-7': 120, 'E-8': 120, 'E-9': 120, 'W-1': 120, 'W-2': 120, 'W-3': 120, 'W-4': 120, 'W-5': 120, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 120, 'O-5': 90 },
  'Space Force': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 120, 'E-7': 120, 'E-8': 120, 'E-9': 90, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 120, 'O-5': 90 },
  'Marine Corps': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 90, 'E-7': 90, 'E-8': 90, 'E-9': 90, 'W-1': 90, 'W-2': 90, 'W-3': 90, 'W-4': 90, 'W-5': 90, 'O-1': 90, 'O-2': 90, 'O-3': 90, 'O-4': 90, 'O-5': 90, 'O-6': 90, 'O-7': 90 },
  'Coast Guard': {}
};


// Veteran-alone (no dependents) monthly rates, effective Dec 1, 2024 COLA (the "2025" rates).
// Verified against VA published figures — keep the whole table on one vintage.
export const VA_RATES_2025 = { 0:0, 10:175.51, 20:346.95, 30:537.42, 40:774.16, 50:1102.04, 60:1395.93, 70:1759.19, 80:2044.89, 90:2297.96, 100:3831.30 };

export const STATE_TAX_DATA = {
  'AL': { name:'Alabama', militaryRetirementTax:'exempt', topRate:5.0, note:'Military retirement pay is fully exempt from Alabama income tax.' },
  'AK': { name:'Alaska', militaryRetirementTax:'exempt', topRate:0, note:'Alaska has no state income tax.' },
  'AZ': { name:'Arizona', militaryRetirementTax:'exempt', topRate:2.5, note:'Military retirement pay is fully exempt from Arizona income tax (as of 2021).' },
  'AR': { name:'Arkansas', militaryRetirementTax:'partial', topRate:3.9, note:'Military retirement pay is partially exempt (first $6,000 exempt for under age 59½; fully exempt at 59½+).' },
  'CA': { name:'California', militaryRetirementTax:'taxed', topRate:13.3, note:'California taxes military retirement pay as regular income. CA has the highest top marginal rate in the US.' },
  'CO': { name:'Colorado', militaryRetirementTax:'partial', topRate:4.4, note:'Up to $24,000 of military retirement pay exempt for those 65+; $20,000 for ages 55–64.' },
  'CT': { name:'Connecticut', militaryRetirementTax:'partial', topRate:6.99, note:'50% of military retirement pay exempt if federal AGI is under $75,000 (single) or $100,000 (joint).' },
  'DE': { name:'Delaware', militaryRetirementTax:'partial', topRate:6.6, note:'Up to $12,500 of military retirement pay is exempt.' },
  'FL': { name:'Florida', militaryRetirementTax:'exempt', topRate:0, note:'Florida has no state income tax — very favorable for retirees.' },
  'GA': { name:'Georgia', militaryRetirementTax:'exempt', topRate:5.49, note:'Military retirement pay is fully exempt from Georgia income tax (as of 2022).' },
  'HI': { name:'Hawaii', militaryRetirementTax:'exempt', topRate:11.0, note:'Military retirement pay is fully exempt from Hawaii income tax.' },
  'ID': { name:'Idaho', militaryRetirementTax:'taxed', topRate:5.8, note:'Idaho taxes military retirement pay as regular income.' },
  'IL': { name:'Illinois', militaryRetirementTax:'exempt', topRate:4.95, note:'Military retirement pay is fully exempt from Illinois income tax.' },
  'IN': { name:'Indiana', militaryRetirementTax:'exempt', topRate:3.05, note:'Military retirement pay is fully exempt from Indiana income tax.' },
  'IA': { name:'Iowa', militaryRetirementTax:'exempt', topRate:5.7, note:'Military retirement pay is fully exempt from Iowa income tax (as of 2024).' },
  'KS': { name:'Kansas', militaryRetirementTax:'exempt', topRate:5.7, note:'Military retirement pay is fully exempt from Kansas income tax.' },
  'KY': { name:'Kentucky', militaryRetirementTax:'exempt', topRate:4.0, note:'Military retirement pay is fully exempt from Kentucky income tax.' },
  'LA': { name:'Louisiana', militaryRetirementTax:'exempt', topRate:3.0, note:'Military retirement pay is fully exempt from Louisiana income tax.' },
  'ME': { name:'Maine', militaryRetirementTax:'partial', topRate:7.15, note:'Up to $10,000 of military retirement pay is exempt.' },
  'MD': { name:'Maryland', militaryRetirementTax:'partial', topRate:5.75, note:'Up to $5,000 exempt under age 55; up to $15,000 exempt at 55+. Local taxes also apply.' },
  'MA': { name:'Massachusetts', militaryRetirementTax:'exempt', topRate:5.0, note:'Military retirement pay is fully exempt from Massachusetts income tax.' },
  'MI': { name:'Michigan', militaryRetirementTax:'partial', topRate:4.25, note:'Up to $54,404 (single) / $108,808 (joint) exempt for those born after 1952 if retired before 2013.' },
  'MN': { name:'Minnesota', militaryRetirementTax:'taxed', topRate:9.85, note:'Minnesota taxes military retirement pay as regular income (limited exemption for some Combat-Related Special Compensation).' },
  'MS': { name:'Mississippi', militaryRetirementTax:'exempt', topRate:4.7, note:'Military retirement pay is fully exempt from Mississippi income tax.' },
  'MO': { name:'Missouri', militaryRetirementTax:'exempt', topRate:4.8, note:'Military retirement pay is fully exempt from Missouri income tax (as of 2016).' },
  'MT': { name:'Montana', militaryRetirementTax:'partial', topRate:6.75, note:'Up to $4,640 of military retirement pay may be deducted.' },
  'NE': { name:'Nebraska', militaryRetirementTax:'exempt', topRate:3.84, note:'Military retirement pay is fully exempt from Nebraska income tax (as of 2022).' },
  'NV': { name:'Nevada', militaryRetirementTax:'exempt', topRate:0, note:'Nevada has no state income tax.' },
  'NH': { name:'New Hampshire', militaryRetirementTax:'exempt', topRate:0, note:'New Hampshire has no income tax on wages/retirement (only taxes interest/dividends, phasing out by 2025).' },
  'NJ': { name:'New Jersey', militaryRetirementTax:'exempt', topRate:10.75, note:'Military retirement pay is fully exempt from New Jersey income tax.' },
  'NM': { name:'New Mexico', militaryRetirementTax:'partial', topRate:5.9, note:'Up to $10,000 of military retirement pay is exempt.' },
  'NY': { name:'New York', militaryRetirementTax:'exempt', topRate:10.9, note:'Military retirement pay from the US government is fully exempt from New York income tax.' },
  'NC': { name:'North Carolina', militaryRetirementTax:'partial', topRate:4.5, note:'Military retirement pay exempt if member had 5+ years of creditable service before August 12, 1989; otherwise taxed.' },
  'ND': { name:'North Dakota', militaryRetirementTax:'exempt', topRate:1.1, note:'Military retirement pay is fully exempt from North Dakota income tax.' },
  'OH': { name:'Ohio', militaryRetirementTax:'exempt', topRate:3.5, note:'Military retirement pay is fully exempt from Ohio income tax.' },
  'OK': { name:'Oklahoma', militaryRetirementTax:'partial', topRate:4.75, note:'Up to $10,000 of military retirement pay is exempt from Oklahoma income tax.' },
  'OR': { name:'Oregon', militaryRetirementTax:'partial', topRate:9.9, note:'Federal pension subtraction may apply up to certain limits; Oregon has one of the highest tax rates.' },
  'PA': { name:'Pennsylvania', militaryRetirementTax:'exempt', topRate:3.07, note:'Military retirement pay is fully exempt from Pennsylvania income tax.' },
  'RI': { name:'Rhode Island', militaryRetirementTax:'partial', topRate:5.99, note:'Military retirement pay may be partially exempt for those over 59½ up to $20,000.' },
  'SC': { name:'South Carolina', militaryRetirementTax:'exempt', topRate:6.2, note:'Military retirement pay is fully exempt from South Carolina income tax (as of 2022).' },
  'SD': { name:'South Dakota', militaryRetirementTax:'exempt', topRate:0, note:'South Dakota has no state income tax.' },
  'TN': { name:'Tennessee', militaryRetirementTax:'exempt', topRate:0, note:'Tennessee has no state income tax on wages or retirement income.' },
  'TX': { name:'Texas', militaryRetirementTax:'exempt', topRate:0, note:'Texas has no state income tax — very favorable for military retirees.' },
  'UT': { name:'Utah', militaryRetirementTax:'partial', topRate:4.65, note:'Up to $7,500 (single) / $15,000 (joint) credit against retirement income tax for ages 65+; phase-out applies.' },
  'VT': { name:'Vermont', militaryRetirementTax:'taxed', topRate:8.75, note:'Vermont taxes military retirement pay as regular income.' },
  'VA': { name:'Virginia', militaryRetirementTax:'partial', topRate:5.75, note:'Up to $20,000 exempt for ages 55–64; up to $30,000 exempt at 65+ (2024 amounts, increasing through 2025).' },
  'WA': { name:'Washington', militaryRetirementTax:'exempt', topRate:0, note:'Washington has no state income tax.' },
  'WV': { name:'West Virginia', militaryRetirementTax:'exempt', topRate:5.12, note:'Military retirement pay is fully exempt from West Virginia income tax.' },
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

export function getBasePay2026(rank, yearsOfService) {
  const rankData = BASE_PAY_2026[rank];
  if (!rankData) return null;
  const brackets = Object.keys(rankData).map(Number).sort((a, b) => a - b);
  let selected = brackets[0];
  for (const b of brackets) {
    if (yearsOfService >= b) selected = b;
    else break;
  }
  return rankData[selected];
}

export function parseStateFromLocation(locationStr) {
  if (!locationStr) return null;
  const upper = locationStr.trim().toUpperCase();
  // Direct 2-letter state code
  if (STATE_TAX_DATA[upper]) return upper;
  // District of Columbia — must precede the "WASHINGTON" full-name match (which would
  // otherwise grab "Washington DC" as Washington STATE).
  if (/\bD\.?C\.?\b/.test(upper) || upper.includes('DISTRICT OF COLUMBIA')) return 'DC';
  // Check for state abbreviation after comma: "San Antonio, TX"
  const commaMatch = upper.match(/,\s*([A-Z]{2})\s*$/);
  if (commaMatch && STATE_TAX_DATA[commaMatch[1]]) return commaMatch[1];
  // Full state name search — longest names first so "West Virginia" wins over "Virginia".
  const byNameLen = Object.entries(STATE_TAX_DATA).sort((a, b) => b[1].name.length - a[1].name.length);
  for (const [code, data] of byNameLen) {
    if (upper.includes(data.name.toUpperCase())) return code;
  }
  return null;
}

export function interpolateAnnuityFactor(age) {
  age = Math.max(38, Math.min(70, age));
  const ages = Object.keys(ANNUITY_FACTORS).map(Number).sort((a, b) => a - b);
  if (ANNUITY_FACTORS[age] !== undefined) return ANNUITY_FACTORS[age];
  let lower = ages[0], upper = ages[ages.length - 1];
  for (let i = 0; i < ages.length - 1; i++) {
    if (ages[i] <= age && ages[i + 1] >= age) {
      lower = ages[i]; upper = ages[i + 1]; break;
    }
  }
  const ratio = (age - lower) / (upper - lower);
  return ANNUITY_FACTORS[lower] + ratio * (ANNUITY_FACTORS[upper] - ANNUITY_FACTORS[lower]);
}

export function getLifeExpDistributionPeriod(age) {
  // Simplified IRS Uniform Lifetime Table approximation
  const table = { 45: 47.5, 50: 42.5, 55: 37.5, 60: 32.5, 65: 27.5, 70: 22.5 };
  const ages = Object.keys(table).map(Number).sort((a, b) => a - b);
  age = Math.max(ages[0], Math.min(ages[ages.length - 1], age));
  if (table[age] !== undefined) return table[age];
  let lower = ages[0], upper = ages[ages.length - 1];
  for (let i = 0; i < ages.length - 1; i++) {
    if (ages[i] <= age && ages[i + 1] >= age) {
      lower = ages[i]; upper = ages[i + 1]; break;
    }
  }
  const ratio = (age - lower) / (upper - lower);
  return table[lower] + ratio * (table[upper] - table[lower]);
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

// Data provenance — surfaced in the UI so future updates are obvious.
export const DATA_VINTAGE = {
  asOf: 'January 2026',
  basePay: '2026 DFAS Basic Pay Tables (3.8% raise, effective Jan 1 2026)',
  vaRates: '2025 VA disability compensation rates (Dec 1 2024 COLA)',
  stateTax: '2025 enacted state tax law',
  tsp: 'TSP/IRS life-expectancy & annuity factors (approximate)',
};

// General/flag officers: basic pay is statutorily capped at Executive Schedule
// Level II, so BASE_PAY_2026 intentionally omits exact O-8..O-10 rows until the
// official figures are dropped in. The UI gives these grades a tailored
// manual-entry prompt instead of a wrong auto-populated number.
export const FLAG_OFFICER_GRADES = ['O-8', 'O-9', 'O-10'];

// High-3 (2.5%/yr) or BRS (2.0%/yr) gross monthly retirement pay.
export function computeRetirementPay({ basePay, yos, system }) {
  const mult = system === 'brs' ? 0.02 : 0.025;
  const pct = yos * mult;
  return { monthly: Math.round(basePay * pct), mult, pct };
}

// Single source of truth for milestone urgency, shared by the card grid and the
// horizontal timeline so their colors always agree.
export function milestoneStatus(diffDays) {
  if (diffDays < 0) return 'past';
  if (diffDays === 0) return 'today';
  if (diffDays <= 30) return 'soon';
  return 'future';
}

function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
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
  (milestones || []).forEach((m, i) => {
    const start = m.date;
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:mtc-${icsDate(start)}-${i}@military-transition-calc`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(end)}`);
    lines.push(`SUMMARY:${icsEscape(m.label)}`);
    if (m.description) lines.push(`DESCRIPTION:${icsEscape(m.description)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Compact, URL-safe encoding of the plan for shareable links. encodeURIComponent
// before btoa keeps accented names / emoji from throwing the Latin-1 exception.
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

export const VALID_BRANCHES = ['Army', 'Navy', 'Air Force', 'Marine Corps', 'Space Force', 'Coast Guard'];

// Allow-list validation for untrusted plans (imported files / shared links). This is
// defense-in-depth alongside output-escaping: it rejects wrong-typed or oversized
// values for the free-text / numeric fields that later flow into the DOM, and pins
// branch to a known key (an unknown branch would also crash rendering at BRANCH_META).
export function isValidState(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.firstName !== 'string' || obj.firstName.trim() === '' || obj.firstName.length > 100) return false;
  if (!['E', 'W', 'O'].includes(obj.rankCat)) return false;
  if (typeof obj.yos !== 'number' || !isFinite(obj.yos) || obj.yos < 1 || obj.yos > 40) return false;
  if (!['Retirement', 'Separation'].includes(obj.transType)) return false;
  if (typeof obj.sepDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.sepDate)) return false;
  if (!VALID_BRANCHES.includes(obj.branch)) return false;
  // Optional fields, when present, must be the right (safe) type and within range.
  const okNum = (v, lo, hi) => v === undefined || (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi);
  if (!okNum(obj.sbDays, 0, 180) || !okNum(obj.ptdyDays, 0, 20) || !okNum(obj.leaveDays, 0, 120)) return false;
  // TSP numeric fields, when present, must be in the range the pay/withdrawal UI assumes.
  if (!okNum(obj.tspRetAge, 38, 70) || !okNum(obj.tspBalance, 0, 1e9) || !okNum(obj.tspFixedAmount, 0, 1e7) || !okNum(obj.tspRate, 0, 20)) return false;
  const okStr = (v, max) => v === undefined || (typeof v === 'string' && v.length <= max);
  if (!okStr(obj.rank, 100) || !okStr(obj.postLocation, 100) || !okStr(obj.careerInterest, 100)) return false;
  // dateOfRank, when present, must be empty or a strict YYYY-MM-DD (mirrors sepDate); a
  // length-only check would let "garbage" through and render "NaN years"/"Invalid Date".
  if (!(obj.dateOfRank === undefined || obj.dateOfRank === '' || (typeof obj.dateOfRank === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.dateOfRank)))) return false;
  return true;
}
