import { z } from "zod";
import type { CheckFitInput } from "../rules/engine";
import { normalizeDeadline } from "./deadline";
import type { CallTurn } from "./types";
import type { TokenUsage } from "./costs";

// Post-call extraction contract. The model only EXTRACTS what was said; plain code makes every decision (hard rule 2).
// Enums are never nullable: "unknown" is an explicit member (null-in-enum handling is not documented by Google).

export const INTENTS = ["new_enquiry", "existing_client", "complaint", "other", "unknown"] as const;
export const PROJECT_TYPES = ["home", "office", "studio", "clinic", "retail", "restaurant", "hotel", "gym", "other", "unknown"] as const;
export const SCOPES = ["full_home", "partial_home", "single_room", "kitchen_only", "wardrobe_only", "office_fitout", "advisory_only", "decor_only", "furniture_only", "vastu_only", "unspecified"] as const;
export const CURRENT_STATES = ["bare", "lived_in", "awaiting_possession", "under_construction", "other", "unknown"] as const;
export const DECISION_MAKERS = ["owner", "family_on_behalf", "employee", "unknown"] as const;
export const TENURES = ["owned", "rented", "unknown"] as const;
export const STRUCTURAL = ["none", "requested", "insists", "unknown"] as const;
export const LANGUAGES = ["en", "hi", "mr", "other", "unknown"] as const;
export const DEADLINE_KINDS = ["date", "month", "festival", "relative", "none"] as const;
export const DEADLINE_UNITS = ["days", "weeks", "months"] as const;

const DeadlineSchema = z.object({
  kind: z.enum(DEADLINE_KINDS),
  date: z.string().nullable(),       // only when the caller gave an explicit calendar date, YYYY-MM-DD
  month: z.number().int().nullable(), // 1-12, when the caller named only a month
  year: z.number().int().nullable(),
  festival: z.string().nullable(),    // the festival/event name as said; NEVER a date or distance
  value: z.number().nullable(),       // for "in N weeks"
  unit: z.enum(DEADLINE_UNITS).nullable(),
  text: z.string().nullable(),        // the caller's own words
}).strict();

export const ExtractionSchema = z.object({
  language: z.enum(LANGUAGES),
  intent: z.enum(INTENTS),
  caller_name: z.string().nullable(),
  caller_email: z.string().nullable(),
  location: z.string().nullable(),
  project_type: z.enum(PROJECT_TYPES),
  scope: z.enum(SCOPES),
  rooms_count: z.number().int().nullable(),
  bhk: z.number().int().nullable(),
  is_villa: z.boolean().nullable(),
  carpet_sqft: z.number().nullable(),
  current_state: z.enum(CURRENT_STATES),
  deadline: DeadlineSchema.nullable(),
  start_date: z.string().nullable(),
  possession_date: z.string().nullable(),
  decision_maker: z.enum(DECISION_MAKERS),
  owners_attending: z.boolean().nullable(),
  tenure: z.enum(TENURES),
  landlord_consent: z.boolean().nullable(),
  structural_work: z.enum(STRUCTURAL),
  budget_inr: z.number().nullable(),  // only a figure the CALLER volunteered, in rupees (upper end of a range)
  referrer: z.string().nullable(),
  source_heard: z.string().nullable(),
  asked_for_price: z.boolean(),
  frustrated: z.boolean(),
  exploring_only: z.boolean(),
  complaint_signals: z.array(z.string()),
  summary: z.string(),
  notes: z.string().nullable(),
}).strict();
export type Extraction = z.infer<typeof ExtractionSchema>;

export function emptyExtraction(): Extraction {
  return { language: "unknown", intent: "unknown", caller_name: null, caller_email: null, location: null, project_type: "unknown", scope: "unspecified", rooms_count: null,
    bhk: null, is_villa: null, carpet_sqft: null, current_state: "unknown", deadline: null, start_date: null, possession_date: null, decision_maker: "unknown",
    owners_attending: null, tenure: "unknown", landlord_consent: null, structural_work: "unknown", budget_inr: null, referrer: null, source_heard: null,
    asked_for_price: false, frustrated: false, exploring_only: false, complaint_signals: [], summary: "", notes: null };
}

// ---- the JSON Schema sent to Gemini (hand-written: nullable = type array, the documented form) ----
const nullable = (type: "string" | "number" | "integer" | "boolean", description?: string) => ({ type: [type, "null"], ...(description ? { description } : {}) });
const en = (values: readonly string[], description?: string) => ({ type: "string", enum: [...values], ...(description ? { description } : {}) });

const DEADLINE_JSON = {
  type: ["object", "null"],
  description: "What the caller said about WHEN the work must be finished. Report their words; never compute a date from a festival or a stated distance.",
  properties: {
    kind: en(DEADLINE_KINDS, "date = explicit calendar date; month = only a month named; festival = a festival/event named; relative = 'in N weeks'; none = nothing said"),
    date: nullable("string", "YYYY-MM-DD, only if the caller gave an explicit calendar date"),
    month: nullable("integer", "1-12, only if the caller named just a month"),
    year: nullable("integer"),
    festival: nullable("string", "the festival or event name exactly as said (e.g. Diwali), never a date"),
    value: nullable("number"),
    unit: { type: ["string", "null"], enum: [...DEADLINE_UNITS] },
    text: nullable("string", "the caller's own words about the deadline"),
  },
  required: ["kind", "date", "month", "year", "festival", "value", "unit", "text"],
  additionalProperties: false,
};

const properties = {
  language: en(LANGUAGES, "main language the CALLER spoke"),
  intent: en(INTENTS, "new_enquiry = wants a new project; existing_client = talks about a project they already have with Aangan; complaint = unhappy about service on an existing project; other = vendor, job seeker, wrong number"),
  caller_name: nullable("string"),
  caller_email: nullable("string"),
  location: nullable("string", "area/locality of the property as the caller said it"),
  project_type: en(PROJECT_TYPES),
  scope: en(SCOPES, "what the caller wants done; advisory_only = only ideas/advice, no execution"),
  rooms_count: nullable("integer", "number of rooms in scope for a partial project"),
  bhk: nullable("integer"),
  is_villa: nullable("boolean"),
  carpet_sqft: nullable("number", "carpet area in square feet as the caller said it"),
  current_state: en(CURRENT_STATES, "bare = empty/bare shell; lived_in = already lived in"),
  deadline: DEADLINE_JSON,
  start_date: nullable("string", "YYYY-MM-DD, only an explicit calendar start date the caller gave"),
  possession_date: nullable("string", "YYYY-MM-DD, only an explicit calendar possession date the caller gave"),
  decision_maker: en(DECISION_MAKERS, "owner = the caller decides; family_on_behalf = a relative calling for the owners; employee = works for the company"),
  owners_attending: nullable("boolean", "will the owners/decision-makers attend the consultation, if discussed"),
  tenure: en(TENURES),
  landlord_consent: nullable("boolean"),
  structural_work: en(STRUCTURAL, "for rented homes: whether the caller wants wall/structural changes"),
  budget_inr: nullable("number", "ONLY a budget the CALLER volunteered, in rupees as a plain number (upper end of a range). Null if the caller did not say one. Never a number spoken by the assistant."),
  referrer: nullable("string", "who referred them, if said"),
  source_heard: nullable("string", "how they heard of Aangan"),
  asked_for_price: { type: "boolean", description: "true if the caller asked what it would cost or for a rate" },
  frustrated: { type: "boolean", description: "true if the caller is frustrated about a lost or late reply to an enquiry" },
  exploring_only: { type: "boolean", description: "true if the caller said they are only exploring or just looking" },
  complaint_signals: { type: "array", items: { type: "string" }, description: "short quotes from the CALLER that sound like a complaint about an existing project" },
  summary: { type: "string", description: "2-3 neutral sentences about the enquiry for the designer. No numbers about money." },
  notes: nullable("string", "anything ambiguous or contradictory the designer should check"),
};

export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
} as const;

// ---- request building ----
export interface ExtractionRequest { system: string; input: string; meta?: { vendorCallId?: string } }
export interface ExtractionResult { data: Extraction; usage: TokenUsage; model: string }
export interface ExtractionPort { extract(req: ExtractionRequest): Promise<ExtractionResult> }

const SYSTEM = `You are a data-extraction function for phone calls to Aangan Studio, an interior design studio in Pune.
The transcript is between Aangan's virtual assistant (AGENT) and a person who called (CALLER). The call may mix English, Hindi and Marathi.

Return ONLY JSON that matches the provided schema.

Rules:
- Extract only what the transcript says. Do not decide whether the enquiry is a fit, do not score it, do not give advice. Another system decides.
- Use the CALLER's words for facts about the property, timeline, decision-makers and budget. Only a budget the CALLER volunteered may be recorded; ignore every number the AGENT says.
- If something was not said, use null (or the enum value "unknown" / "unspecified"). Never guess.
- For deadlines report what was said. If a festival or event is named, put only its name in "festival". Never turn a festival or a stated distance into a date.
- Carpet area in square feet; convert from square metres only if the caller used them.
- "summary" is 2-3 neutral sentences for the designer. Do not put any money amount or rate in it.
- complaint_signals: short quotes from the CALLER that sound like a complaint about a project they already have with Aangan (not about a lost enquiry).`;

export function buildExtractionRequest(turns: CallTurn[], callDate: Date, meta?: ExtractionRequest["meta"]): ExtractionRequest {
  const ist = new Date(callDate.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const body = turns.map((t) => `${t.speaker === "agent" ? "AGENT" : "CALLER"}: ${t.text}`).join("\n");
  return { system: SYSTEM, input: `Call date (IST): ${ist}\n\nTranscript:\n${body}`, meta };
}

// ---- extraction -> rules-engine input (plain code) ----
export interface FitMapping {
  input: CheckFitInput;
  deadlineIssue?: "unknown_event" | "no_event" | "date_passed";
  callerName?: string;
  callerEmail?: string;
  language?: string;
  currentState?: string;
  sourceHeard?: string;
  timelineRaw?: string;
  intent: Extraction["intent"];
  complaintSignals: string[];
  summary: string;
}

const known = <T extends string>(v: T, unknownValue: string) => (v === unknownValue ? undefined : v);
const defined = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

export function toFitInput(e: Extraction, callDate: Date): FitMapping {
  const d = e.deadline;
  const nd = d ? normalizeDeadline(
    d.kind === "date" ? { kind: "date", date: d.date ?? "" }
      : d.kind === "month" ? { kind: "month", month: d.month ?? 0, ...(d.year ? { year: d.year } : {}) }
      : d.kind === "festival" ? { kind: "festival", festival: d.festival ?? d.text ?? "" }
      : d.kind === "relative" ? { kind: "relative", value: d.value ?? 0, unit: d.unit ?? "weeks" }
      : { kind: "none" }, callDate) : {};
  const input = defined({
    location: e.location, project_type: known(e.project_type, "unknown"), scope: e.scope, rooms_count: e.rooms_count, bhk: e.bhk, is_villa: e.is_villa,
    carpet_sqft: e.carpet_sqft, tenure: known(e.tenure, "unknown"), landlord_consent: e.landlord_consent, structural_work: known(e.structural_work, "unknown"),
    deadline_date: nd.date, start_date: e.start_date, possession_date: e.possession_date, decision_maker: e.decision_maker, owners_attending: e.owners_attending,
    budget_inr: e.budget_inr, referrer: e.referrer, price_asked: e.asked_for_price || undefined, frustrated: e.frustrated || undefined,
    exploring_only: e.exploring_only || undefined,
  }) as unknown as CheckFitInput;
  return {
    input, deadlineIssue: nd.unresolved, callerName: e.caller_name ?? undefined, callerEmail: e.caller_email ?? undefined, language: known(e.language, "unknown"),
    currentState: known(e.current_state, "unknown"), sourceHeard: e.source_heard ?? undefined, timelineRaw: d?.text ?? undefined, intent: e.intent,
    complaintSignals: e.complaint_signals, summary: e.summary,
  };
}
