// DOM-layer tests: the seams between the setup form, the plan state, the results tabs and the
// decision tools — the places where a value on screen can silently stop matching the plan.
// calc.js is covered by test/calc.test.ts; these tests exercise what happens around it.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Static imports: none of these modules touches the DOM at import time (app.js, which does,
// is deliberately not imported), and setup.ts has already put index.html into the document
// by the time test bodies run. Nine concurrent dynamic import()s here were flaky under Vitest.
import * as dom from "/js/dom.js";
import * as setup from "/js/setup-form.js";
import * as planio from "/js/plan-io.js";
import * as results from "/js/results.js";
import * as tabs from "/js/tabs.js";
import * as tools from "/js/decision-tools.js";
import * as pay from "/js/pay-estimator.js";
import * as calc from "/js/calc.js";
import { ui } from "/js/ui-state.js";

async function boot() {
  // Wire every feature the way app.js's init() does, minus loadInitialPlan().
  const wireAll = () => { setup.wireSetupForm(); planio.wirePlanIO(); results.wireResults(); tabs.wireTabs(); pay.wirePayEstimator(); tools.wireDecisionTools(); };
  return { dom, setup, planio, results, tabs, tools, pay, ui: ui as any, calc, wireAll };
}

const samplePlan = () => ({
  firstName: "Sam", branch: "Army", rankCat: "E", rank: "E-7 Sergeant First Class",
  yos: 21, dateOfRank: "2022-06-01", transType: "Retirement", sepDate: "2028-01-01", todayDate: "2026-09-10",
  leaveDays: 60, bah: 2400, ptdy: true, ptdyDays: 20, sb: true, sbDays: 90,
  postLocation: "San Antonio, TX 78205", careerInterest: "Technology/Cybersecurity",
  giBill: true, vaClaim: true, married: true, homeowner: true, clearance: true, federalJob: false, oconus: false,
  payRetSystem: "high3", selectedVARating: 50, hasDependents: true, tspBalance: 320000, tspRate: 6,
  tspContribMode: "fixed", tspContribution: 800, tspContribPct: 5, tspRetAge: 60, tspWithdrawalMethod: "fixed", tspFixedAmount: 1500,
});

const $ = (id: string) => document.getElementById(id) as any;
// Two frames, then a macrotask: enough for a requestAnimationFrame-coalesced render to land.
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));
const fire = (el: any, type: string) => el.dispatchEvent(new Event(type, { bubbles: true }));

describe("setup form ↔ plan state round trip", () => {
  it("Edit My Info restores every field the form owns, and buildState reads them back unchanged", async () => {
    const { setup, planio, ui, wireAll } = await boot();
    wireAll();
    const plan = samplePlan();
    planio.applyLoadedPlan(plan);
    // Round-trip through the form exactly as the Edit button does.
    $("editBtn").click();
    await new Promise((r) => setTimeout(r, 80)); // the rank restore is deferred behind populateRanks()
    expect($("firstName").value).toBe("Sam");
    expect($("rank").value).toBe("E-7 Sergeant First Class");
    expect($("sbDays").value).toBe("90");
    expect($("bah").value).toBe("2400");
    expect($("postLocation").value).toBe("San Antonio, TX 78205");
    const rebuilt = setup.buildState();
    for (const k of ["firstName", "branch", "rankCat", "rank", "yos", "dateOfRank", "transType", "sepDate", "leaveDays", "bah", "ptdy", "ptdyDays", "sb", "sbDays", "postLocation", "careerInterest", "giBill", "vaClaim", "married", "homeowner", "clearance", "federalJob", "oconus", "payRetSystem", "selectedVARating", "hasDependents"]) {
      expect(rebuilt[k], k).toEqual((plan as any)[k]);
    }
    // Fields the form doesn't own (a manually typed base pay, tool overrides) survive the round trip.
    ui.state.tools = { dtHcRx: "250" };
    ui.state.payBasePay = 7000;
    expect(setup.buildState().tools).toEqual({ dtHcRx: "250" });
    expect(setup.buildState().payBasePay).toBe(7000);
  });

  it("a validation error on the hidden step reveals that step and focuses the field", async () => {
    const { setup, wireAll } = await boot();
    wireAll();
    setup.showSetupStep(2);
    expect($("setupStep1").hidden).toBe(true);
    fire($("setup-form"), "submit");
    expect($("setupStep1").hidden).toBe(false);
    expect(document.activeElement && (document.activeElement as any).id).toBe("firstName");
  });
});

describe("decision-tool overrides", () => {
  it("touching one input persists ONLY that input; the others keep following the plan", async () => {
    const { planio, ui, wireAll } = await boot();
    wireAll();
    planio.applyLoadedPlan(samplePlan());
    const sbpBefore = $("dtSbpBase").value;
    expect(Number(sbpBefore)).toBeGreaterThan(0);

    $("dtHcRx").value = "250"; fire($("dtHcRx"), "input");
    expect(ui.state.tools).toEqual({ dtHcRx: "250" });

    // Raise base pay on the Pay tab → the SBP/CRDP prefills must move with it.
    $("payBasePay").value = String(Number($("payBasePay").value) + 1000); fire($("payBasePay"), "input");
    await nextFrame(); // the tools refresh is coalesced into a frame
    expect(Number($("dtSbpBase").value)).toBeGreaterThan(Number(sbpBefore));
    expect($("dtCrGross").value).toBe($("dtSbpBase").value);
    expect($("dtHcRx").value).toBe("250"); // the real override is still honoured
  });

  it("typing the prefill back in clears the override, and stale persist-everything data is pruned on load", async () => {
    const { planio, ui, wireAll } = await boot();
    wireAll();
    const plan = samplePlan() as any;
    // What the old code stored: every input, at its then-prefill, plus one real change.
    plan.tools = { dtHcRx: "0", dtHcFedvip: "0", dtTspYears: "20", dtLeaveDays: "60", dtTspAdvFee: "1", dtPpmGcc: "500" };
    planio.applyLoadedPlan(plan);
    expect(ui.state.tools).toEqual({ dtPpmGcc: "500" });
    $("dtPpmGcc").value = ""; fire($("dtPpmGcc"), "input");
    expect(ui.state.tools).toEqual({});
  });

  it("the CRDP/CRSC tool quotes the same household VA figure as the Pay tab", async () => {
    const { planio, calc, wireAll } = await boot();
    wireAll();
    planio.applyLoadedPlan(samplePlan()); // married + dependents, 50%
    const household = calc.vaCompensation({ rating: 50, spouse: true, childrenU18: 1 });
    expect(household).toBeGreaterThan(calc.VA_RATES[50]);
    const payTab = $("vaCompAmount").textContent.replace(/[^0-9.]/g, "");
    expect(Number(payTab)).toBeCloseTo(household, 2);
    expect($("dtCrResult").textContent).toContain(Math.round(household).toLocaleString("en-US"));
  });
});

describe("results tabs", () => {
  it("restore the remembered tab for the same plan, and fall back to Overview for a different one", async () => {
    const { tabs, ui } = await boot();
    tabs.wireTabs();
    tabs.setActiveTab("checklist");
    expect($("panel-checklist").hidden).toBe(false);
    expect($("panel-overview").hidden).toBe(true);
    expect($("tab-checklist").getAttribute("aria-selected")).toBe("true");
    expect(sessionStorage.getItem("mtc-results-tab")).toBe("local:checklist");
    ui.activeTab = null;
    expect(tabs.rememberedTab()).toBe("checklist");
    sessionStorage.setItem("mtc-results-tab", "someOtherPlan:pay");
    expect(tabs.rememberedTab()).toBeNull();
  });

  it("arrow keys move and activate with a roving tabindex", async () => {
    const { tabs } = await boot();
    tabs.wireTabs();
    tabs.setActiveTab("overview", { focus: true });
    $("tab-overview").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect($("tab-resources").getAttribute("aria-selected")).toBe("true");
    expect($("tab-resources").tabIndex).toBe(0);
    expect($("tab-overview").tabIndex).toBe(-1);
  });
});

describe("overview milestone fold", () => {
  it("shows the next six milestones by default and all of them after Show all", async () => {
    const { planio, wireAll } = await boot();
    wireAll();
    planio.applyLoadedPlan(samplePlan());
    const cards = () => [...document.querySelectorAll("#milestoneGrid .milestone-card")] as any[];
    expect(cards().length).toBeGreaterThan(6);
    expect(cards().filter((c) => !c.hidden).length).toBe(6);
    expect($("milestoneMoreBtn").hidden).toBe(false);
    // The stylesheet must actually hide them: .milestone-card sets display:flex, which at equal
    // specificity would outrank the [hidden] reset without an explicit rule.
    const css = readFileSync(path.join(root, "public", "css", "app.css"), "utf8");
    expect(css).toContain(".milestone-card[hidden] { display: none; }");
    $("milestoneMoreBtn").click();
    expect(cards().filter((c) => !c.hidden).length).toBe(cards().length);
    expect($("milestoneMoreBtn").textContent).toMatch(/only what's next/);
  });
});

describe("store.js request timeout", () => {
  it("a request that never completes is reported as a transient failure instead of hanging", async () => {
    vi.useFakeTimers();
    const store = await import("/js/store.js");
    const stub = vi.fn((_: any, init: any) => new Promise((_res, rej) => { init.signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))); }));
    vi.stubGlobal("fetch", stub);
    store.configure({ id: "abc", key: null });
    const pending = store.loadRemote();
    await vi.advanceTimersByTimeAsync(10_001);
    const res = await pending;
    expect(res.status).toBe("offline");
    vi.useRealTimers();
  });
});
