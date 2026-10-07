// Deterministic call routing (hard rules 2 and 4). The model supplies an intent guess and the caller's words;
// plain code decides whether this is an existing-client/complaint call that must never be qualified like a lead.

export type Intent = "new_enquiry" | "existing_client" | "complaint" | "other" | "unknown";
export type Route = "escalate_complaint" | "close_other" | "continue";

export interface RouteInput {
  isExistingClient: boolean;
  intent?: Intent;
  utterance?: string;
  designerNames?: string[];
}
export interface RouteDecision { route: Route; reason: string }

// Signals that the caller is talking about a project they already have with Aangan, or complaining.
// EN / Hinglish / Hindi / Marathi. Deliberately narrow: a frustrated PROSPECT (T16) must not match.
const COMPLAINT_PATTERNS: RegExp[] = [
  /\bmy (project|designer|site|contractor|execution)\b/i,
  /\b(complaint|complain)\b/i,
  /\b(mera|meri|mere)\s+(project|designer|site|kaam)\b/i,
  /\b(shikayat|shikayet|takrar|takraar)\b/i,
  /शिकायत/,
  /तक्रार/,
  /(मेरा|मेरे|मेरी)\s*(प्रोजेक्ट|डिज़ाइनर|डिजाइनर|साइट)/,
  /(माझा|माझे|माझी)\s*(प्रोजेक्ट|डिझायनर|साइट)/,
];
const DESIGNER_WORDS = /\b(designer)\b|डिज़ाइनर|डिजाइनर|डिझायनर/i;

export function routeCall(i: RouteInput): RouteDecision {
  if (i.isExistingClient) return { route: "escalate_complaint", reason: "lookup_existing_client" };
  if (i.intent === "complaint" || i.intent === "existing_client") return { route: "escalate_complaint", reason: `intent_${i.intent}` };

  const u = i.utterance ?? "";
  if (COMPLAINT_PATTERNS.some((p) => p.test(u))) return { route: "escalate_complaint", reason: "keyword_guard" };
  if (i.designerNames?.some((n) => new RegExp(`\\b${n}\\b`, "i").test(u)) && DESIGNER_WORDS.test(u))
    return { route: "escalate_complaint", reason: "designer_name_guard" };

  if (i.intent === "other") return { route: "close_other", reason: "intent_other" };
  return { route: "continue", reason: "new_enquiry" };
}
