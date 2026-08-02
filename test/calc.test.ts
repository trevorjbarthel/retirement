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
    expect(calc.VA_RATES[100]).toBe(3938.58);
    expect(calc.VA_RATES[30]).toBe(552.47); // pins a mid-bracket so vintage drift is caught
    expect(calc.VA_RATES[10]).toBe(180.42);
  });
  it("the pay-table vintage label is derived from the data, never hardcoded", () => {
    // The January refresh workflow only commits the generated pay files, so a hand-typed
    // label would keep claiming the old year while the app computed the new one.
    expect(calc.PAY_TABLE_YEAR).toBe(Math.max(...calc.PAY_TABLE_YEARS));
    expect(calc.DATA_VINTAGE.basePay).toContain(String(calc.PAY_TABLE_YEAR));
  });
  it("every state carrying a lastVerified stamp uses YYYY-MM", () => {
    for (const [code, d] of Object.entries(calc.STATE_TAX_DATA) as [string, any][]) {
      if (d.lastVerified !== undefined) {
        expect(d.lastVerified, `${code} lastVerified`).toMatch(/^\d{4}-\d{2}$/);
      }
    }
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
  it("life-expectancy periods come from the real IRS Single Life table", () => {
    // Pinned against Treas. Reg. § 1.401(a)(9)-9(b). The previous table was six points that
    // were all exactly 92.5 − age — an invented straight line the UI attributed to the IRS,
    // understating the age-55 installment by ~19% because the period is the DIVISOR.
    expect(calc.getLifeExpDistributionPeriod(55)).toBe(31.6);
    expect(calc.getLifeExpDistributionPeriod(50)).toBe(36.2);
    expect(calc.getLifeExpDistributionPeriod(65)).toBe(22.9);
    expect(calc.getLifeExpDistributionPeriod(70)).toBe(18.8);
    // Not a straight line any more — the regression guard for the old fake table.
    for (const age of [45, 55, 65]) {
      expect(calc.getLifeExpDistributionPeriod(age)).not.toBe(92.5 - age);
    }
  });
  it("both age tables clamp to the same [38, 70] range and never emit NaN", () => {
    expect(calc.getLifeExpDistributionPeriod(20)).toBe(calc.getLifeExpDistributionPeriod(38));
    expect(calc.getLifeExpDistributionPeriod(99)).toBe(calc.getLifeExpDistributionPeriod(70));
    expect(calc.interpolateAnnuityFactor(20)).toBe(calc.interpolateAnnuityFactor(38));
    expect(Number.isFinite(calc.getLifeExpDistributionPeriod(NaN))).toBe(true);
    expect(Number.isFinite(calc.interpolateAnnuityFactor(undefined as any))).toBe(true);
  });
  it("interpolates fractional ages between adjacent table entries", () => {
    const v = calc.getLifeExpDistributionPeriod(55.5);
    expect(v).toBeGreaterThan(30.6);
    expect(v).toBeLessThan(31.6);
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
    expect(r.vaComp).toBe(calc.VA_RATES[50]);
    expect(r.waived).toBeCloseTo(calc.VA_RATES[50], 2);
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

  it("splits the VA claim into the real BDD window and never dates it 12 months out", () => {
    const r = calc.computeMilestones({ ...basePlan, vaClaim: true }, today, sep);
    // sep-365 rendered 'past'/overdue for every user inside a year, for a window VA will
    // not even open until sep-180.
    expect(byLabel(r.milestones, "VA Claim Recommended By")).toBeFalsy();
    const opens = byLabel(r.milestones, "BDD Filing Window Opens (earliest VA accepts)");
    const closes = byLabel(r.milestones, "BDD Filing Window Closes");
    expect(calc.daysBetween(opens.date, sep)).toBe(180);
    expect(calc.daysBetween(closes.date, sep)).toBe(90);
  });

  it("returns the 12-month VA prep item as an advisory, not a deadline", () => {
    const r = calc.computeMilestones({ ...basePlan, vaClaim: true }, today, sep);
    expect(r.advisories.length).toBe(1);
    expect(calc.daysBetween(r.advisories[0].date, sep)).toBe(365);
    // Critically, it is NOT in `milestones`, so nothing runs it through milestoneStatus().
    expect(r.milestones.some((m: any) => m.date.getTime() === r.advisories[0].date.getTime()
      && m.label.toLowerCase().includes("va claim"))).toBe(false);
    expect(calc.computeMilestones(basePlan, today, sep).advisories).toEqual([]);
  });

  it("anchors the TEB deadline to the 16-year mark, not to the separation date", () => {
    const r = calc.computeMilestones({ ...basePlan, giBill: true, yos: 12, transType: "Separation" }, today, sep);
    const m = byLabel(r.milestones, "GI Bill Transfer (TEB) — Approve Before 16 Years of Service");
    // 4 years of service remaining from today — and well before separation, which is the
    // point: anchoring to `sep` put the deadline after the member was already ineligible.
    expect(calc.daysBetween(today, m.date)).toBeGreaterThan(3.9 * 365);
    expect(calc.daysBetween(today, m.date)).toBeLessThan(4.1 * 365);
  });

  it("gates retiree-only entitlements: FEDVIP and MIC3 never appear for a separatee", () => {
    const sepPlan = { ...basePlan, transType: "Separation", yos: 8, married: true, hasDependents: true };
    const sep2 = calc.computeMilestones(sepPlan, today, sep);
    const ret = calc.computeMilestones({ ...basePlan, married: true, hasDependents: true }, today, sep);
    expect(byLabel(ret.milestones, "FEDVIP Dental/Vision Enrollment Closes")).toBeTruthy();
    expect(byLabel(sep2.milestones, "FEDVIP Dental/Vision Enrollment Closes")).toBeFalsy();
    expect(byLabel(ret.milestones, "MIC3 School-Compact Protection Ends")).toBeTruthy();
    expect(byLabel(sep2.milestones, "MIC3 School-Compact Protection Ends")).toBeFalsy();
  });

  it("gives a separatee TAMP + the unrecoverable CHCBP deadline instead of the retiree TRICARE window", () => {
    const sep2 = calc.computeMilestones({ ...basePlan, transType: "Separation", yos: 8 }, today, sep);
    expect(byLabel(sep2.milestones, "TRICARE Enrollment Window Closes")).toBeFalsy();
    expect(calc.daysBetween(sep, byLabel(sep2.milestones, "TAMP Coverage Ends (if eligible)").date)).toBe(180);
    // 60 days after TAMP ends. Missing it cannot be undone — there is no late enrollment.
    expect(calc.daysBetween(sep, byLabel(sep2.milestones, "CHCBP Purchase Deadline").date)).toBe(240);
  });

  it("halves the free-storage window for a separatee (180 days, not a year)", () => {
    const sep2 = calc.computeMilestones({ ...basePlan, transType: "Separation", yos: 8 }, today, sep);
    expect(byLabel(sep2.milestones, "HHG Free Storage Deadline (1 yr)")).toBeFalsy();
    expect(calc.daysBetween(sep, byLabel(sep2.milestones, "HHG Free Storage Deadline (180 days)").date)).toBe(180);
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

describe("compareScenarios", () => {
  const today = new Date("2026-08-01T00:00:00");
  const base = {
    firstName: "Pat", branch: "Army", rankCat: "E", rank: "E-7 Sergeant First Class",
    transType: "Retirement", yos: 20, sepDate: "2027-06-30", dateOfRank: "",
    leaveDays: 60, ptdy: true, ptdyDays: 20, sb: true, sbDays: 90,
    vaClaim: false, giBill: false, married: false, hasDependents: false,
    clearance: false, federalJob: false, oconus: false, homeowner: false,
    postLocation: "", payRetSystem: "high3",
  };

  it("shows a higher multiplier and more retired pay for staying an extra year", () => {
    const later = { ...base, sepDate: "2028-06-30", yos: 21 };
    const r = calc.compareScenarios(base, later, today)!;
    expect(r.deltas.yos).toBe(1);
    expect(r.deltas.multiplierPct).toBeCloseTo(2.5, 1); // one more year at 2.5%/yr
    expect(r.deltas.retiredPayMonthly).toBeGreaterThan(0);
    expect(r.deltas.days).toBeGreaterThan(360);
  });

  it("prices the extra active-duty time, splitting taxable pay from tax-free allowances", () => {
    const later = { ...base, sepDate: "2028-06-30", yos: 21 };
    const r = calc.compareScenarios(base, later, today, { monthlyAllowances: 2400 })!;
    expect(r.deltas.activeDutyBaseDelta).toBeGreaterThan(0);
    // ~12 months of allowances.
    expect(r.deltas.activeDutyAllowanceDelta).toBeGreaterThan(2400 * 11);
    expect(r.deltas.activeDutyAllowanceDelta).toBeLessThan(2400 * 13);
  });

  it("reports negatives when the alternative is EARLIER", () => {
    const earlier = { ...base, sepDate: "2026-12-31", yos: 20 };
    const r = calc.compareScenarios(base, earlier, today)!;
    expect(r.deltas.days).toBeLessThan(0);
    expect(r.deltas.activeDutyBaseDelta).toBeLessThan(0);
  });

  it("is all-schedule, no-money when years of service don't change", () => {
    const shifted = { ...base, sepDate: "2027-09-30", yos: 20 };
    const r = calc.compareScenarios(base, shifted, today)!;
    expect(r.deltas.yos).toBe(0);
    expect(r.deltas.multiplierPct).toBe(0);
    expect(r.deltas.retiredPayMonthly).toBe(0);
    // …but the schedule genuinely moves.
    expect(r.b.terminalLeaveStart.getTime()).toBeGreaterThan(r.a.terminalLeaveStart.getTime());
  });

  it("projects the lifetime figure as a plain multiple, not a present value", () => {
    const later = { ...base, sepDate: "2028-06-30", yos: 21 };
    const r = calc.compareScenarios(base, later, today)!;
    expect(r.deltas.retiredPayOver20Years).toBe(r.deltas.retiredPayMonthly * 12 * 20);
  });

  it("computes no retired-pay delta for a separation (there is none to change)", () => {
    const sepPlan = { ...base, transType: "Separation", yos: 8, sepDate: "2027-06-30" };
    const later = { ...sepPlan, sepDate: "2028-06-30", yos: 9 };
    const r = calc.compareScenarios(sepPlan, later, today)!;
    expect(r.a.retiredPayMonthly).toBe(0);
    expect(r.deltas.retiredPayMonthly).toBe(0);
    expect(r.a.isRetirement).toBe(false);
  });

  it("returns null on an unusable date rather than throwing", () => {
    expect(calc.compareScenarios(base, { ...base, sepDate: "nope" }, today)).toBeNull();
  });
});

describe("buildPhases", () => {
  const today = new Date("2026-08-01T00:00:00");
  const sep = new Date("2027-06-30T00:00:00");
  const plan = (o: Record<string, unknown> = {}) => ({
    transType: "Retirement", yos: 22, leaveDays: 60, ptdy: true, ptdyDays: 20,
    sb: true, sbDays: 90, vaClaim: false, giBill: false, married: false,
    hasDependents: false, clearance: false, federalJob: false, oconus: false,
    homeowner: false, postLocation: "", payRetSystem: "high3", ...o,
  });
  const dates = (s: any) => {
    const m = calc.computeMilestones(s, today, sep);
    return { today, sep, termStart: m.termStart, ptdyStart: m.ptdyStart, ptdyEnd: m.ptdyEnd,
      sbStart: m.sbStart, sbEnd: m.sbEnd, tapDeadline: m.tapDeadline };
  };
  const allTasks = (s: any) => calc.buildPhases(s, dates(s)).flatMap((p: any) => p.tasks);

  it("task ids are unique within a plan — a duplicate silently merges two checkboxes", () => {
    // Progress is keyed BY TASK ID, so a duplicate makes ticking one box tick another.
    for (const s of [
      plan(), plan({ sb: false }), plan({ transType: "Separation", yos: 8 }),
      plan({ vaClaim: true, giBill: true, married: true, hasDependents: true, clearance: true, federalJob: true, oconus: true, homeowner: true }),
      plan({ payRetSystem: "brs" }), plan({ payRetSystem: "redux" }),
    ]) {
      const ids = allTasks(s).map((t: any) => t.id);
      expect(new Set(ids).size, `duplicate task id in ${JSON.stringify({ sb: s.sb, transType: s.transType })}`).toBe(ids.length);
    }
  });

  it("phase ids are unique and every phase has a name, a date range, and tasks", () => {
    const phases = calc.buildPhases(plan(), dates(plan()));
    const ids = phases.map((p: any) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of phases) {
      expect(p.name).toBeTruthy();
      expect(p.from instanceof Date && !isNaN(p.from.getTime())).toBe(true);
      expect(p.to instanceof Date && !isNaN(p.to.getTime())).toBe(true);
      // A phase whose range reads backwards ("Aug 2 — Jun 3") is a display bug.
      expect(p.to.getTime(), `${p.id} range is inverted`).toBeGreaterThanOrEqual(p.from.getTime());
      expect(p.tasks.length).toBeGreaterThan(0);
      for (const t of p.tasks) {
        expect(typeof t.id).toBe("string");
        expect(t.id).toMatch(/^[a-z0-9][a-z0-9-]*$/); // must satisfy the checks-map key rule
        expect(typeof t.text).toBe("string");
        expect(t.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("every task id is a legal checks-map key, so progress can actually be saved", () => {
    // A task id that fails PLAN_FIELDS.checks' key rule would 400 every save the moment
    // someone ticked it — the drift that costs a user their data.
    const s = plan({ vaClaim: true, giBill: true, married: true, hasDependents: true, clearance: true, federalJob: true, oconus: true, homeowner: true });
    const checks: Record<string, boolean> = {};
    for (const t of allTasks(s)) checks[t.id] = true;
    expect(calc.isValidState({
      firstName: "Pat", branch: "Army", rankCat: "E", yos: 22,
      transType: "Retirement", sepDate: "2027-06-30", checks,
    })).toBe(true);
  });

  it("gives a retiree Phase 7 and a separatee none", () => {
    expect(calc.buildPhases(plan(), dates(plan())).some((p: any) => p.id === "p7")).toBe(true);
    const sepPlan = plan({ transType: "Separation", yos: 8 });
    expect(calc.buildPhases(sepPlan, dates(sepPlan)).some((p: any) => p.id === "p7")).toBe(false);
  });

  it("swaps Phase 3 between SkillBridge prep and job search", () => {
    const withSb = calc.buildPhases(plan(), dates(plan())).find((p: any) => p.id === "p3")!;
    const noSb = calc.buildPhases(plan({ sb: false }), dates(plan({ sb: false }))).find((p: any) => p.id === "p3")!;
    expect(withSb.name).toContain("SkillBridge");
    expect(noSb.name).toContain("Job Search");
    expect(withSb.tasks.some((t: any) => t.id === "sb-research")).toBe(true);
    expect(noSb.tasks.some((t: any) => t.id === "sb-research")).toBe(false);
  });

  it("gates retiree-only tasks and gives separatees the CHCBP ones instead", () => {
    const ret = allTasks(plan()).map((t: any) => t.id);
    const sepIds = allTasks(plan({ transType: "Separation", yos: 8 })).map((t: any) => t.id);
    expect(ret).toContain("fedvip");
    expect(ret).toContain("sbp-election");
    expect(sepIds).not.toContain("fedvip");
    expect(sepIds).not.toContain("sbp-election");
    // The deadline a separatee cannot recover from.
    expect(sepIds).toContain("chcbp-research");
    expect(sepIds).toContain("chcbp-purchase");
  });

  it("adds conditional tasks only when their flag is set", () => {
    const off = allTasks(plan()).map((t: any) => t.id);
    const on = allTasks(plan({ vaClaim: true, federalJob: true, oconus: true, clearance: true, married: true })).map((t: any) => t.id);
    for (const id of ["vso", "vre", "fed-packet", "pov-return", "diss-record", "spouse-seco"]) {
      expect(off, `${id} should be absent`).not.toContain(id);
      expect(on, `${id} should be present`).toContain(id);
    }
  });
});

describe("migrateChecks", () => {
  const s = { sb: true, transType: "Retirement" } as any;

  it("maps every legacy index key onto a task that still exists", () => {
    // 60 legacy ids, and nothing asserted they still resolved. A renamed task would have
    // silently dropped a returning user's progress for that item.
    const today = new Date("2026-08-01T00:00:00");
    const sep = new Date("2027-06-30T00:00:00");
    for (const sb of [true, false]) {
      const plan: any = { transType: "Retirement", yos: 22, leaveDays: 60, ptdy: true, ptdyDays: 20,
        sb, sbDays: 90, vaClaim: true, giBill: true, married: true, hasDependents: true,
        clearance: true, federalJob: true, oconus: true, homeowner: true, postLocation: "", payRetSystem: "high3" };
      const m = calc.computeMilestones(plan, today, sep);
      const real = new Set(calc.buildPhases(plan, {
        today, sep, termStart: m.termStart, ptdyStart: m.ptdyStart, ptdyEnd: m.ptdyEnd,
        sbStart: m.sbStart, sbEnd: m.sbEnd, tapDeadline: m.tapDeadline,
      }).flatMap((p: any) => p.tasks).map((t: any) => t.id));
      for (const [phase, ids] of Object.entries(calc.legacyTaskIds(plan)) as [string, string[]][]) {
        ids.forEach((id, i) => {
          expect(real.has(id), `legacy ${phase}-${i} → "${id}" no longer exists`).toBe(true);
        });
      }
    }
  });

  it("converts index keys to stable ids and leaves modern keys alone", () => {
    expect(calc.migrateChecks({ "p1-0": true }, s)).toEqual({ "finance-plan": true });
    expect(calc.migrateChecks({ "finance-plan": true }, s)).toEqual({ "finance-plan": true });
    expect(calc.migrateChecks({}, s)).toEqual({});
    expect(calc.migrateChecks(null as any, s)).toEqual({});
  });

  it("passes through an unmapped index key rather than dropping it", () => {
    const out = calc.migrateChecks({ "p9-99": true, "p1-1": true }, s);
    expect(out["p9-99"]).toBe(true);
    expect(out["tsp-review"]).toBe(true);
  });
});

describe("CSB/REDUX", () => {
  it("pays 40% at 20 years and +3.5%/yr thereafter, not the High-3 ladder", () => {
    expect(calc.computeRetirementPay({ basePay: 10000, yos: 20, system: "redux" }).pct).toBeCloseTo(0.40, 4);
    // The headline case: a 24-year REDUX retiree earns 54%, not the 60% a High-3
    // assumption produces — ~$600/mo, permanently.
    expect(calc.computeRetirementPay({ basePay: 10000, yos: 24, system: "redux" }).monthly).toBe(5400);
    expect(calc.computeRetirementPay({ basePay: 10000, yos: 24, system: "high3" }).monthly).toBe(6000);
  });
  it("caps at 75%, the same ceiling High-3 reaches at 30 years", () => {
    expect(calc.computeRetirementPay({ basePay: 10000, yos: 30, system: "redux" }).pct).toBeCloseTo(0.75, 4);
    expect(calc.computeRetirementPay({ basePay: 10000, yos: 40, system: "redux" }).pct).toBeCloseTo(0.75, 4);
  });
  it("an unrecognised system falls back to High-3, never to BRS", () => {
    // The inline copy in index.html used `system === 'high3' ? 0.025 : 0.02`, the inverse of
    // calc.js's fallback, so a plan carrying any other value disagreed with itself on screen.
    expect(calc.computeRetirementPay({ basePay: 10000, yos: 20, system: "legacy" as any }).pct).toBeCloseTo(0.50, 4);
  });
});

describe("applyVAWaiver", () => {
  it("waives retired pay dollar-for-dollar below the CRDP threshold", () => {
    // 20-yr O-4 at 50% multiplier: $4,500 retired pay, 40% VA rating.
    const r = calc.applyVAWaiver({ grossRetiredPay: 4500, vaComp: calc.VA_RATES[40], yos: 20, rating: 40 });
    expect(r.crdpEligible).toBe(false);
    expect(r.waived).toBeCloseTo(795.84, 2);
    // The whole point: total income is unchanged, the rating is a tax-free SWAP.
    // The old inline `monthlyRet + vaComp` printed $5,295.84 — $9,550/yr too high.
    expect(r.total).toBeCloseTo(4500, 2);
  });
  it("restores the full waiver at 20+ years AND 50%+ (CRDP)", () => {
    const r = calc.applyVAWaiver({ grossRetiredPay: 4500, vaComp: calc.VA_RATES[50], yos: 20, rating: 50 });
    expect(r.crdpEligible).toBe(true);
    expect(r.waived).toBe(0);
    expect(r.total).toBeCloseTo(4500 + calc.VA_RATES[50], 2);
  });
  it("requires the 20-year test, not just the rating — the condition the UI omitted", () => {
    const r = calc.applyVAWaiver({ grossRetiredPay: 4500, vaComp: calc.VA_RATES[50], yos: 18, rating: 50 });
    expect(r.crdpEligible).toBe(false);
    expect(r.total).toBeCloseTo(4500, 2);
  });
  it("never waives more retired pay than exists", () => {
    const r = calc.applyVAWaiver({ grossRetiredPay: 500, vaComp: 3938.58, yos: 20, rating: 40 });
    expect(r.retiredPayAfterWaiver).toBe(0);
    expect(r.total).toBeCloseTo(3938.58, 2);
  });
  it("a separatee draws no retired pay, so there is nothing to waive", () => {
    const r = calc.applyVAWaiver({ grossRetiredPay: 0, vaComp: 1000, yos: 8, rating: 50, isRetirement: false });
    expect(r.total).toBe(1000);
    expect(r.waived).toBe(0);
  });
  it("agrees with compareConcurrentReceipt on the same inputs", () => {
    const a = calc.applyVAWaiver({ grossRetiredPay: 3000, vaComp: calc.VA_RATES[30], yos: 20, rating: 30 });
    const b = calc.compareConcurrentReceipt({ grossRetiredPay: 3000, vaRating: 30, yos: 20 });
    expect(a.waived).toBeCloseTo(b.waived, 2);
    expect(a.retiredPayAfterWaiver).toBeCloseTo(b.residualRetired, 2);
    expect(a.crdpEligible).toBe(b.crdpEligible);
  });
});

describe("vaCompensation (dependents)", () => {
  it("matches the veteran-alone table when there are no dependents", () => {
    for (const r of [0, 10, 30, 70, 100]) {
      expect(calc.vaCompensation({ rating: r })).toBeCloseTo(calc.VA_RATES[r], 2);
    }
  });
  it("pays a spouse allowance at 30% and above", () => {
    expect(calc.vaCompensation({ rating: 100, spouse: true })).toBeCloseTo(4158.17, 2);
    // The understatement being fixed: $219.59/mo for a married 100% retiree.
    expect(calc.vaCompensation({ rating: 100, spouse: true }) - calc.VA_RATES[100]).toBeCloseTo(219.59, 2);
  });
  it("pays NO dependent allowance below 30%, however large the household", () => {
    expect(calc.vaCompensation({ rating: 20, spouse: true, childrenU18: 3 })).toBe(calc.VA_RATES[20]);
    expect(calc.vaCompensation({ rating: 10, spouse: true })).toBe(calc.VA_RATES[10]);
  });
  it("counts the first child inside the published spouse+child rate, then adds the rest", () => {
    const one = calc.vaCompensation({ rating: 100, spouse: true, childrenU18: 1 });
    const two = calc.vaCompensation({ rating: 100, spouse: true, childrenU18: 2 });
    expect(one).toBeCloseTo(4318.99, 2);
    expect(two - one).toBeCloseTo(109.11, 2); // exactly one add-on, not two
  });
  it("handles a single parent with children (no spouse)", () => {
    expect(calc.vaCompensation({ rating: 30, childrenU18: 1 })).toBeCloseTo(596.47, 2);
    expect(calc.vaCompensation({ rating: 30, childrenU18: 2 })).toBeCloseTo(596.47 + 32, 2);
  });
  it("adds spouse Aid & Attendance only when there is a spouse", () => {
    expect(calc.vaCompensation({ rating: 100, spouse: true, spouseAidAttendance: true })).toBeCloseTo(4158.17 + 201.41, 2);
    expect(calc.vaCompensation({ rating: 100, spouseAidAttendance: true })).toBeCloseTo(3938.58, 2);
  });
  it("returns 0 for a rating that is not a real bracket", () => {
    expect(calc.vaCompensation({ rating: 45 })).toBe(0);
  });
});

describe("computeHigh3", () => {
  it("averages the highest 36 months rather than multiplying current pay", () => {
    const r = calc.computeHigh3({ grade: "E-7", yos: 20, sepDate: "2026-12-31" })!;
    expect(r).not.toBeNull();
    expect(r.monthsSampled).toBe(36);
    // A member crossing the 18→20 longevity step inside the window averages BELOW current pay.
    const current = calc.getBasePay2026("E-7", 20)!;
    expect(r.monthly).toBeLessThan(current);
    expect(r.monthly).toBeGreaterThan(0);
  });
  it("estimates pre-promotion months one grade down and flags it", () => {
    const promotedRecently = calc.computeHigh3({ grade: "E-7", yos: 20, sepDate: "2026-12-31", dateOfRank: "2025-06-01" })!;
    const longInGrade = calc.computeHigh3({ grade: "E-7", yos: 20, sepDate: "2026-12-31", dateOfRank: "2015-06-01" })!;
    expect(promotedRecently.promotionInWindow).toBe(true);
    expect(longInGrade.promotionInWindow).toBe(false);
    // A recent promotion means a materially lower High-3 — the bias being corrected.
    expect(promotedRecently.monthly).toBeLessThan(longInGrade.monthly);
  });
  it("reports when it had to borrow another year's pay table", () => {
    // Only 2026 is committed today, so a 2026 separation must borrow for 2024/2025 months.
    const r = calc.computeHigh3({ grade: "O-5", yos: 22, sepDate: "2026-09-30" })!;
    expect(r.estimatedFromSingleYear).toBe(true);
    expect(r.yearsUsed).toContain(2026);
  });
  it("returns null for an unusable date or unknown grade", () => {
    expect(calc.computeHigh3({ grade: "E-7", yos: 20, sepDate: "not-a-date" })).toBeNull();
    expect(calc.computeHigh3({ grade: "X-9", yos: 20, sepDate: "2026-12-31" })).toBeNull();
  });
});

describe("getBasePayForYear", () => {
  it("reports whether the requested year was an exact table hit", () => {
    expect(calc.getBasePayForYear(2026, "E-6", 12)!.exact).toBe(true);
    const borrowed = calc.getBasePayForYear(2019, "E-6", 12)!;
    expect(borrowed.exact).toBe(false);
    expect(borrowed.year).toBe(2026);
  });
  it("falls to the lowest bracket rather than NaN on unusable YOS", () => {
    expect(calc.getBasePayForYear(2026, "E-6", NaN as any)!.pay).toBe(calc.getBasePay2026("E-6", 0));
  });
});

describe("federalIncomeTax + requiredCivilianSalary", () => {
  it("applies 2026 brackets progressively, not as a flat top rate", () => {
    expect(calc.federalIncomeTax(0)).toBe(0);
    // First bracket only.
    expect(calc.federalIncomeTax(10000, "single")).toBeCloseTo(1000, 2);
    // Straddling 10% and 12%.
    expect(calc.federalIncomeTax(20000, "single")).toBeCloseTo(12400 * 0.1 + 7600 * 0.12, 2);
    expect(calc.federalIncomeTax(100000, "joint")).toBeLessThan(calc.federalIncomeTax(100000, "single"));
  });
  it("requires MORE gross salary than base pay, because BAH/BAS are untaxed", () => {
    const r = calc.requiredCivilianSalary({ basePay: 7000, bah: 2400, bas: 476.95, stateCode: "TX", filing: "single" });
    expect(r.requiredSalary).toBeGreaterThan(7000 * 12);
    expect(r.premiumOverBasePay).toBeGreaterThan(0);
    expect(r.taxFreeAllowancesAnnual).toBeCloseTo((2400 + 476.95) * 12, 0);
  });
  it("retired pay reduces the salary needed", () => {
    const base = { basePay: 7000, bah: 2400, bas: 476.95, stateCode: "TX" as const };
    const withPension = calc.requiredCivilianSalary({ ...base, retiredPayMonthly: 3500 });
    const without = calc.requiredCivilianSalary({ ...base, retiredPayMonthly: 0 });
    expect(withPension.requiredSalary!).toBeLessThan(without.requiredSalary!);
  });
  it("healthcare cost raises the salary needed", () => {
    const base = { basePay: 7000, bah: 2400, bas: 476.95, stateCode: "TX" as const };
    const withCost = calc.requiredCivilianSalary({ ...base, civilianHealthcareMonthly: 500 });
    const without = calc.requiredCivilianSalary({ ...base, civilianHealthcareMonthly: 0 });
    expect(withCost.requiredSalary!).toBeGreaterThan(without.requiredSalary!);
  });
  it("reports an employer 401k match separately and never folds it into take-home", () => {
    const withMatch = calc.requiredCivilianSalary({ basePay: 7000, bah: 2400, bas: 476.95, stateCode: "TX", employer401kMatchPct: 5 });
    const noMatch = calc.requiredCivilianSalary({ basePay: 7000, bah: 2400, bas: 476.95, stateCode: "TX", employer401kMatchPct: 0 });
    expect(withMatch.requiredSalary).toBe(noMatch.requiredSalary); // match does NOT lower the bar
    expect(withMatch.employer401kMatchAnnual).toBeGreaterThan(0);
  });
  it("a no-income-tax state needs less salary than a high-tax one", () => {
    const tx = calc.requiredCivilianSalary({ basePay: 7000, bah: 2400, bas: 476.95, stateCode: "TX" });
    const ca = calc.requiredCivilianSalary({ basePay: 7000, bah: 2400, bas: 476.95, stateCode: "CA" });
    expect(ca.requiredSalary!).toBeGreaterThan(tx.requiredSalary!);
  });
});

describe("leave sell-back cap (37 U.S.C. 501)", () => {
  it("refuses to price more than 60 career days as sellable", () => {
    const r = calc.compareLeaveSellBack({ basePay: 6000, bah: 1800, bas: 476.95, days: 90 });
    expect(r.sellableDays).toBe(60);
    expect(r.unsellableDays).toBe(30);
    expect(r.exceedsSellbackCap).toBe(true);
  });
  it("subtracts days already sold earlier in the career", () => {
    const r = calc.compareLeaveSellBack({ basePay: 6000, bah: 1800, bas: 476.95, days: 60, daysAlreadySold: 45 });
    expect(r.sellableDays).toBe(15);
    expect(r.exceedsSellbackCap).toBe(true);
  });
  it("is unaffected at or below the cap", () => {
    const r = calc.compareLeaveSellBack({ basePay: 6000, bah: 1800, bas: 476.95, days: 60 });
    expect(r.sellableDays).toBe(60);
    expect(r.exceedsSellbackCap).toBe(false);
  });
  it("reports a per-day premium — the comparison's only non-tautological output", () => {
    // Terminal leave always wins on take-home, so 'who wins' carries no information;
    // what a member can act on is what each extra day on active duty is worth.
    const r = calc.compareLeaveSellBack({ basePay: 6000, bah: 1800, bas: 476.95, days: 30 });
    expect(r.perDayAdvantage).toBeGreaterThan(0);
    expect(r.perDayAdvantage).toBeCloseTo((1800 + 476.95) / 30, 1);
  });
});

describe("tspKeepVsRoll fee drag is signed", () => {
  it("is positive when the TSP's low fee wins", () => {
    const r = calc.tspKeepVsRoll({ ageAtSeparation: 56, tradBalance: 200000, years: 20, advisoryFeePct: 1, tspFeePct: 0.05 });
    expect(r.feeDrag).toBeGreaterThan(0);
  });
  it("goes NEGATIVE when the rolled-out option is genuinely cheaper", () => {
    // The old Math.max(0, …) floor reported "could cost roughly $0" here, hiding a real win.
    const r = calc.tspKeepVsRoll({ ageAtSeparation: 56, tradBalance: 200000, years: 20, advisoryFeePct: 0.02, tspFeePct: 0.05 });
    expect(r.feeDrag).toBeLessThan(0);
  });
});

describe("buildICS hardening", () => {
  const mk = (label: string, d: Date) => ({ label, date: d });
  it("derives UIDs from date+label so toggling a plan flag cannot renumber events", () => {
    const a = calc.buildICS([mk("SkillBridge Start", new Date(2026, 5, 1)), mk("Terminal Leave Begins", new Date(2026, 7, 1))]);
    // Same plan minus the first milestone: the surviving event must keep its UID.
    const b = calc.buildICS([mk("Terminal Leave Begins", new Date(2026, 7, 1))]);
    const uidOf = (ics: string, n = 0) => ics.split("\r\n").filter((l) => l.startsWith("UID:"))[n];
    expect(uidOf(a, 1)).toBe(uidOf(b, 0));
    expect(uidOf(a, 0)).not.toBe(uidOf(a, 1));
  });
  it("folds content lines at 75 octets per RFC 5545", () => {
    const long = "A very long milestone label ".repeat(8);
    const ics = calc.buildICS([{ label: long, date: new Date(2026, 5, 1), description: long } as any]);
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // Continuation lines are marked with a single leading space.
    expect(ics).toMatch(/\r\n /);
  });
  it("strips control characters that could terminate a content line early", () => {
    // The feed serves a user-supplied name to third-party calendar clients, so a stray CR
    // must not be able to break out of its content line.
    const ics = calc.buildICS([{ label: "Sep\rDate X", date: new Date(2026, 5, 1) } as any],
      { calName: "Pat\r\nInjected" });
    expect(ics).not.toMatch(/\r(?!\n)/);
    expect(ics).toContain("SUMMARY:SepDateX");
    expect(ics).toContain("X-WR-CALNAME:Pat\\n");
  });

  it("keeps multi-byte characters intact across a fold", () => {
    const ics = calc.buildICS([{ label: "🎖️".repeat(40), date: new Date(2026, 5, 1) } as any]);
    expect(ics).toContain("🎖️");
  });
});

describe("parseStateFromLocation with real-world addresses", () => {
  it("accepts a trailing ZIP — the most common way an American writes an address", () => {
    expect(calc.parseStateFromLocation("San Antonio, TX 78205")).toBe("TX");
    expect(calc.parseStateFromLocation("Norfolk, VA 23511-1234")).toBe("VA");
  });
  it("accepts a trailing country", () => {
    expect(calc.parseStateFromLocation("Tampa, FL 33601, USA")).toBe("FL");
    expect(calc.parseStateFromLocation("Tacoma, WA, United States")).toBe("WA");
  });
  it("still resolves a full state name followed by a ZIP", () => {
    expect(calc.parseStateFromLocation("Austin, Texas 78701")).toBe("TX");
  });
  it("does not mistake the first two letters of a spelled-out state for a code", () => {
    expect(calc.parseStateFromLocation("Kansas City, Missouri")).toBe("MO");
  });
});

describe("sanitizeState", () => {
  const good = {
    firstName: "Pat", rankCat: "O", yos: 18,
    transType: "Retirement", sepDate: "2027-06-01", branch: "Navy",
  };
  it("drops unknown keys instead of persisting them", () => {
    const out = calc.sanitizeState({ ...good, evilPayload: "x".repeat(1000), __proto__: { polluted: true } } as any)!;
    expect(out).not.toBeNull();
    expect("evilPayload" in out).toBe(false);
    expect(Object.keys(out).sort()).toEqual(Object.keys(good).sort());
  });
  it("keeps every field the setup form actually writes", () => {
    const full = {
      ...good, rank: "O-4 Major", dateOfRank: "2020-05-01", todayDate: "2026-08-01",
      leaveDays: 60, ptdy: true, ptdyDays: 20, sb: true, sbDays: 90,
      postLocation: "San Antonio, TX", careerInterest: "Technology/Cybersecurity",
      giBill: true, vaClaim: true, married: true, homeowner: false, clearance: true,
      federalJob: false, oconus: false, payRetSystem: "redux", selectedVARating: 50,
      hasDependents: true, tspBalance: 250000, tspYearsToRet: 15, tspRate: 6,
      tspContribMode: "fixed", tspContribution: 800, tspContribPct: 5, tspRetAge: 45,
      tspWithdrawalMethod: "life", tspFixedAmount: 1500, payBasePay: 9000, bah: 2400,
      checks: { "finance-plan": true }, tools: { dtSbpBase: "4500" },
    };
    const out = calc.sanitizeState(full as any)!;
    expect(out).not.toBeNull();
    expect(Object.keys(out).sort()).toEqual(Object.keys(full).sort());
    expect(calc.isValidState(full)).toBe(true);
  });
  it("validates payRetSystem — the field the UI wrote but the validator never knew about", () => {
    expect(calc.isValidState({ ...good, payRetSystem: "redux" })).toBe(true);
    expect(calc.isValidState({ ...good, payRetSystem: "high3" })).toBe(true);
    expect(calc.isValidState({ ...good, payRetSystem: "nonsense" })).toBe(false);
  });
  it("bounds the checks and tools maps", () => {
    expect(calc.isValidState({ ...good, checks: { "a-task": true } })).toBe(true);
    expect(calc.isValidState({ ...good, checks: { "a-task": "yes" } })).toBe(false);
    expect(calc.isValidState({ ...good, checks: { "<script>": true } })).toBe(false);
    expect(calc.isValidState({ ...good, tools: { dtSbpBase: "x".repeat(65) } })).toBe(false);
    // The decision-tool map mixes input strings with checkbox BOOLEANS — a string-only
    // rule would 400 every save the moment someone ticks Prime-vs-Select.
    expect(calc.isValidState({ ...good, tools: { dtSbpBase: "4500", dtPsLowCost: true, dtPsFlex: false } })).toBe(true);
    expect(calc.isValidState({ ...good, tools: { dtSbpBase: { nested: 1 } } })).toBe(false);
    expect(calc.isValidState({ ...good, tools: { "bad key": "1" } })).toBe(false);
    const tooMany: Record<string, boolean> = {};
    for (let i = 0; i < 401; i++) tooMany[`task-${i}`] = true;
    expect(calc.isValidState({ ...good, checks: tooMany })).toBe(false);
  });
  it("returns null for a plan missing a required field", () => {
    expect(calc.sanitizeState({ rankCat: "O" } as any)).toBeNull();
    expect(calc.sanitizeState(null as any)).toBeNull();
  });
});
