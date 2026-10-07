import type { ParsedFitInput } from "../enquiry";
import type { CallTurn } from "./types";
import type { CostRow } from "./costs";

export type Outcome = "booked" | "not_fit" | "review" | "escalated" | "closed_other" | "dropped" | "missed";
export type FlagKind = "price_mention" | "missed_complaint" | "rule_disagreement" | "missing_disclosure" | "extraction_failed" | "other";
export type PostCallStatus = "pending" | "processed" | "extraction_failed";
export type OutboxKind = "hubspot_deal" | "confirmation_email" | "owner_alert" | "nikhil_alert" | "designer_note_update" | "vaani_call" | "call_routing" | "design_lead_alert";

export interface CallRow {
  id: string;
  vendorCallId: string;
  callerId: string | null;
  enquiryId: string | null;
  parentCallId: string | null;
  rangAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationS: number | null;
  afterHours: boolean | null;
  intent: string | null;
  outcome: Outcome | null;
  endedReason: string | null;
  disclosureOk: boolean | null;
  recordingRef: string | null;
  recordingExpiresAt: Date | null;
  transcript: CallTurn[] | null;
  summary: string | null;
  postCallStatus: PostCallStatus;
  processedAt: Date | null;
  costAiInr: number | null;
  costVoiceInr: number | null;
  costTotalInr: number | null;
}
export type CallPatch = Partial<Omit<CallRow, "id" | "vendorCallId">>;

export interface EnquiryUpsert {
  id?: string;
  callerId?: string | null;
  channel?: string;
  input: ParsedFitInput;
  fit: "fit" | "not_fit" | "unclear";
  reasonCodes: string[];
  missingFields?: string[];
  nextAction?: string;
  flags: string[];
  ruleVersion: string;           // e.g. "v1"
  language?: string;
  currentState?: string;
  sourceHeard?: string;
  timelineRaw?: string;
  designerNote?: string;
}
export interface EnquiryRow extends Required<Pick<EnquiryUpsert, "input" | "fit" | "reasonCodes" | "flags" | "ruleVersion">> {
  id: string;
  callerId: string | null;
  channel: string;
  missingFields: string[];
  nextAction: string | null;
  language: string | null;
  currentState: string | null;
  sourceHeard: string | null;
  timelineRaw: string | null;
  designerNote: string | null;
}

export interface EvaluationInput {
  vendorCallId: string;
  enquiryId?: string | null;
  phase: "live" | "post_call";
  input: unknown;
  fit: "fit" | "not_fit" | "unclear";
  reasonCodes: string[];
  ruleVersion: string;
  callDate: Date;
}
export interface EvaluationRow { phase: "live" | "post_call"; fit: "fit" | "not_fit" | "unclear"; reasonCodes: string[]; ruleVersion: string; evaluatedAt: Date; enquiryId: string | null }

export interface FlagInput { vendorCallId: string; kind: FlagKind; severity?: "high" | "medium" | "low"; evidence?: string; detectedBy: string }
export interface FlagRow { id: string; kind: FlagKind; severity: string; evidence: string | null; detectedBy: string | null }

export interface EscalationInput { reason: "complaint" | "review" | "human_requested" | "misroute"; mode: string; callbackDueAt?: Date | null; slaMinutes?: number | null; queue?: string | null; queueEscalatesTo?: string | null }
export interface EscalationRow { reason: string; mode: string | null; callbackDueAt: Date | null; slaMinutes: number | null }

export interface OutboxRow { id: string; kind: OutboxKind; payload: Record<string, unknown>; dedupeKey: string; status: "pending" | "processed" | "failed"; attempts: number }

/** Persistence for the post-call pipeline: calls, enquiries, evaluations, audit flags, costs, escalations and the outbox. */
export interface PostCallRepo {
  upsertCaller(i: { phone: string; name?: string; email?: string; language?: string }): Promise<{ id: string }>;
  updateCaller(callerId: string, patch: { name?: string; email?: string; language?: string }): Promise<void>;
  /** The caller's real details for outbound integrations (CRM). The phone is decrypted here and must never be logged. */
  callerContact(callerId: string): Promise<{ phone: string; name: string | null; email: string | null } | null>;
  getCrmLink(enquiryId: string): Promise<{ contactId: string; dealId: string } | null>;
  saveCrmLink(enquiryId: string, link: { contactId: string; dealId: string }): Promise<void>;
  upsertCall(vendorCallId: string, patch: CallPatch): Promise<CallRow>;
  getCall(vendorCallId: string): Promise<CallRow | null>;
  recentCallsForCaller(callerId: string, since: Date): Promise<CallRow[]>;
  upsertEnquiry(e: EnquiryUpsert): Promise<EnquiryRow>;
  getEnquiry(id: string): Promise<EnquiryRow | null>;
  recordEvaluation(e: EvaluationInput): Promise<void>;
  latestEvaluation(vendorCallId: string, phase: "live" | "post_call"): Promise<EvaluationRow | null>;
  addFlag(f: FlagInput): Promise<FlagRow>;
  listFlags(vendorCallId: string): Promise<FlagRow[]>;
  addUsageCosts(vendorCallId: string, rows: CostRow[], at: Date): Promise<void>;
  recordEscalation(vendorCallId: string, e: EscalationInput): Promise<void>;
  escalationsForCall(vendorCallId: string): Promise<EscalationRow[]>;
  enqueue(kind: OutboxKind, payload: Record<string, unknown>, dedupeKey: string): Promise<boolean>;
  pendingOutbox(kinds: OutboxKind[], limit: number): Promise<OutboxRow[]>;
  /** "pending" = a failed attempt that will be retried (attempts is incremented, the error recorded). */
  markOutbox(id: string, status: "processed" | "failed" | "pending", error?: string): Promise<void>;
}
