import { describe, it, expect } from "vitest";
import { RuleConfig } from "@/core/rules/config";
import { RULES_V1 } from "@/core/rules/config.v1";

describe("rule config v1", () => {
  it("validates against the typed schema", () => expect(() => RuleConfig.parse(RULES_V1)).not.toThrow());
  it("rejects non-positive thresholds and inverted size bands", () => {
    expect(() => RuleConfig.parse({ ...RULES_V1, size: { ...RULES_V1.size, commercialMin: 4000 } })).toThrow();
    expect(() => RuleConfig.parse({ ...RULES_V1, timeline: { minWeeksToDeadline: 0 } })).toThrow();
  });
  it("carries approval metadata: owner-approved, Nikhil production sign-off pending", () => {
    expect(RULES_V1.approval.nikhilProductionSignoff).toBe("pending");
  });
  it("registry: Kharadi added; Talegaon is edge; Nashik excluded", () => {
    expect(RULES_V1.localities.served).toContain("kharadi");
    expect(RULES_V1.localities.edge).toContain("talegaon");
    expect(RULES_V1.localities.excluded).toContain("nashik");
  });
});
