import { timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";
import { parseVaaniVoiceEvent } from "@/adapters/voice/vaanivoice/record";
import { processVaaniCall } from "../vaanivoice-process";
import type { Deps } from "../deps";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/**
 * vaanivoice.ai end-of-call webhook. Vaani documents NO signature, so: (1) the URL carries an unguessable secret segment, and
 * (2) the body is never trusted for content: only the call id is read from it, and the transcript, entities, numbers and times are
 * re-fetched from Vaani's own API with our key. A forged POST can at most make us look a call up.
 * Only `call_postprocessing` (the event that carries the finished transcript) is processed; the rest are acknowledged.
 * A failure answers 503 (so Vaani may retry) and tells the owner once; it is never swallowed.
 */
export async function handleVaaniVoiceWebhook(req: Request, deps: Deps, secretSegment: string): Promise<Response> {
  const want = deps.env.VAANIVOICE_WEBHOOK_SECRET;
  if (!want) return json(503, { error: "webhook_secret_not_configured" });
  if (!same(secretSegment, want)) return json(404, { error: "not_found" }); // reveal nothing about the route

  const raw = await req.text();
  let body: unknown = null;
  if (raw.trim()) { try { body = JSON.parse(raw); } catch { return json(400, { error: "bad_json" }); } }
  const ev = parseVaaniVoiceEvent(body);
  if (!ev) {
    // The real end-of-call event without a call id is a genuine problem: say so. Anything else that is not a call event
    // (Vaani's "Test Connectivity" button, a future event type) is acknowledged and ignored, so the setup screen passes.
    const named = typeof body === "object" && body !== null ? (body as { event?: unknown }).event : undefined;
    if (named === "call_postprocessing") return json(400, { error: "bad_event" });
    log("info", "vaanivoice_webhook", { ignored: true, reason: "not_a_call_event", keys: typeof body === "object" && body !== null ? Object.keys(body).slice(0, 12) : [] });
    return json(200, { ok: true, ignored: "not_a_call_event" });
  }
  if (ev.event !== "call_postprocessing") { log("info", "vaanivoice_webhook", { event: ev.event, ignored: true }); return json(200, { ok: true, ignored: ev.event }); }
  if (!deps.pipeline) return json(503, { error: "extractor_not_configured" });

  const id = ev.callId;
  const fail = async (reason: string, detail: string): Promise<Response> => {
    log("error", "vaanivoice_webhook: call not processed", { vendor_call_id: id, reason, detail: detail.slice(0, 160) });
    await deps.postcall.enqueue("owner_alert", { flag: "other", vendorCallId: id, severity: "high",
      evidence: `Vaani call ${id} could not be processed (${reason}). It is not in the system until Vaani retries the webhook or someone re-sends it.` }, `owner_alert:vaanivoice:${id}`);
    return json(503, { error: reason });
  };

  const r = await processVaaniCall(deps, id, { eventTimestamp: ev.timestamp });
  if (r.kind === "not_ready") return fail("transcript_not_ready", "call_details has no transcript yet");
  if (r.kind === "error") return fail("fetch_or_processing_error", r.detail);
  if (r.kind === "ignored") { log("warn", "vaanivoice_webhook: not an inbound call; ignored", { vendor_call_id: id }); return json(200, { ok: true, ignored: r.reason }); }
  deps.repo.recordWebhookEvent(`vaanivoice:${id}`, ev.event, deps.now().toISOString());
  log("info", "vaanivoice_webhook", { vendor_call_id: id, status: r.result.status, outcome: r.result.outcome, flags: r.result.flags });
  return json(200, { ok: true, status: r.result.status, outcome: r.result.outcome, flags: r.result.flags }); // a summary only: no transcript, number or email
}
