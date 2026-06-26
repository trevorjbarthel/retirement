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
});
