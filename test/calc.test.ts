import { describe, it, expect } from "vitest";
import * as calc from "../public/js/calc.js";

describe("getBasePay2026", () => {
  it("returns a positive monthly figure and respects YOS brackets", () => {
    const early = calc.getBasePay2026("E-5", 2);
    const late = calc.getBasePay2026("E-5", 99); // caps at the top bracket
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThanOrEqual(early);
  });
  it("returns null for an unknown rank", () => {
    expect(calc.getBasePay2026("X-9", 20)).toBeNull();
  });
});

describe("computeRetirementPay", () => {
  it("high-3 = basePay * yos * 0.025", () => {
    expect(calc.computeRetirementPay({ basePay: 5000, yos: 20, system: "high3" }).monthly).toBe(2500);
  });
  it("brs = basePay * yos * 0.02", () => {
    expect(calc.computeRetirementPay({ basePay: 5000, yos: 20, system: "brs" }).monthly).toBe(2000);
  });
});

describe("data tables", () => {
  it("VA rates are on the 2025 (Dec 1 2024 COLA) vintage", () => {
    expect(calc.VA_RATES_2025[100]).toBe(3831.30);
    expect(calc.VA_RATES_2025[30]).toBe(537.42); // pins a mid-bracket so vintage drift is caught
    expect(calc.VA_RATES_2025[10]).toBe(175.51);
  });
  it("SkillBridge cap lookup", () => {
    expect(calc.getSkillbridgeAuthorizedMax("Army", "E-5")).toBe(120);
    expect(calc.getSkillbridgeAuthorizedMax("Army", "Z-1")).toBeNull();
  });
  it("annuity factor interpolates between table points and clamps at the bounds", () => {
    expect(calc.interpolateAnnuityFactor(47)).toBeCloseTo(5.01, 2);
    expect(calc.interpolateAnnuityFactor(50)).toBe(5.35); // exact table hit
    expect(calc.interpolateAnnuityFactor(30)).toBe(4.20); // below table → clamps to age 38
    expect(calc.interpolateAnnuityFactor(80)).toBe(9.35); // above table → clamps to age 70
  });
  it("life-expectancy distribution period: exact, interpolated, and clamped", () => {
    expect(calc.getLifeExpDistributionPeriod(50)).toBe(42.5);
    expect(calc.getLifeExpDistributionPeriod(65)).toBe(27.5);
    expect(calc.getLifeExpDistributionPeriod(52)).toBeCloseTo(40.5, 2);
    expect(calc.getLifeExpDistributionPeriod(40)).toBe(47.5); // below table → clamps
    expect(calc.getLifeExpDistributionPeriod(75)).toBe(22.5); // above table → clamps
  });
});

describe("parseStateFromLocation", () => {
  it("maps 'Austin, TX' → TX", () => {
    expect(calc.parseStateFromLocation("Austin, TX")).toBe("TX");
  });
  it("maps a full state name", () => {
    expect(calc.parseStateFromLocation("somewhere in Florida")).toBe("FL");
  });
  it("disambiguates West Virginia from Virginia (longest name wins)", () => {
    expect(calc.parseStateFromLocation("West Virginia")).toBe("WV");
    expect(calc.parseStateFromLocation("Charleston, West Virginia")).toBe("WV");
    expect(calc.parseStateFromLocation("Virginia Beach")).toBe("VA");
  });
  it("maps Washington D.C. variants to DC, not Washington state", () => {
    expect(calc.parseStateFromLocation("Washington DC")).toBe("DC");
    expect(calc.parseStateFromLocation("Washington, D.C.")).toBe("DC");
    expect(calc.parseStateFromLocation("Washington")).toBe("WA");
    expect(calc.parseStateFromLocation("Seattle, WA")).toBe("WA");
  });
  it("returns null when nothing matches", () => {
    expect(calc.parseStateFromLocation("Atlantis")).toBeNull();
  });
});

describe("date utils", () => {
  it("daysBetween / subDays / clamp", () => {
    const a = new Date(2026, 0, 1);
    const b = calc.subDays(a, -10); // +10 days
    expect(calc.daysBetween(a, b)).toBe(10);
    expect(calc.clamp(150, 0, 100)).toBe(100);
    expect(calc.clamp(-5, 0, 100)).toBe(0);
  });
});

describe("milestoneStatus", () => {
  it("classifies past / today / soon / future", () => {
    expect(calc.milestoneStatus(-1)).toBe("past");
    expect(calc.milestoneStatus(0)).toBe("today");
    expect(calc.milestoneStatus(15)).toBe("soon");
    expect(calc.milestoneStatus(60)).toBe("future");
  });
});

describe("buildICS", () => {
  const ics = calc.buildICS(
    [{ label: "Freedom; Day, finally", date: new Date(2026, 5, 26) }],
    { now: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) },
  );
  it("emits a VEVENT with a local-date DTSTART (no UTC shift)", () => {
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260626");
  });
  it("escapes special characters in SUMMARY", () => {
    expect(ics).toContain("SUMMARY:Freedom\\; Day\\, finally");
  });
  it("uses CRLF line endings", () => {
    expect(ics).toContain("\r\n");
  });
});

describe("encodeState / decodeState", () => {
  it("round-trips an object (incl. unicode)", () => {
    const obj = { firstName: "José 🇺🇸", rankCat: "E", yos: 12, checks: { "p1-0": true } };
    expect(calc.decodeState(calc.encodeState(obj))).toEqual(obj);
  });
  it("returns null on malformed input", () => {
    expect(calc.decodeState("!!!not-base64!!!")).toBeNull();
  });
});

describe("computeSBP", () => {
  it("premium = 6.5% of base, annuity = 55% of base", () => {
    const r = calc.computeSBP({ baseAmount: 5000, retireeAge: 45 });
    expect(r.monthlyPremium).toBe(325);
    expect(r.survivorMonthly).toBe(2750);
  });
  it("paid-up requires at least 360 payments, more if young at retirement", () => {
    expect(calc.computeSBP({ baseAmount: 5000, retireeAge: 45 }).paidUpPayments).toBe(360);
    expect(calc.computeSBP({ baseAmount: 5000, retireeAge: 38 }).paidUpPayments).toBe(384); // (70-38)*12
  });
  it("computes a break-even horizon", () => {
    const r = calc.computeSBP({ baseAmount: 5000, retireeAge: 45 });
    expect(r.totalPremiums).toBe(325 * 360);
    expect(r.breakEvenMonths).toBe(Math.ceil((325 * 360) / 2750));
  });
});

describe("compareConcurrentReceipt", () => {
  it("applies the VA waiver and flags CRDP eligibility at 20yr + 50%", () => {
    const r = calc.compareConcurrentReceipt({ grossRetiredPay: 3000, vaRating: 50, combatRelatedPct: 100, marginalRate: 0.22, yos: 20 });
    expect(r.vaComp).toBe(calc.VA_RATES_2025[50]);
    expect(r.waived).toBeCloseTo(calc.VA_RATES_2025[50], 2);
    expect(r.crdpEligible).toBe(true);
    // 100% combat-related, tax-free CRSC beats taxable CRDP here
    expect(r.recommend).toBe("crsc");
  });
  it("does not offer CRDP below 50%", () => {
    const r = calc.compareConcurrentReceipt({ grossRetiredPay: 3000, vaRating: 30, combatRelatedPct: 0, yos: 20 });
    expect(r.crdpEligible).toBe(false);
  });
});

describe("estimateRetireeHealthcareCost + TRICARE_FEES_2026", () => {
  it("uses the verified 2026 Select fees", () => {
    expect(calc.TRICARE_FEES_2026.select.groupB.individual).toBe(594.96);
    expect(calc.TRICARE_FEES_2026.select.groupA.family).toBe(375);
  });
  it("sums enrollment + Rx + FEDVIP into an annual total", () => {
    const r = calc.estimateRetireeHealthcareCost({ group: "B", coverage: "family", annualRx: 600, fedvipMonthly: 50 });
    expect(r.enrollmentFee).toBe(1191);
    expect(r.annualFedvip).toBe(600);
    expect(r.totalAnnual).toBe(1191 + 600 + 600);
  });
});

describe("compareStates", () => {
  it("ranks no-tax states ahead of taxing states", () => {
    const ranked = calc.compareStates(["CA", "TX", "VA"], 60000);
    expect(ranked[0].code).toBe("TX");
    expect(ranked[0].estAnnualTax).toBe(0);
    expect(ranked[ranked.length - 1].code).toBe("CA");
  });
});

describe("estimatePPM", () => {
  it("incentive minus expenses, less 22% withholding on profit", () => {
    const r = calc.estimatePPM({ gcc: 10000, expenses: 4000 });
    expect(r.profit).toBe(6000);
    expect(r.taxWithheld).toBeCloseTo(1320, 2);
    expect(r.netProfit).toBeCloseTo(4680, 2);
  });
});

describe("tspKeepVsRoll", () => {
  it("flags the age-55 rule and projects fee drag", () => {
    const r = calc.tspKeepVsRoll({ ageAtSeparation: 56, tradBalance: 200000, years: 20, advisoryFeePct: 1, tspFeePct: 0.05 });
    expect(r.flags.some((f: string) => f.includes("55"))).toBe(true);
    expect(r.feeDrag).toBeGreaterThan(0);
  });
});

describe("isValidState", () => {
  const good = {
    firstName: "Pat",
    rankCat: "O",
    yos: 18,
    transType: "Retirement",
    sepDate: "2027-06-01",
    branch: "Navy",
  };
  it("accepts a well-formed plan", () => {
    expect(calc.isValidState(good)).toBe(true);
  });
  it("rejects empties / bad shapes", () => {
    expect(calc.isValidState({})).toBe(false);
    expect(calc.isValidState(null)).toBe(false);
    expect(calc.isValidState({ ...good, yos: 99 })).toBe(false);
    expect(calc.isValidState({ ...good, rankCat: "Z" })).toBe(false);
    expect(calc.isValidState({ ...good, sepDate: "06/01/2027" })).toBe(false);
  });
  it("rejects unknown branches and unsafe free-text / numeric fields (defense-in-depth)", () => {
    expect(calc.isValidState({ ...good, branch: "Rebel Alliance" })).toBe(false);
    // postLocation as an HTML payload is a string but over the length cap → rejected.
    expect(calc.isValidState({ ...good, postLocation: "x".repeat(101) })).toBe(false);
    // numeric fields must be in-range numbers, not strings carrying markup.
    expect(calc.isValidState({ ...good, sbDays: "<img src=x onerror=alert(1)>" })).toBe(false);
    expect(calc.isValidState({ ...good, leaveDays: 999 })).toBe(false);
    expect(calc.isValidState({ ...good, rank: 12345 })).toBe(false);
  });
  it("accepts a plan with valid optional fields present", () => {
    expect(calc.isValidState({ ...good, postLocation: "San Antonio, TX", sbDays: 90, ptdyDays: 20, leaveDays: 60, rank: "O-4 Major" })).toBe(true);
  });
  it("validates dateOfRank as empty or strict YYYY-MM-DD", () => {
    expect(calc.isValidState({ ...good, dateOfRank: "2020-05-01" })).toBe(true);
    expect(calc.isValidState({ ...good, dateOfRank: "" })).toBe(true);
    expect(calc.isValidState({ ...good, dateOfRank: "05/01/2020" })).toBe(false);
    expect(calc.isValidState({ ...good, dateOfRank: "garbage" })).toBe(false);
  });
  it("rejects out-of-range TSP numeric fields", () => {
    expect(calc.isValidState({ ...good, tspRetAge: 200 })).toBe(false);
    expect(calc.isValidState({ ...good, tspBalance: "1e9" })).toBe(false);
    expect(calc.isValidState({ ...good, tspRetAge: 50, tspBalance: 85000 })).toBe(true);
  });
});
