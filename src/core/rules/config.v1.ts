import { RuleConfig } from "./config";

// rule_versions v1 — answers approved by the project owner (founder's office), 2026-10-07.
// Nikhil's sign-off is still required before production. Budget thresholds were set by the founder's office from case
// evidence, NOT from pricing.md; they live here only and must never be copied into any prompt, script or log.
export const RULES_V1: RuleConfig = RuleConfig.parse({
  version: "v1",
  approval: { ownerApproved: true, approvedBy: "project owner (founder's office)", approvedOn: "2026-10-07", nikhilProductionSignoff: "pending" },
  timeline: { minWeeksToDeadline: 8 }, // call date -> caller's COMPLETION deadline (not start date)
  size: { commercialMin: 500, commercialMax: 3000, reviewUpperBand: 3300 }, // <500 not_fit; 500-3000 fit; 3001-3300 unclear; >3300 not_fit
  budgetThresholdsInr: {
    oneRoom: 200_000, twoRooms: 400_000, full1bhk: 400_000, full2bhk: 600_000, full3bhk: 800_000, full4bhkOrVilla: 1_200_000,
    officePerSqft: 1000,
  },
  localities: {
    // services.md service area + Kharadi (added in v1). Anything not listed => unclear (human review).
    served: [
      "kothrud", "baner", "aundh", "wakad", "koregaon park", "kalyani nagar", "viman nagar", "hadapsar", "magarpatta", "nibm",
      "kondhwa", "undri", "shivane", "warje", "erandwane", "deccan", "kharadi",
      "pimpri", "chinchwad", "pimple saudagar", "pimple nilakh", "ravet", "hinjewadi",
    ],
    edge: ["talegaon"],
    excluded: ["nashik", "mumbai", "lonavala"],
    cityGeneric: ["pune", "pune city", "pcmc", "pimpri chinchwad"],
  },
  types: {
    fit: ["home", "office", "studio"],
    notFit: ["restaurant", "hotel", "gym", "retail"],
    unclear: ["clinic", "other"],
  },
  vipReferrers: ["Vikram Agarwal"],
});
