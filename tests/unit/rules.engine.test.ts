import { describe, it, expect } from "vitest";
import { checkFit, CheckFitInput } from "@/core/rules/engine";
import { RULES_V1 } from "@/core/rules/config.v1";

const CALL = new Date("2026-09-02T05:30:00Z"); // 11:00 IST, 2 Sep 2026
const fit = (o: Record<string, unknown> = {}, call = CALL) =>
  checkFit(CheckFitInput.parse({ location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, decision_maker: "owner", ...o }), call, RULES_V1);
const office = (o: Record<string, unknown> = {}) =>
  fit({ project_type: "office", scope: "office_fitout", bhk: undefined, carpet_sqft: 1500, ...o });
const day = (n: number) => new Date(CALL.getTime() + n * 86_400_000).toISOString().slice(0, 10);

describe("baseline", () => {
  it("a complete, in-area full home is fit and proceeds to booking", () => {
    const r = fit();
    expect(r).toMatchObject({ result: "fit", next_action: "proceed_to_booking", reason_codes: [], missing_fields: [], rule_version: "v1" });
  });
  it("is deterministic and never reads the clock", async () => {
    expect(JSON.stringify(fit())).toBe(JSON.stringify(fit()));
    const { readFileSync } = await import("node:fs");
    for (const f of ["engine.ts", "config.v1.ts"]) {
      const src = readFileSync(`src/core/rules/${f}`, "utf8");
      expect(src).not.toMatch(/Date\.now\(|new Date\(\s*\)/);
    }
  });
});

describe("rule 1 — location registry", () => {
  it.each(["Kothrud", "Baner", "Kharadi", "Pimple Saudagar", "Hinjewadi Phase 1, Pune", "Koregaon Park", "pune"])("%s is served", (l) => {
    expect(fit({ location: l }).result).toBe("fit");
  });
  it.each(["Nashik", "Mumbai", "Lonavala"])("%s is outside the service area -> not_fit", (l) => {
    const r = fit({ location: l });
    expect(r).toMatchObject({ result: "not_fit", next_action: "decline_kindly" });
    expect(r.reason_codes).toContain("area_outside_service");
    expect(r.script_keys).toContain("not_fit.area");
  });
  it("Talegaon (edge) -> unclear, human review, even when the text also says 'near Pune'", () => {
    const r = fit({ location: "Talegaon Dabhade, near Pune" });
    expect(r).toMatchObject({ result: "unclear", next_action: "human_review" });
    expect(r.reason_codes).toContain("edge_location");
  });
  it("a locality not on the registry -> unclear, never silently served", () => {
    const r = fit({ location: "Xyzpur" });
    expect(r).toMatchObject({ result: "unclear", next_action: "human_review" });
    expect(r.reason_codes).toContain("unknown_locality");
  });
  it("missing location -> ask; already asked -> human review", () => {
    expect(fit({ location: undefined })).toMatchObject({ result: "unclear", next_action: "ask_caller", missing_fields: ["location"] });
    expect(fit({ location: undefined, already_asked: ["location"] })).toMatchObject({ result: "unclear", next_action: "human_review" });
  });
});

describe("rule 2/3 — service and type", () => {
  it.each(["advisory_only", "decor_only", "furniture_only", "vastu_only"])("%s -> not_fit advisory", (s) => {
    const r = fit({ scope: s });
    expect(r.result).toBe("not_fit");
    expect(r.script_keys).toContain("not_fit.advisory");
  });
  it("wardrobe-only -> not_fit", () => {
    const r = fit({ scope: "wardrobe_only" });
    expect(r.result).toBe("not_fit");
    expect(r.script_keys).toContain("not_fit.wardrobe_only");
  });
  it("kitchen-only -> unclear (human review)", () => {
    expect(fit({ scope: "kitchen_only" })).toMatchObject({ result: "unclear", next_action: "human_review" });
  });
  it("1BHK full home is fit; studio is fit (office type)", () => {
    expect(fit({ bhk: 1, carpet_sqft: 550 }).result).toBe("fit");
    expect(fit({ project_type: "studio", scope: "office_fitout", carpet_sqft: 900 }).result).toBe("fit");
  });
  it.each(["restaurant", "hotel", "gym", "retail"])("%s -> not_fit type", (t) => {
    const r = fit({ project_type: t });
    expect(r.result).toBe("not_fit");
    expect(r.script_keys).toContain("not_fit.type");
  });
  it("clinic -> unclear (specialist requirements)", () => {
    const r = fit({ project_type: "clinic", scope: "office_fitout", carpet_sqft: 900 });
    expect(r).toMatchObject({ result: "unclear", next_action: "human_review" });
    expect(r.reason_codes).toContain("clinic_specialist");
  });
  it("unspecified scope -> ask; 'just exploring' -> human review", () => {
    expect(fit({ scope: undefined })).toMatchObject({ result: "unclear", next_action: "ask_caller", missing_fields: ["scope"] });
    expect(fit({ exploring_only: true })).toMatchObject({ result: "unclear", next_action: "human_review" });
  });
});

describe("rule 4 — commercial size 500-3,000 (3,001-3,300 unclear)", () => {
  it.each([[499, "not_fit"], [500, "fit"], [3000, "fit"], [3001, "unclear"], [3300, "unclear"], [3301, "not_fit"]])("%i sq ft -> %s", (n, want) => {
    expect(office({ carpet_sqft: n }).result).toBe(want);
  });
  it("uses the right decline scripts", () => {
    expect(office({ carpet_sqft: 180 }).script_keys).toContain("not_fit.size_small");
    expect(office({ carpet_sqft: 3500 }).script_keys).toContain("not_fit.size_large");
  });
  it("office without a size -> ask for it", () => {
    expect(office({ carpet_sqft: undefined })).toMatchObject({ result: "unclear", next_action: "ask_caller", missing_fields: ["carpet_sqft"] });
  });
  it("residential has no size limit (5,500 sq ft villa)", () => {
    expect(fit({ carpet_sqft: 5500, is_villa: true, bhk: 5 }).result).toBe("fit");
  });
});

describe("rule 5 — timeline: >= 8 weeks from call date to the completion deadline", () => {
  it("exactly 56 days is fit; 55 is not_fit", () => {
    expect(fit({ deadline_date: day(56) }).result).toBe("fit");
    expect(fit({ deadline_date: day(55) }).result).toBe("not_fit");
  });
  it("not_fit offers a later start and gives the earliest workable deadline", () => {
    const r = fit({ deadline_date: day(21) });
    expect(r).toMatchObject({ result: "not_fit", next_action: "offer_later_start" });
    expect(r.script_keys).toContain("not_fit.timeline");
    expect(r.details.earliest_workable_deadline).toBe(day(56));
  });
  it("re-running with the caller's new, later deadline passes", () => {
    expect(fit({ deadline_date: day(21) }).result).toBe("not_fit");
    expect(fit({ deadline_date: day(70) }).result).toBe("fit");
  });
  it("start date / possession date alone never fail the timeline", () => {
    expect(fit({ possession_date: day(42), start_date: day(1) }).result).toBe("fit");
  });
  it("no deadline -> not a failure", () => expect(fit().result).toBe("fit"));
});

describe("rule 6 — volunteered budget below the scope threshold -> unclear (never decline)", () => {
  const cases: [string, Record<string, unknown>, number][] = [
    ["one room", { scope: "single_room", bhk: undefined }, 200_000],
    ["two rooms", { scope: "partial_home", rooms_count: 2, bhk: 1 }, 400_000],
    ["full 1BHK", { bhk: 1 }, 400_000],
    ["full 2BHK", { bhk: 2 }, 600_000],
    ["full 3BHK", { bhk: 3 }, 800_000],
    ["full 4BHK", { bhk: 4 }, 1_200_000],
    ["villa", { is_villa: true, bhk: 2 }, 1_200_000],
  ];
  it.each(cases)("%s: one rupee below -> unclear, at threshold -> fit", (_n, o, t) => {
    const below = fit({ ...o, budget_inr: t - 1 });
    expect(below).toMatchObject({ result: "unclear", next_action: "human_review" });
    expect(below.reason_codes).toContain("budget_below_scope");
    expect(fit({ ...o, budget_inr: t }).result).toBe("fit");
  });
  it("office: below 1,000 x carpet sq ft", () => {
    expect(office({ carpet_sqft: 800, budget_inr: 799_999 }).result).toBe("unclear");
    expect(office({ carpet_sqft: 800, budget_inr: 800_000 }).result).toBe("fit");
  });
  it("T10: kitchen + one bedroom in a 1BHK with a tiny budget", () => {
    expect(fit({ scope: "partial_home", rooms_count: 2, bhk: 1, carpet_sqft: 550, budget_inr: 150_000 }).result).toBe("unclear");
  });
  it("no budget volunteered -> treated as qualified", () => expect(fit().result).toBe("fit"));
  it("3+ rooms partial uses the two-room threshold and says so", () => {
    const r = fit({ scope: "partial_home", rooms_count: 3, bhk: 2, budget_inr: 399_999 });
    expect(r.result).toBe("unclear");
    expect(r.flags).toContain("partial_rooms_threshold_assumed");
  });
  it("full home without BHK uses the smallest full-home threshold and flags it", () => {
    const r = fit({ bhk: undefined, budget_inr: 500_000 });
    expect(r.result).toBe("fit");
    expect(r.flags).toContain("budget_unassessed");
  });
  it("NEVER echoes the budget or any threshold (hard rule 1)", () => {
    const text = JSON.stringify(fit({ scope: "partial_home", rooms_count: 2, bhk: 1, budget_inr: 150_000 }));
    expect(text).not.toMatch(/150000|200000|400000|600000|800000|1200000|lakh|₹/i);
  });
});

describe("rule 7 — decision-maker", () => {
  it("owners won't attend -> unclear", () => {
    const r = fit({ decision_maker: "family_on_behalf", owners_attending: false });
    expect(r).toMatchObject({ result: "unclear", next_action: "human_review" });
    expect(r.reason_codes).toContain("owners_not_attending");
  });
  it("T14: son calling, owners will attend -> fit, no flag", () => {
    const r = fit({ decision_maker: "family_on_behalf", owners_attending: true });
    expect(r).toMatchObject({ result: "fit", flags: [] });
  });
  it("relative calling and attendance not yet known -> ask", () => {
    expect(fit({ decision_maker: "family_on_behalf" })).toMatchObject({ result: "unclear", next_action: "ask_caller", missing_fields: ["owners_attending"] });
  });
  it("decision-maker unknown -> fit + flag", () => {
    const r = fit({ decision_maker: undefined });
    expect(r.result).toBe("fit");
    expect(r.flags).toContain("decision_maker_unverified");
  });
});

describe("rule 8 — rentals", () => {
  it("rented, landlord consent, reversible work -> fit (T11)", () => {
    expect(fit({ tenure: "rented", landlord_consent: true, structural_work: "none" }).result).toBe("fit");
  });
  it("rented, consent unknown -> ask; consent not obtained -> human review", () => {
    expect(fit({ tenure: "rented" })).toMatchObject({ result: "unclear", next_action: "ask_caller", missing_fields: ["landlord_consent"] });
    const r = fit({ tenure: "rented", landlord_consent: false });
    expect(r).toMatchObject({ result: "unclear", next_action: "human_review" });
    expect(r.reason_codes).toContain("landlord_consent_not_obtained");
  });
  it("rented + structural work requested -> first offer a reversible design", () => {
    const r = fit({ tenure: "rented", landlord_consent: true, structural_work: "requested" });
    expect(r).toMatchObject({ result: "unclear", next_action: "offer_reversible_design", missing_fields: ["structural_insistence"] });
    expect(r.script_keys).toContain("not_fit.rental_structural");
  });
  it("rented + caller insists on structural work -> not_fit", () => {
    const r = fit({ tenure: "rented", landlord_consent: true, structural_work: "insists" });
    expect(r).toMatchObject({ result: "not_fit", next_action: "decline_kindly" });
    expect(r.reason_codes).toContain("rental_structural");
  });
  it("owned homes may have structural work", () => {
    expect(fit({ tenure: "owned", structural_work: "insists" }).result).toBe("fit");
  });
});

describe("precedence and flags", () => {
  it("not_fit beats unclear and ask", () => {
    const r = fit({ location: "Nashik", scope: "kitchen_only", project_type: "gym" });
    expect(r.result).toBe("not_fit");
    expect(r.reason_codes).toEqual(expect.arrayContaining(["area_outside_service", "type_not_served"]));
  });
  it("unclear beats fit", () => {
    expect(fit({ location: "Talegaon" }).result).toBe("unclear");
  });
  it("not_fit despite missing info elsewhere", () => {
    expect(fit({ location: undefined, scope: "advisory_only" }).result).toBe("not_fit");
  });
  it("VIP referrer is flagged and never changes the result", () => {
    const r = fit({ referrer: "Vikram Agarwal" });
    expect(r.result).toBe("fit");
    expect(r.flags).toContain("vip_referrer");
    expect(fit({ referrer: "someone else" }).flags).not.toContain("vip_referrer");
  });
  it("price_asked and frustrated prospect are flags, not disqualifiers", () => {
    const r = fit({ price_asked: true, frustrated: true });
    expect(r.result).toBe("fit");
    expect(r.flags).toEqual(expect.arrayContaining(["price_asked", "frustrated_prospect"]));
  });
});
