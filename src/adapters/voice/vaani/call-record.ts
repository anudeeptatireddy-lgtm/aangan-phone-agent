import type { CallRecordInput } from "@/core/postcall/types";
import type { VaaniEnvelope } from "./webhook";

// Vaani documents the webhook ENVELOPE ({id,type,created,data}) but says `data` is "defensive-parse, no sub-field guaranteed", and
// no `call.completed` sample exists in any public doc or in the OpenAPI spec (docs/vaani-findings.md, item 6). Hard rule 7: we do not
// guess field names. Until Vaani supplies a real payload this returns null, and the webhook handler stores the event, acknowledges it,
// and alerts the owner (once per event type) that mapping is the missing step.
export const VAANI_CALL_COMPLETED_REQUIREMENTS = [
  "call id",
  "start/answer/end times",
  "duration",
  "transcript with speaker turns",
  "recording url",
  "language",
  "caller number (unmasked) or a way to correlate with tool calls",
  "ended reason (completed / dropped / missed)",
] as const;

export function mapVaaniCallCompleted(_event: VaaniEnvelope): CallRecordInput | null {
  return null;
}
