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
  it("VA 100% rate is current", () => {
    expect(calc.VA_RATES_2025[100]).toBe(3737.85);
  });
  it("SkillBridge cap lookup", () => {
    expect(calc.getSkillbridgeAuthorizedMax("Army", "E-5")).toBe(120);
    expect(calc.getSkillbridgeAuthorizedMax("Army", "Z-1")).toBeNull();
  });
  it("annuity factor interpolates between table points", () => {
    expect(calc.interpolateAnnuityFactor(47)).toBeCloseTo(5.01, 2);
  });
});

describe("parseStateFromLocation", () => {
  it("maps 'Austin, TX' → TX", () => {
    expect(calc.parseStateFromLocation("Austin, TX")).toBe("TX");
  });
  it("maps a full state name", () => {
    expect(calc.parseStateFromLocation("somewhere in Florida")).toBe("FL");
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
});
