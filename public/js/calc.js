// ===== calc.js =====
// Pure, DOM-free data + calculation logic shared by the front-end (loaded as an
// ES module over HTTP) and the test suite. No document/window access here.
// Extracted verbatim from the original single-file app, plus new helpers.

export const SKILLBRIDGE_LIMITS = {
  'Army': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 90, 'E-7': 90, 'E-8': 60, 'E-9': 60, 'W-1': 90, 'W-2': 90, 'W-3': 90, 'W-4': 60, 'W-5': 60, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 90, 'O-5': 60 },
  'Air Force': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 90, 'E-7': 90, 'E-8': 60, 'E-9': 60, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 90, 'O-5': 60 },
  'Navy': { 'E-2': 180, 'E-3': 180, 'E-4': 180, 'E-5': 180, 'E-6': 120, 'E-7': 120, 'E-8': 120, 'E-9': 120, 'W-1': 120, 'W-2': 120, 'W-3': 120, 'W-4': 120, 'W-5': 120, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 120, 'O-5': 90 },
  'Space Force': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 120, 'E-7': 120, 'E-8': 120, 'E-9': 90, 'O-1': 120, 'O-2': 120, 'O-3': 120, 'O-4': 120, 'O-5': 90 },
  'Marine Corps': { 'E-2': 120, 'E-3': 120, 'E-4': 120, 'E-5': 120, 'E-6': 90, 'E-7': 90, 'E-8': 90, 'E-9': 90, 'W-1': 90, 'W-2': 90, 'W-3': 90, 'W-4': 90, 'W-5': 90, 'O-1': 90, 'O-2': 90, 'O-3': 90, 'O-4': 90, 'O-5': 90, 'O-6': 90, 'O-7': 90 },
  'Coast Guard': {}
};

export const BASE_PAY_2026 = {
  'E-1': { 2: 2407.20 },
  'E-2': { 2: 2697.90 },
  'E-3': { 2: 2836.80, 3: 3015.00, 4: 3198.00 },
  'E-4': { 2: 3142.20, 3: 3303.00, 4: 3482.40, 6: 3658.50, 8: 3815.40 },
  'E-5': { 2: 3342.90, 3: 3598.20, 4: 3775.80, 6: 3946.80, 8: 4110.00, 10: 4299.90, 12: 4395.30, 14: 4421.70 },
  'E-6': { 2: 3401.10, 3: 3743.10, 4: 3908.10, 6: 4068.90, 8: 4235.70, 10: 4612.80, 12: 4759.50, 14: 5043.30, 16: 5130.30, 18: 5193.60, 20: 5267.70 },
  'E-7': { 2: 3932.10, 3: 4291.50, 4: 4456.20, 6: 4673.10, 8: 4843.80, 10: 5135.70, 12: 5300.40, 14: 5591.70, 16: 5835.00, 18: 6000.90, 20: 6177.30, 22: 6245.70, 24: 6475.20, 26: 6598.20, 28: 7067.40 },
  'E-8': { 8: 5656.50, 10: 5907.00, 12: 6061.80, 14: 6247.20, 16: 6448.20, 18: 6811.20, 20: 6995.40, 22: 7308.30, 24: 7481.70, 26: 7908.90, 30: 8067.30 },
  'E-9': { 10: 6910.20, 12: 7066.50, 14: 7263.60, 16: 7496.10, 18: 7730.70, 20: 8105.10, 22: 8423.10, 24: 8756.70, 26: 9267.90, 30: 9730.20, 34: 10217.40, 38: 10729.20 },
  'W-1': { 2: 4056.60, 3: 4493.70, 4: 4611.00, 6: 4859.10, 8: 5152.20, 10: 5584.20, 12: 5786.10, 14: 6069.30, 16: 6346.50, 18: 6564.90, 20: 6766.20, 22: 7010.10 },
  'W-2': { 2: 4621.80, 3: 5058.90, 4: 5193.30, 6: 5286.00, 8: 5585.40, 10: 6051.00, 12: 6282.60, 14: 6509.40, 16: 6787.50, 18: 7005.00, 20: 7201.50, 22: 7437.00, 24: 7591.50, 26: 7714.20 },
  'W-3': { 2: 5223.30, 3: 5440.50, 4: 5664.30, 6: 5736.90, 8: 5970.90, 10: 6431.10, 12: 6910.50, 14: 7136.40, 16: 7397.70, 18: 7665.90, 20: 8150.40, 22: 8476.50, 24: 8671.80, 26: 8879.70, 28: 9162.60 },
  'W-4': { 2: 5719.80, 3: 6152.10, 4: 6328.50, 6: 6502.20, 8: 6801.90, 10: 7098.00, 12: 7398.00, 14: 7848.30, 16: 8243.70, 18: 8619.90, 20: 8928.60, 22: 9228.90, 24: 9669.60, 26: 10032.00, 28: 10445.40, 30: 10653.60 },
  'W-5': { 20: 10169.70, 22: 10685.70, 24: 11070.30, 26: 11495.10, 30: 12070.80, 34: 12673.50, 38: 13308.30 },
  'O-1': { 2: 4150.20, 3: 4320.00, 4: 5222.40, 6: 5222.40, 8: 5222.40, 10: 5222.40, 12: 5222.40, 14: 5222.40, 16: 5222.40, 20: 5222.40 },
  'O-2': { 2: 4782.00, 3: 5446.20, 4: 6272.40, 6: 6484.50, 8: 6617.70, 10: 6617.70, 12: 6617.70, 14: 6617.70, 16: 6617.70, 20: 6617.70 },
  'O-3': { 2: 5534.10, 3: 6273.90, 4: 6770.40, 6: 7382.70, 8: 7737.00, 10: 8125.50, 12: 8375.70, 14: 8788.20, 16: 9004.20, 20: 9004.20 },
  'O-4': { 2: 6294.60, 3: 7286.40, 4: 7773.60, 6: 7881.00, 8: 8332.20, 10: 8816.40, 12: 9420.00, 14: 9888.30, 16: 10214.40, 18: 10401.60, 20: 10509.90 },
  'O-5': { 2: 7295.40, 3: 8218.20, 4: 8787.00, 6: 8894.10, 8: 9249.60, 10: 9461.40, 12: 9928.50, 14: 10271.70, 16: 10715.10, 18: 11391.30, 20: 12032.70, 22: 12394.80 },
  'O-6': { 2: 8751.30, 3: 9613.80, 4: 10245.00, 6: 10284.30, 8: 10725.00, 10: 10783.50, 12: 10783.50, 14: 11396.40, 16: 12479.70, 20: 13751.10, 22: 14112.90, 24: 14479.20, 26: 15188.70, 30: 15408.30 },
  'O-7': { 2: 11540.10, 3: 12076.20, 4: 12324.30, 6: 12522.00, 8: 12878.70, 10: 13231.80, 12: 13639.20, 14: 14045.70, 16: 14454.30, 18: 15735.30, 20: 16817.70, 26: 16904.40, 30: 17242.20 },
};

export const VA_RATES_2025 = { 0:0, 10:175.51, 20:346.95, 30:508.05, 40:731.86, 50:1041.82, 60:1319.65, 70:1663.06, 80:1933.15, 90:2172.39, 100:3737.85 };

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
  // Check for state abbreviation after comma: "San Antonio, TX"
  const commaMatch = upper.match(/,\s*([A-Z]{2})\s*$/);
  if (commaMatch && STATE_TAX_DATA[commaMatch[1]]) return commaMatch[1];
  // Full state name search
  for (const [code, data] of Object.entries(STATE_TAX_DATA)) {
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

// Allow-list validation for untrusted plans (imported files / shared links).
export function isValidState(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (typeof obj.firstName !== 'string' || obj.firstName.trim() === '') return false;
  if (!['E', 'W', 'O'].includes(obj.rankCat)) return false;
  if (typeof obj.yos !== 'number' || !isFinite(obj.yos) || obj.yos < 1 || obj.yos > 40) return false;
  if (!['Retirement', 'Separation'].includes(obj.transType)) return false;
  if (typeof obj.sepDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.sepDate)) return false;
  if (typeof obj.branch !== 'string' || obj.branch.trim() === '') return false;
  return true;
}
