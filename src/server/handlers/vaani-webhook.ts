import { log } from "@/lib/log";
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
  // Post-call processing (transcript, extraction, scans) is Session 4; until the payload fields are
  // confirmed against Vaani docs we only acknowledge and de-duplicate.
  return json(200, { ok: true, duplicate });
}
