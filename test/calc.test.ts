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
  // Pins actual dollar values (verified against the 2026 DFAS chart, 3.8% raise
  // effective Jan 1 2026) so a bad annual refresh — e.g. scraping stale prior-year
  // data, or a parser regression — fails a specific assertion instead of just "some
  // positive number". Update these deliberately, in the same change, whenever the
  // pay tables are refreshed for a new year.
  it("pins exact 2026 DFAS values for spot-checked grade/YOS combinations", () => {
    expect(calc.getBasePay2026("E-9", 20)).toBeCloseTo(8105.1, 2);
    expect(calc.getBasePay2026("O-5", 20)).toBeCloseTo(12032.7, 2);
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
  it("VA rates are on the Dec 1 2025 COLA vintage", () => {
    expect(calc.VA_RATES_2025[100]).toBe(3938.58);
    expect(calc.VA_RATES_2025[30]).toBe(552.47); // pins a mid-bracket so vintage drift is caught
    expect(calc.VA_RATES_2025[10]).toBe(180.42);
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

describe("compareLeaveSellBack", () => {
  it("sell-back pays base pay only (no BAH/BAS), terminal leave pays all three", () => {
    const r = calc.compareLeaveSellBack({ basePay: 6000, bah: 1800, bas: 460, days: 30 });
    expect(r.sellBackGross).toBe(6000); // basePay/30 * 30 days = basePay
    expect(r.terminalLeaveGross).toBe(6000 + 1800 + 460);
  });
  it("BAH/BAS are federal-tax-exempt — only the base-pay portion is withheld against", () => {
    const r = calc.compareLeaveSellBack({ basePay: 3000, bah: 1500, bas: 500, days: 30, withholdingRate: 0.22 });
    expect(r.terminalLeaveNet).toBe(r.terminalLeaveGross - Math.round(3000 * 0.22));
  });
  it("terminal leave nets more than sell-back whenever BAH/BAS > 0 (netDifference positive)", () => {
    const r = calc.compareLeaveSellBack({ basePay: 5000, bah: 2000, bas: 460, days: 20 });
    expect(r.netDifference).toBeGreaterThan(0);
  });
  it("with zero BAH/BAS the two options are equal", () => {
    const r = calc.compareLeaveSellBack({ basePay: 5000, bah: 0, bas: 0, days: 20 });
    expect(r.netDifference).toBe(0);
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

describe("computeMilestones", () => {
  const today = new Date("2026-07-26T00:00:00");
  const sep = new Date("2027-06-30T00:00:00");
  const basePlan = {
    transType: "Retirement",
    yos: 20,
    leaveDays: 60,
    ptdy: true,
    ptdyDays: 20,
    sb: true,
    sbDays: 90,
    vaClaim: false,
    giBill: false,
    married: false,
    hasDependents: false,
    clearance: false,
  };
  const byLabel = (milestones: any[], label: string) => milestones.find((m) => m.label === label);

  it("chains SkillBridge -> PTDY -> terminal leave back-to-back into separation", () => {
    const r = calc.computeMilestones(basePlan, today, sep);
    expect(calc.daysBetween(r.termStart, sep)).toBe(basePlan.leaveDays);
    expect(calc.daysBetween(r.ptdyStart, r.ptdyEnd)).toBe(basePlan.ptdyDays);
    expect(calc.daysBetween(r.sbStart, r.sbEnd)).toBe(basePlan.sbDays);
    expect(r.ptdyEnd).toEqual(r.termStart); // PTDY runs right up to terminal leave
    expect(r.sbEnd).toEqual(r.ptdyStart); // SkillBridge runs right up to PTDY
  });

  it("TAP deadline is 365 days before separation for BOTH retirement and separation (10 U.S.C. 1142)", () => {
    const ret = calc.computeMilestones(basePlan, today, sep);
    const sep2 = calc.computeMilestones({ ...basePlan, transType: "Separation", yos: 8 }, today, sep);
    expect(calc.daysBetween(byLabel(ret.milestones, "TAP Must Begin By").date, sep)).toBe(365);
    expect(calc.daysBetween(byLabel(sep2.milestones, "TAP Must Begin By").date, sep)).toBe(365);
  });

  it("TRICARE enrollment window closes 90 days AFTER separation, not before", () => {
    const r = calc.computeMilestones(basePlan, today, sep);
    const m = byLabel(r.milestones, "TRICARE Enrollment Window Closes");
    expect(calc.daysBetween(sep, m.date)).toBe(90); // positive => after sep, not before
  });

  it("only produces retirement-only milestones (First Retirement Pay, SBP window) when transType is Retirement", () => {
    const ret = calc.computeMilestones(basePlan, today, sep);
    const sep2 = calc.computeMilestones({ ...basePlan, transType: "Separation", yos: 8 }, today, sep);
    expect(byLabel(ret.milestones, "First Retirement Pay")).toBeTruthy();
    expect(byLabel(sep2.milestones, "First Retirement Pay")).toBeFalsy();
    expect(byLabel(ret.milestones, "SBP Withdrawal Window Opens")).toBeTruthy();
    expect(byLabel(sep2.milestones, "SBP Withdrawal Window Closes")).toBeFalsy();
  });

  it("GI Bill TEB milestone only appears under 16 YOS — a 20-YOS retiree is categorically ineligible to transfer", () => {
    const ineligible = calc.computeMilestones({ ...basePlan, giBill: true, yos: 20 }, today, sep);
    const eligible = calc.computeMilestones({ ...basePlan, giBill: true, yos: 12, transType: "Separation" }, today, sep);
    expect(byLabel(ineligible.milestones, "GI Bill Transfer (TEB) — Approve Before 16 Years of Service")).toBeFalsy();
    expect(byLabel(eligible.milestones, "GI Bill Transfer (TEB) — Approve Before 16 Years of Service")).toBeTruthy();
  });

  it("CRDP/CRSC open season only appears for Retirement + a VA claim, dated Jan 1 (not Dec 1)", () => {
    const r = calc.computeMilestones({ ...basePlan, vaClaim: true }, today, sep);
    const noClaim = calc.computeMilestones(basePlan, today, sep);
    const m = byLabel(r.milestones, "CRDP/CRSC Open Season (Jan 1–31)");
    expect(m).toBeTruthy();
    expect(m.date.getMonth()).toBe(0); // January, not December
    expect(m.date.getDate()).toBe(1);
    expect(byLabel(noClaim.milestones, "CRDP/CRSC Open Season (Jan 1–31)")).toBeFalsy();
  });

  it("CRDP/CRSC open season rolls to next year once this year's Jan 31 window has passed", () => {
    const lateInYear = new Date("2026-03-01T00:00:00"); // already past this year's Jan 31 window
    const r = calc.computeMilestones({ ...basePlan, vaClaim: true }, lateInYear, sep);
    const m = byLabel(r.milestones, "CRDP/CRSC Open Season (Jan 1–31)");
    expect(m.date.getFullYear()).toBe(2027);
  });

  it("retirees get a 3-year final-move deadline plus a separate 1-year free-storage deadline; separatees get neither, only a 180-day shipment deadline", () => {
    const ret = calc.computeMilestones(basePlan, today, sep);
    const sep2 = calc.computeMilestones({ ...basePlan, transType: "Separation", yos: 8 }, today, sep);
    expect(calc.daysBetween(sep, byLabel(ret.milestones, "HHG Free Storage Deadline (1 yr)").date)).toBe(365);
    expect(calc.daysBetween(sep, byLabel(ret.milestones, "Final Move / HHG Shipment Deadline (3 yrs)").date)).toBe(3 * 365);
    expect(byLabel(sep2.milestones, "Final Move / HHG Shipment Deadline (3 yrs)")).toBeFalsy();
    expect(calc.daysBetween(sep, byLabel(sep2.milestones, "HHG Shipment Deadline (180 days)").date)).toBe(180);
  });

  it("returns milestones sorted chronologically", () => {
    const r = calc.computeMilestones({ ...basePlan, vaClaim: true, giBill: true, married: true, clearance: true }, today, sep);
    for (let i = 1; i < r.milestones.length; i++) {
      expect(r.milestones[i].date.getTime()).toBeGreaterThanOrEqual(r.milestones[i - 1].date.getTime());
    }
  });
});

describe("classifyDayMeter", () => {
  it("reports no combined cap at all when SkillBridge isn't in use, regardless of total", () => {
    expect(calc.classifyDayMeter(170, false).level).toBe("none");
    expect(calc.classifyDayMeter(0, false).level).toBe("none");
  });
  it("is 'success' at and below 150 days (SkillBridge active)", () => {
    expect(calc.classifyDayMeter(0, true).level).toBe("success");
    expect(calc.classifyDayMeter(150, true).level).toBe("success");
  });
  it("is 'warning' strictly between 150 and 180 days", () => {
    expect(calc.classifyDayMeter(151, true).level).toBe("warning");
    expect(calc.classifyDayMeter(180, true).level).toBe("warning");
  });
  it("is 'danger' above 180 days", () => {
    expect(calc.classifyDayMeter(181, true).level).toBe("danger");
  });
  it("caps the progress-bar percentage at 100 even when over the limit", () => {
    expect(calc.classifyDayMeter(250, true).pct).toBe(100);
    expect(calc.classifyDayMeter(90, true).pct).toBe(50);
  });
});
