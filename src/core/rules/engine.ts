import { z } from "zod";
import { istDate } from "../hours";
import { scriptKeyForReason } from "../scripts";
import type { RuleConfig } from "./config";
import { RULES_V1 } from "./config.v1";

// Deterministic fit engine (hard rule 2). Pure: no clock, no I/O, no model. `callDate` is an explicit argument.
// Rules and thresholds come from the versioned RuleConfig (docs/session-0-plan.md §2, decisions-v1.md).

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const CheckFitInput = z.object({
  location: z.string().optional(),
  project_type: z.enum(["home", "office", "studio", "clinic", "retail", "restaurant", "hotel", "gym", "other"]).optional(),
  scope: z.enum(["full_home", "partial_home", "single_room", "kitchen_only", "wardrobe_only", "office_fitout",
    "advisory_only", "decor_only", "furniture_only", "vastu_only", "unspecified"]).optional(),
  rooms_count: z.number().int().positive().optional(),
  bhk: z.number().int().positive().optional(),
  is_villa: z.boolean().optional(),
  carpet_sqft: z.number().positive().optional(),
  tenure: z.enum(["owned", "rented"]).optional(),
  landlord_consent: z.boolean().optional(),
  structural_work: z.enum(["none", "requested", "insists"]).optional(),
  deadline_date: date.optional(),   // caller's COMPLETION deadline
  start_date: date.optional(),
  possession_date: date.optional(),
  decision_maker: z.enum(["owner", "family_on_behalf", "employee", "unknown"]).optional(),
  owners_attending: z.boolean().optional(),
  // Volunteered by the caller only (upper figure if a range). Consumed here; NEVER spoken back, logged or returned.
  budget_inr: z.number().nonnegative().optional(),
  referrer: z.string().optional(),
  price_asked: z.boolean().optional(),
  frustrated: z.boolean().optional(),
  exploring_only: z.boolean().optional(),
  /** Fields the agent has already asked once; if still unresolved they go to a human instead of being asked again. */
  already_asked: z.array(z.string()).default([]),
});
export type CheckFitInput = z.input<typeof CheckFitInput>;
type Parsed = z.output<typeof CheckFitInput>;

export type NextAction = "proceed_to_booking" | "decline_kindly" | "offer_later_start" | "offer_reversible_design" | "ask_caller" | "human_review";

export interface CheckFitOutput {
  result: "fit" | "not_fit" | "unclear";
  reason_codes: string[];
  missing_fields: string[];
  next_action: NextAction;
  script_keys: string[];
  flags: string[];
  details: { earliest_workable_deadline?: string };
  rule_version: string;
}

interface Check {
  outcome: "ok" | "not_fit" | "unclear";
  reason?: string;
  missing?: string[];
  action?: NextAction;
}
const OK: Check = { outcome: "ok" };

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const has = (haystack: string, names: string[]) => names.some((n) => haystack.includes(norm(n)));
const daysBetween = (fromIso: string, toIso: string) => (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function checkFit(raw: CheckFitInput, callDate: Date, cfg: RuleConfig = RULES_V1): CheckFitOutput {
  const i: Parsed = CheckFitInput.parse(raw);
  const asked = new Set(i.already_asked);
  const flags: string[] = [];
  const details: CheckFitOutput["details"] = {};
  const today = istDate(callDate);

  const ask = (field: string): Check =>
    asked.has(field) ? { outcome: "unclear", reason: `unresolved_${field}`, action: "human_review" }
      : { outcome: "unclear", missing: [field], action: "ask_caller" };

  const isCommercial = i.project_type === "office" || i.project_type === "studio";

  // ---- rule 1: location -------------------------------------------------------------------------------
  const location = (): Check => {
    if (!i.location) return ask("location");
    const h = norm(i.location);
    if (has(h, cfg.localities.excluded)) return { outcome: "not_fit", reason: "area_outside_service", action: "decline_kindly" };
    if (has(h, cfg.localities.edge)) return { outcome: "unclear", reason: "edge_location", action: "human_review" };
    if (has(h, cfg.localities.served)) return OK;
    if (cfg.localities.cityGeneric.some((c) => h === norm(c))) return OK;
    return { outcome: "unclear", reason: "unknown_locality", action: "human_review" };
  };

  // ---- rules 2 & 3: type and service ------------------------------------------------------------------
  const type = (): Check => {
    if (!i.project_type) return ask("project_type");
    if (cfg.types.notFit.includes(i.project_type)) return { outcome: "not_fit", reason: "type_not_served", action: "decline_kindly" };
    if (i.project_type === "clinic") return { outcome: "unclear", reason: "clinic_specialist", action: "human_review" };
    if (cfg.types.unclear.includes(i.project_type)) return { outcome: "unclear", reason: "type_other", action: "human_review" };
    return OK;
  };
  const scope = (): Check => {
    if (i.project_type && cfg.types.notFit.includes(i.project_type)) return OK; // type already decides
    if (i.scope && ["advisory_only", "decor_only", "furniture_only", "vastu_only"].includes(i.scope))
      return { outcome: "not_fit", reason: "advisory_only", action: "decline_kindly" };
    if (i.scope === "wardrobe_only") return { outcome: "not_fit", reason: "wardrobe_only", action: "decline_kindly" };
    if (i.scope === "kitchen_only") return { outcome: "unclear", reason: "kitchen_only", action: "human_review" };
    if (i.exploring_only) return { outcome: "unclear", reason: "exploring_only", action: "human_review" };
    if (!i.scope || i.scope === "unspecified") return ask("scope");
    return OK;
  };

  // ---- rule 4: commercial size -------------------------------------------------------------------------
  const size = (): Check => {
    if (!isCommercial) return OK; // residential has no size rule
    if (i.carpet_sqft === undefined) return ask("carpet_sqft");
    const { commercialMin, commercialMax, reviewUpperBand } = cfg.size;
    if (i.carpet_sqft < commercialMin) return { outcome: "not_fit", reason: "size_too_small", action: "decline_kindly" };
    if (i.carpet_sqft <= commercialMax) return OK;
    if (i.carpet_sqft <= reviewUpperBand) return { outcome: "unclear", reason: "size_borderline_large", action: "human_review" };
    return { outcome: "not_fit", reason: "size_too_large", action: "decline_kindly" };
  };

  // ---- rule 5: timeline (call date -> completion deadline) ---------------------------------------------
  const timeline = (): Check => {
    if (!i.deadline_date) return OK; // start/possession dates never fail the timeline
    const weeks = daysBetween(today, i.deadline_date) / 7;
    if (weeks >= cfg.timeline.minWeeksToDeadline) return OK;
    details.earliest_workable_deadline = addDays(today, cfg.timeline.minWeeksToDeadline * 7);
    return { outcome: "not_fit", reason: "timeline_too_short", action: "offer_later_start" };
  };

  // ---- rule 7: decision-maker ----------------------------------------------------------------------------
  const decisionMaker = (): Check => {
    if (i.owners_attending === false) return { outcome: "unclear", reason: "owners_not_attending", action: "human_review" };
    if (i.decision_maker === "family_on_behalf" && i.owners_attending === undefined) return ask("owners_attending");
    if (!i.decision_maker || i.decision_maker === "unknown" || i.decision_maker === "employee") flags.push("decision_maker_unverified");
    return OK;
  };

  // ---- rule 8: rentals -----------------------------------------------------------------------------------
  const rental = (): Check => {
    if (i.tenure !== "rented") return OK; // owned homes may have structural work
    if (i.structural_work === "insists") return { outcome: "not_fit", reason: "rental_structural", action: "decline_kindly" };
    if (i.landlord_consent === undefined) return ask("landlord_consent");
    if (i.landlord_consent === false) return { outcome: "unclear", reason: "landlord_consent_not_obtained", action: "human_review" };
    if (i.structural_work === "requested")
      return asked.has("structural_insistence")
        ? { outcome: "unclear", reason: "unresolved_structural_insistence", action: "human_review" }
        : { outcome: "unclear", reason: "structural_offer_reversible", missing: ["structural_insistence"], action: "offer_reversible_design" };
    return OK;
  };

  // ---- rule 6: volunteered budget -------------------------------------------------------------------------
  const budget = (): Check => {
    if (i.budget_inr === undefined) return OK; // not volunteered => treated as qualified
    const t = cfg.budgetThresholdsInr;
    let threshold: number | undefined;
    if (isCommercial) {
      if (i.carpet_sqft === undefined) { flags.push("budget_unassessed"); return OK; }
      threshold = t.officePerSqft * i.carpet_sqft;
    } else if (i.scope === "single_room") threshold = t.oneRoom;
    else if (i.scope === "partial_home") {
      if (i.rooms_count === 1) threshold = t.oneRoom;
      else {
        threshold = t.twoRooms;
        if (i.rooms_count === undefined || i.rooms_count >= 3) flags.push("partial_rooms_threshold_assumed");
      }
    } else if (i.scope === "full_home") {
      if (i.is_villa || (i.bhk ?? 0) >= 4) threshold = t.full4bhkOrVilla;
      else if (i.bhk === 3) threshold = t.full3bhk;
      else if (i.bhk === 2) threshold = t.full2bhk;
      else { threshold = t.full1bhk; if (i.bhk === undefined) flags.push("budget_unassessed"); }
    } else { flags.push("budget_unassessed"); return OK; }
    return i.budget_inr < threshold ? { outcome: "unclear", reason: "budget_below_scope", action: "human_review" } : OK;
  };

  const checks = [location(), type(), scope(), size(), timeline(), decisionMaker(), rental(), budget()];

  // ---- flags that never change the result -------------------------------------------------------------------
  if (i.referrer && cfg.vipReferrers.some((v) => i.referrer!.toLowerCase().includes(v.toLowerCase()))) flags.push("vip_referrer");
  if (i.price_asked) flags.push("price_asked");
  if (i.frustrated) flags.push("frustrated_prospect");

  // ---- precedence: not_fit > unclear > fit ---------------------------------------------------------------------
  const result: CheckFitOutput["result"] = checks.some((c) => c.outcome === "not_fit") ? "not_fit"
    : checks.some((c) => c.outcome === "unclear") ? "unclear" : "fit";
  const decisive = checks.filter((c) => c.outcome === result);
  const reason_codes = [...new Set(decisive.map((c) => c.reason).filter((r): r is string => !!r))];

  let next_action: NextAction = "proceed_to_booking";
  let missing_fields: string[] = [];
  if (result === "not_fit") {
    const onlyTimeline = decisive.every((c) => c.reason === "timeline_too_short");
    next_action = onlyTimeline ? "offer_later_start" : "decline_kindly";
  } else if (result === "unclear") {
    const actions = decisive.map((c) => c.action);
    next_action = actions.includes("human_review") ? "human_review"
      : actions.includes("offer_reversible_design") ? "offer_reversible_design" : "ask_caller";
    if (next_action !== "human_review") missing_fields = [...new Set(decisive.flatMap((c) => c.missing ?? []))];
  }
  if (result !== "not_fit" || !reason_codes.includes("timeline_too_short")) delete details.earliest_workable_deadline;

  const script_keys: string[] = [...new Set(reason_codes.map(scriptKeyForReason).filter((k): k is NonNullable<typeof k> => !!k))];
  return { result, reason_codes, missing_fields, next_action, script_keys, flags: [...new Set(flags)], details, rule_version: cfg.version };
}
