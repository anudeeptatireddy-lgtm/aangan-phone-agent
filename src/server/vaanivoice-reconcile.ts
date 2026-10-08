import { log } from "@/lib/log";
import type { VaaniHistoryRow } from "@/adapters/voice/vaanivoice/client";
import type { Deps } from "./deps";
import { processVaaniCall } from "./vaanivoice-process";

// Vaani documents no retry for a webhook that failed, so a call can reach us only if its webhook happens to work. This is the safety net: on every tick it reads
// Vaani's own call history and processes any INBOUND call we have no finished record of. It is idempotent (the pipeline ignores a call it has processed) and it
// never alerts for what is merely slow: a call that cannot be read for an hour is recorded as FAILED, so it is on the dashboard and the owner hears once.
export const GRACE_MS = 10 * 60_000;     // a call that ended less than this ago: its webhook is probably still on the way
export const PENDING_MS = 30 * 60_000;   // a row we started and never finished (status pending) is retried after this
export const STALE_MS = 60 * 60_000;     // a call that still cannot be read this long after it ended is recorded as failed
export const LOOKBACK_MS = 3 * 86_400_000;
export const MAX_PER_RUN = 5;            // keeps one tick short; a long outage catches up over several ticks

export interface ReconcileResult { checked: number; recovered: number; waiting: number; failedRecorded: number; skipped?: string }
const isInbound = (r: VaaniHistoryRow) => /^(in|incoming)/i.test(r.direction ?? "") || /^inbound$/i.test(r.call_type ?? "");

export async function reconcileVaani(deps: Deps): Promise<ReconcileResult> {
  const out: ReconcileResult = { checked: 0, recovered: 0, waiting: 0, failedRecorded: 0 };
  if (!deps.pipeline) return { ...out, skipped: "extractor_not_configured" };
  if (!deps.vaaniVoiceConfigured) return { ...out, skipped: "vaanivoice_not_configured" };
  const now = deps.now().getTime();
  let history: VaaniHistoryRow[];
  try { history = await deps.vaaniVoice.recentCalls(new Date(now - LOOKBACK_MS)); }
  catch (e) {
    // Without the history there is nothing to reconcile against. That is a degradation, not a crash: say so once a day instead of failing the tick every minute.
    const why = String((e as Error).message).slice(0, 80);
    const day = new Date(now + 330 * 60_000).toISOString().slice(0, 10);
    log("error", "vaanivoice reconcile: call history unavailable", { error: why });
    await deps.postcall.enqueue("owner_alert", { flag: "other", vendorCallId: "vaani-call-history", severity: "high",
      evidence: `Vaani's call history is not responding (${why}). A call whose webhook failed cannot be recovered until it works, and new calls may be missing the caller's number. Ask Vaani support.` }, `owner_alert:vaani_history_down:${day}`);
    return { ...out, skipped: "vaani_history_unavailable" };
  }
  const candidates = history.filter((r) => r.call_id && isInbound(r) && r.End_time && Number.isFinite(Date.parse(r.End_time)))
    .sort((a, b) => Date.parse(a.End_time!) - Date.parse(b.End_time!));

  for (const row of candidates) {
    if (out.recovered + out.failedRecorded >= MAX_PER_RUN) break;
    const id = row.call_id, age = now - Date.parse(row.End_time!);
    if (age < GRACE_MS) continue;
    const have = await deps.postcall.getCall(id);
    if (have && have.postCallStatus !== "pending") continue;       // processed, or already recorded as failed
    if (have && age < PENDING_MS) continue;                        // possibly being processed right now
    out.checked++;

    const status = row.post_processing_status;
    const readable = !status || status === "completed";            // Vaani has its transcript and entities only once post-processing is completed
    if (readable) {
      const r = await processVaaniCall(deps, id, { history: row, eventTimestamp: row.End_time });
      if (r.kind === "processed") { out.recovered++; log("info", "vaanivoice reconcile: recovered a call", { vendor_call_id: id, status: r.result.status }); continue; }
      if (r.kind === "ignored") continue;
      log("warn", "vaanivoice reconcile: call not readable yet", { vendor_call_id: id, reason: r.kind === "error" ? r.detail.slice(0, 120) : r.reason });
    }
    if (age < STALE_MS) { out.waiting++; continue; }

    // An hour on, still unreadable: make it visible. The pipeline records a failed call (outcome "review", extraction_failed) and alerts the owner once.
    const started = Date.parse(row.Start_time ?? "");
    await deps.pipeline.process({ vendor: "vaanivoice", vendorCallId: id, callerPhone: /^\+\d{8,15}$/.test(row.from_number ?? "") ? row.from_number : undefined,
      rangAt: Number.isFinite(started) ? new Date(started).toISOString() : undefined, endedAt: new Date(Date.parse(row.End_time!)).toISOString(),
      durationS: typeof row.duration_ms === "number" ? Math.round(row.duration_ms / 1000) : undefined, endedReason: "failed", transcript: [] });
    out.failedRecorded++;
    log("error", "vaanivoice reconcile: call never became readable; recorded as failed", { vendor_call_id: id, vaani_status: status ?? null });
  }
  return out;
}
