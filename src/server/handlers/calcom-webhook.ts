import { createHmac, timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";
import { hashPhone, normalizeE164 } from "@/lib/phone";
import type { CalStatus } from "@/core/calcom/types";
import type { Deps } from "../deps";

// Header `x-cal-signature-256`: HMAC-SHA256 of the raw body with the webhook's secret (cal.com docs; the encoding is not stated, so hex and base64 are both accepted).
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function signatureOk(raw: string, given: string | null, secret: string): boolean {
  if (!given) return false;
  const mac = createHmac("sha256", secret).update(raw).digest();
  const candidates = [mac.toString("hex"), mac.toString("base64")];
  const g = Buffer.from(given.trim());
  return candidates.some((c) => { const w = Buffer.from(c); return w.length === g.length && timingSafeEqual(w, g); });
}

const STATUS: Record<string, CalStatus> = { ACCEPTED: "accepted", CANCELLED: "cancelled", PENDING: "pending", REJECTED: "rejected", AWAITING_HOST: "pending", RESCHEDULED: "rescheduled" };
const TRIGGERS: Record<string, CalStatus | undefined> = { BOOKING_CREATED: undefined, BOOKING_CANCELLED: "cancelled", BOOKING_REJECTED: "rejected", BOOKING_RESCHEDULED: "rescheduled" };

interface Payload { uid?: string; startTime?: string; endTime?: string; title?: string; eventTypeId?: number; status?: string; attendees?: { email?: string; name?: string; phoneNumber?: string | null }[] }

export async function handleCalcomWebhook(req: Request, deps: Deps): Promise<Response> {
  const secret = deps.env.CALCOM_SIGNING_SECRET;
  if (!secret) return json(503, { error: "signing_secret_not_configured" });
  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get("x-cal-signature-256"), secret)) return json(401, { error: "bad_signature" });

  let body: { triggerEvent?: string; createdAt?: string; payload?: Payload };
  try { body = JSON.parse(raw); } catch { return json(400, { error: "bad_json" }); }
  const trigger = body.triggerEvent ?? "";
  if (!(trigger in TRIGGERS)) return json(200, { ok: true, ignored: trigger || "unknown" });

  const p = body.payload ?? {};
  const start = p.startTime ? new Date(p.startTime) : null, end = p.endTime ? new Date(p.endTime) : null;
  if (!p.uid || !start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return json(200, { ok: true, ignored: "incomplete" });

  const status = TRIGGERS[trigger] ?? STATUS[String(p.status ?? "").toUpperCase()] ?? "pending";
  const a = p.attendees?.[0];
  const created = body.createdAt ? new Date(body.createdAt) : deps.now();
  // Normalised to E.164 before hashing (the call side does the same), or "98765 43210" and "+919876543210" would never match.
  const phone = a?.phoneNumber ? normalizeE164(a.phoneNumber) : null;
  await deps.calStore.upsert({
    uid: p.uid, eventTypeId: typeof p.eventTypeId === "number" ? p.eventTypeId : null, title: p.title ?? null, status, startsAt: start, endsAt: end,
    attendeeEmail: a?.email ? a.email.toLowerCase() : null, attendeeName: a?.name ?? null,
    attendeePhoneHash: phone ? hashPhone(phone, deps.env.PHONE_HASH_PEPPER) : null,
    createdAt: Number.isNaN(created.getTime()) ? deps.now() : created,
  });
  log("info", "calcom_webhook", { trigger, uid: p.uid, status });

  if (status === "cancelled" || status === "rescheduled") {
    const existing = await deps.calStore.get(p.uid);
    if (existing?.claimedByCall) {
      await deps.postcall.enqueue("design_lead_alert", { kind: status === "cancelled" ? "booking_cancelled" : "booking_rescheduled", vendorCallId: existing.claimedByCall, startsAt: start.toISOString() },
        `design_lead_alert:${status}:${p.uid}`);
    }
  }
  if (status === "accepted") {
    // The booking may have arrived after its call was already processed: try to match it now. The booking is stored, so a failure here must not make Cal.com retry.
    try { await deps.router.routePending(); } catch (err) { log("error", "calcom_webhook: routing failed; the tick will retry", { uid: p.uid, error: String(err).slice(0, 200) }); }
  }
  return json(200, { ok: true });
}
