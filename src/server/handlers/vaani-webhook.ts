import { log } from "@/lib/log";
import { mapVaaniCallCompleted } from "@/adapters/voice/vaani/call-record";
import { parseVaaniEnvelope, verifyVaaniSignature } from "@/adapters/voice/vaani/webhook";
import type { Deps } from "../deps";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleVaaniWebhook(req: Request, deps: Deps): Promise<Response> {
  const secret = deps.env.VAANI_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "webhook_secret_not_configured" }); // never accept unsigned events
  const raw = await req.text(); // exact bytes: the signature covers the raw body
  if (!verifyVaaniSignature(raw, req.headers.get("x-vaanivoice-signature") ?? undefined, secret)) return json(401, { error: "bad_signature" });
  const env = parseVaaniEnvelope(raw);
  if (!env) return json(400, { error: "bad_envelope" });

  // Envelope id is reused across Vaani retries: key idempotency on it.
  const duplicate = deps.repo.recordWebhookEvent(env.id, env.type, deps.now().toISOString());
  log("info", "vaani_webhook", { event: env.type, id: env.id, duplicate });
  if (duplicate) return json(200, { ok: true, duplicate: true });

  // Call events: map to our vendor-neutral record and run the pipeline. The payload fields are undocumented (docs/vaani-findings.md,
  // item 6), so today the mapper returns null: we store the event as 'unmapped', acknowledge it (so Vaani stops retrying) and alert the owner once.
  if (env.type === "call.completed" || env.type === "call.failed") {
    const record = mapVaaniCallCompleted(env);
    if (record && deps.pipeline) {
      await deps.pipeline.process(record);
      deps.repo.setWebhookStatus(env.id, "processed");
      return json(200, { ok: true, duplicate: false, mapped: true });
    }
    deps.repo.setWebhookStatus(env.id, "unmapped");
    await deps.postcall.enqueue("owner_alert", { flag: "other", vendorCallId: env.id, severity: "high",
      evidence: `Vaani ${env.type} received but its payload cannot be mapped yet (fields undocumented). Calls are NOT being post-processed.` }, `owner_alert:vaani_unmapped:${env.type}`);
    return json(200, { ok: true, duplicate: false, mapped: false });
  }
  deps.repo.setWebhookStatus(env.id, "ignored");
  return json(200, { ok: true, duplicate });
}
