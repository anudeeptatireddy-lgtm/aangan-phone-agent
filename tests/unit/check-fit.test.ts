import { describe, it, expect } from "vitest";
import { checkFit, CheckFitInput } from "@/core/rules/engine";

// Session 2 ships a FAIL-SAFE stub (plan option B): the real engine arrives with the rules session,
// after the owner/Nikhil resolve the qualified.md conflicts. Until then nothing may be auto-booked.
describe("check_fit fail-safe stub", () => {
  const t01 = { location: "Kothrud", scope: "full redesign", carpet_sqft: 1400, current_state: "lived-in",
    timeline: "by March", decision_maker: "owner", owners_attending: true };
  it("never returns fit", () => {
    expect(checkFit(CheckFitInput.parse(t01)).result).toBe("unclear");
  });
  it("is explicit about why", () => {
    expect(checkFit(CheckFitInput.parse(t01)).reason_codes).toContain("rules_engine_not_enabled");
  });
  it("never echoes a volunteered budget back (hard rule 1)", () => {
    const out = JSON.stringify(checkFit(CheckFitInput.parse({ ...t01, budget_inr: 150000 })));
    expect(out).not.toMatch(/150000|1\.5|lakh|₹/i);
  });
  it("rejects malformed input", () => {
    expect(() => CheckFitInput.parse({ carpet_sqft: "big" })).toThrow();
  });
});
