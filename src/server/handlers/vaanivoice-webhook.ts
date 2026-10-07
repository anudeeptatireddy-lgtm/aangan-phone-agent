import { timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";
import { buildCallRecord, parseVaaniVoiceEvent } from "@/adapters/voice/vaanivoice/record";
import type { Deps } from "../deps";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const INBOUND = /^(in|incoming)/i;

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

  const body = await req.json().catch(() => null);
  const ev = parseVaaniVoiceEvent(body);
  if (!ev) return json(400, { error: "bad_event" });
  if (ev.event !== "call_postprocessing") { log("info", "vaanivoice_webhook", { event: ev.event, ignored: true }); return json(200, { ok: true, ignored: ev.event }); }
  if (!deps.pipeline) return json(503, { error: "extractor_not_configured" });

  const id = ev.callId;
  const fail = async (reason: string, detail: string): Promise<Response> => {
    log("error", "vaanivoice_webhook: call not processed", { vendor_call_id: id, reason, detail: detail.slice(0, 160) });
    await deps.postcall.enqueue("owner_alert", { flag: "other", vendorCallId: id, severity: "high",
      evidence: `Vaani call ${id} could not be processed (${reason}). It is not in the system until Vaani retries the webhook or someone re-sends it.` }, `owner_alert:vaanivoice:${id}`);
    return json(503, { error: reason });
  };

  try {
    const details = await deps.vaaniVoice.getCallDetails(id);
    if (!details) return await fail("transcript_not_ready", "call_details has no transcript yet");
    const history = await deps.vaaniVoice.findInHistory(id);
    if (history && history.direction && !INBOUND.test(history.direction) && !/^inbound$/i.test(history.call_type ?? "")) {
      log("warn", "vaanivoice_webhook: not an inbound call; ignored", { vendor_call_id: id }); // hard rule 5: we place no calls, and never treat one as an enquiry
      return json(200, { ok: true, ignored: "not_inbound" });
    }
    const rate = deps.env.VAANIVOICE_RATE_INR_PER_MIN;
    const result = await deps.pipeline.process(buildCallRecord({ callId: id, details, history, eventTimestamp: ev.timestamp, ratePerMinInr: rate, now: deps.now() }));
    deps.repo.recordWebhookEvent(`vaanivoice:${id}`, ev.event, deps.now().toISOString());
    log("info", "vaanivoice_webhook", { vendor_call_id: id, status: result.status, outcome: result.outcome, flags: result.flags });
    return json(200, { ok: true, status: result.status, outcome: result.outcome, flags: result.flags }); // a summary only: no transcript, number or email
  } catch (err) {
    return fail("fetch_or_processing_error", String((err as Error).message ?? err));
  }
}
