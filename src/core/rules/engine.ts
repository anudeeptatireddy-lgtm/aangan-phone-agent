import { z } from "zod";

export const CheckFitInput = z.object({
  location: z.string().optional(),
  scope: z.string().optional(),
  carpet_sqft: z.number().positive().optional(),
  current_state: z.string().optional(),
  timeline: z.string().optional(),
  decision_maker: z.string().optional(),
  owners_attending: z.boolean().optional(),
  referrer: z.string().optional(),
  // Volunteered by the caller only. Consumed by the real engine (rule 6); NEVER spoken back or returned.
  budget_inr: z.number().nonnegative().optional(),
  property_type: z.string().optional(),
  tenure: z.enum(["owned", "rented", "unknown"]).optional(),
  landlord_consent: z.boolean().optional(),
});
export type CheckFitInput = z.infer<typeof CheckFitInput>;

export interface CheckFitOutput {
  result: "fit" | "not_fit" | "unclear";
  reason_codes: string[];
  missing_fields: string[];
  rule_version: string;
}

/**
 * FAIL-SAFE STUB (plan option B). The real deterministic engine is built after the owner and Nikhil
 * resolve the qualified.md vs 8-rules conflicts (docs/session-0-plan.md §2). Until then this can never
 * return "fit", so nothing is auto-booked and every call is routed to a human for review.
 */
export function checkFit(_input: CheckFitInput): CheckFitOutput {
  return { result: "unclear", reason_codes: ["rules_engine_not_enabled"], missing_fields: [], rule_version: "stub-0" };
}
