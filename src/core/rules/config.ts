import { z } from "zod";

const pos = z.number().positive();

/** Typed, versioned rule configuration. Stored in `rule_versions.config`; NEVER sent to a prompt. */
export const RuleConfig = z
  .object({
    version: z.string().min(1),
    approval: z.object({
      ownerApproved: z.boolean(),
      approvedBy: z.string(),
      approvedOn: z.string(),
      nikhilProductionSignoff: z.enum(["pending", "signed"]),
    }),
    timeline: z.object({ minWeeksToDeadline: pos }),
    size: z
      .object({ commercialMin: pos, commercialMax: pos, reviewUpperBand: pos })
      .refine((s) => s.commercialMin < s.commercialMax && s.commercialMax <= s.reviewUpperBand, "size bands must be min < max <= reviewUpperBand"),
    budgetThresholdsInr: z.object({
      oneRoom: pos, twoRooms: pos, full1bhk: pos, full2bhk: pos, full3bhk: pos, full4bhkOrVilla: pos, officePerSqft: pos,
    }),
    localities: z.object({
      served: z.array(z.string()), edge: z.array(z.string()), excluded: z.array(z.string()), cityGeneric: z.array(z.string()),
    }),
    types: z.object({ fit: z.array(z.string()), notFit: z.array(z.string()), unclear: z.array(z.string()) }),
    vipReferrers: z.array(z.string()),
  });
export type RuleConfig = z.infer<typeof RuleConfig>;
