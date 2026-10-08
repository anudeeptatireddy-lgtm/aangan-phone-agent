import { log } from "@/lib/log";
import { buildCallRecord } from "@/adapters/voice/vaanivoice/record";
import type { VaaniHistoryRow } from "@/adapters/voice/vaanivoice/client";
import type { PostCallResult } from "@/core/postcall/pipeline";
import type { Deps } from "./deps";

const INBOUND = /^(in|incoming)/i;

export type VaaniProcessResult =
  | { kind: "processed"; result: PostCallResult }
  | { kind: "ignored"; reason: "not_inbound" }
  | { kind: "not_ready"; reason: "transcript_not_ready" }
  | { kind: "error"; reason: "fetch_or_processing_error"; detail: string };

/**
 * The one way a finished Vaani call enters the system, whether its webhook delivered it or the reconciler found it in the history.
 * Nothing about the call is taken from the caller of this function except its id (and, optionally, the history row Vaani itself returned):
 * the transcript, entities, number and times are fetched from Vaani with our key. Outbound calls are never processed (hard rule 5).
 */
export async function processVaaniCall(deps: Deps, callId: string, o: { eventTimestamp?: string; history?: VaaniHistoryRow | null } = {}): Promise<VaaniProcessResult> {
  if (!deps.pipeline) return { kind: "error", reason: "fetch_or_processing_error", detail: "extractor_not_configured" };
  try {
    const details = await deps.vaaniVoice.getCallDetails(callId);
    if (!details) return { kind: "not_ready", reason: "transcript_not_ready" };
    // The history row only ADDS the caller's number, the real start time and the direction. If Vaani's history endpoint is down (it returned HTTP 500
    // "Invalid client_id format" for this account on 2026-10-08) the call is processed without them, never rejected: a lost call costs more than a missing number.
    let history: VaaniHistoryRow | null;
    if (o.history !== undefined) history = o.history;
    else try { history = await deps.vaaniVoice.findInHistory(callId); } catch (e) { history = null; log("warn", "vaanivoice: call history unavailable; processing without it", { vendor_call_id: callId, error: String((e as Error).message).slice(0, 100) }); }
    if (history && history.direction && !INBOUND.test(history.direction) && !/^inbound$/i.test(history.call_type ?? "")) return { kind: "ignored", reason: "not_inbound" };
    const rate = deps.env.VAANIVOICE_RATE_INR_PER_MIN;
    const result = await deps.pipeline.process(buildCallRecord({ callId, details, history, eventTimestamp: o.eventTimestamp, ratePerMinInr: rate, now: deps.now() }));
    return { kind: "processed", result };
  } catch (err) {
    return { kind: "error", reason: "fetch_or_processing_error", detail: String((err as Error).message ?? err) };
  }
}
