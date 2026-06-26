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
