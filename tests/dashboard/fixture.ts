import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "../db/helpers";
import { encryptPhone } from "@/lib/phone-crypto";
import { hashPhone, maskPhone } from "@/lib/phone";

export const PEPPER = "pepper-0123456789ab";
export const ENC_KEY = "0".repeat(63) + "2";
/** September 2026 in IST, as the [from, to) instants the metrics take. */
export const SEP = { from: new Date("2026-08-31T18:30:00Z"), to: new Date("2026-09-30T18:30:00Z") };
export const ist = (s: string) => new Date(`2026-${s}+05:30`);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export class World {
  constructor(public db: PGlite) {}
  async demo(on: boolean) { await this.db.query("select set_config('app.demo', $1, false)", [on ? "on" : "off"]); }
  private async one(sql: string, p: unknown[]) { return (await this.db.query<{ id: string }>(sql, p)).rows[0]!.id; }

  caller(name: string, phone: string, email: string | null = null) {
    return this.one("insert into callers(phone_hash, phone_enc, phone_masked, name, email) values ($1,$2,$3,$4,$5) returning id", [hashPhone(phone, PEPPER), encryptPhone(phone, ENC_KEY), maskPhone(phone), name, email]);
  }
  designer(name: string, o: { demo?: boolean } = {}) { return this.one("insert into designers(name, active) values ($1, true) returning id", [name]).then(async (id) => { if (o.demo) await this.db.query("update designers set is_demo=true where id=$1", [id]); return id; }); }
  enquiry(o: { callerId?: string | null; fit?: "fit" | "not_fit" | "unclear"; reasons?: string[]; location?: string | null; projectType?: string | null; scope?: string | null; language?: string | null; askedPrice?: boolean; note?: string | null }) {
    return this.one(
      `insert into enquiries(caller_id, fit, reason_codes, location_raw, project_type, scope, language, asked_for_number, designer_note, rule_input, rule_version_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}'::jsonb,(select id from rule_versions where status='active')) returning id`,
      [o.callerId ?? null, o.fit ?? null, o.reasons ?? [], o.location ?? null, o.projectType ?? "home", o.scope ?? null, o.language ?? "en", !!o.askedPrice, o.note ?? null]);
  }
  call(id: string, o: { rang: Date | null; answeredAfterS?: number | null; durationS?: number; callerId?: string | null; enquiryId?: string | null; intent?: string | null; outcome?: string | null; afterHours?: boolean;
    endedReason?: string; transcript?: unknown; summary?: string; recording?: string; status?: string }) {
    const answered = o.rang && o.answeredAfterS != null ? new Date(o.rang.getTime() + o.answeredAfterS * 1000) : null;
    return this.one(
      `insert into calls(vaani_call_id, caller_id, enquiry_id, rang_at, answered_at, ended_at, duration_s, after_hours, intent, outcome, ended_reason, transcript, summary, recording_path, post_call_status)
       values ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15) returning id`,
      [id, o.callerId ?? null, o.enquiryId ?? null, iso(o.rang), iso(answered), o.rang ? iso(new Date(o.rang.getTime() + (o.durationS ?? 300) * 1000)) : null, o.durationS ?? 300, o.afterHours ?? false,
        o.intent ?? "new_enquiry", o.outcome ?? null, o.endedReason ?? "completed", o.transcript ? JSON.stringify(o.transcript) : null, o.summary ?? null, o.recording ?? null, o.status ?? "processed"]);
  }
  booking(o: { enquiryId: string; designerId: string; startsAt: Date; status?: string }) {
    return this.one("insert into bookings(enquiry_id, designer_id, starts_at, ends_at, status) values ($1,$2,$3::timestamptz,$4::timestamptz,$5) returning id",
      [o.enquiryId, o.designerId, iso(o.startsAt), iso(new Date(o.startsAt.getTime() + 3_600_000)), o.status ?? "confirmed"]);
  }
  handoff(o: { bookingId: string; designerId: string; sentAt: Date | null; acceptedAt?: Date | null; status: string; attempt?: number; declinedAt?: Date | null }) {
    return this.one("insert into handoffs(booking_id, designer_id, attempt_no, sent_at, due_at, accepted_at, declined_at, status) values ($1,$2,$3,$4::timestamptz,$4::timestamptz,$5::timestamptz,$6::timestamptz,$7) returning id",
      [o.bookingId, o.designerId, o.attempt ?? 1, iso(o.sentAt), iso(o.acceptedAt), iso(o.declinedAt), o.status]);
  }
  crm(enquiryId: string, stage: string | null, amount: number | null = null, dealId = `deal-${enquiryId.slice(0, 6)}`) {
    return this.one("insert into crm_links(enquiry_id, hubspot_contact_id, hubspot_deal_id, stage, deal_amount_inr) values ($1,'c',$2,$3,$4) returning id", [enquiryId, dealId, stage, amount]);
  }
  cost(callId: string | null, line: string, amount: number, at: Date, source = "computed") {
    return this.db.query("insert into usage_costs(call_id, occurred_at, period_month, line, provider, currency, amount_inr, source) values ($1,$2::timestamptz,date_trunc('month',$2::timestamptz)::date,$3,'x','INR',$4,$5)", [callId, iso(at), line, amount, source]);
  }
  flag(callId: string, kind: string) { return this.db.query("insert into audit_flags(call_id, kind) values ($1,$2)", [callId, kind]); }
  escalation(callId: string, reason: string, createdAt: Date, resolvedAt: Date | null) {
    return this.db.query("insert into escalations(call_id, reason, mode, created_at, resolved_at) values ($1,$2,'callback_sla',$3::timestamptz,$4::timestamptz)", [callId, reason, iso(createdAt), iso(resolvedAt)]);
  }
  calcom(uid: string, createdAt: Date, claimedBy: string | null) {
    return this.db.query("insert into calcom_bookings(uid, status, starts_at, ends_at, created_at, claimed_by_call) values ($1,'accepted',$2::timestamptz,$2::timestamptz + interval '1 hour',$2::timestamptz,$3)", [uid, iso(createdAt), claimedBy]);
  }
  alert(kind: string, key: string, createdAt: Date) {
    return this.db.query("insert into outbox(kind, payload, dedupe_key, created_at) values ('design_lead_alert', $1::jsonb, $2, $3::timestamptz)", [JSON.stringify({ kind, vendorCallId: "x" }), key, iso(createdAt)]);
  }
  evaluation(callId: string, enquiryId: string, phase: "live" | "post_call", fit: string, reasons: string[]) {
    return this.db.query("insert into rule_evaluations(enquiry_id, call_id, phase, input, fit, reason_codes, rule_version_id, call_date) values ($1,$2,$3,'{}'::jsonb,$4,$5,(select id from rule_versions where status='active'),now())", [enquiryId, callId, phase, fit, reasons]);
  }
}

/**
 * One September with known answers (every expected number in the metric tests is computed by hand from this):
 *   9 calls in range (c1..c9; c5 missed), 5 enquiries (3 fit, 1 not_fit, 1 unclear), 3 bookings, 4 handoffs (c4's first one timed out and was reassigned),
 *   CRM: E1 won, E2 quote_sent, E4 consult_booked; 2 complaints (one closed in 10 min, one in 40); 1 price flag; costs 1321.50.
 * Plus: one call outside the range (Aug 31) and one DEMO call inside it, which a live view must never count.
 */
export async function september(): Promise<{ w: World; ids: Record<string, string> }> {
  const w = new World(await freshDb({ seed: true }));
  const asha = await w.designer("Asha"), bela = await w.designer("Bela");
  const priya = await w.caller("Priya Shah", "+919000000011"), rahul = await w.caller("Rahul Mehta", "+919000000012"), nina = await w.caller("Nina Rao", "+919000000013");

  const E1 = await w.enquiry({ callerId: priya, fit: "fit", location: "Kothrud", projectType: "home", scope: "full_home", language: "en" });
  const E2 = await w.enquiry({ callerId: rahul, fit: "fit", location: "Baner", projectType: "home", scope: "partial_home", language: "hi", askedPrice: true });
  const E3 = await w.enquiry({ callerId: nina, fit: "not_fit", reasons: ["area_outside_service"], location: "Nashik", projectType: "home", language: "en" });
  const E4 = await w.enquiry({ fit: "fit", location: "Aundh", projectType: "office", scope: "office_fitout", language: "en" });
  const E5 = await w.enquiry({ fit: "unclear", reasons: ["budget_below_scope"], location: "Kharadi", projectType: "home", language: "en" });

  const c1 = await w.call("c1", { rang: ist("09-02T10:00:00"), answeredAfterS: 3, callerId: priya, enquiryId: E1, outcome: "booked", transcript: [{ speaker: "agent", text: "Namaste" }], summary: "3BHK Kothrud", recording: "https://rec/c1" });
  const c2 = await w.call("c2", { rang: ist("09-03T11:00:00"), answeredAfterS: 5, callerId: rahul, enquiryId: E2, outcome: "booked" });
  const c3 = await w.call("c3", { rang: ist("09-04T20:30:00"), answeredAfterS: 2, callerId: nina, enquiryId: E3, outcome: "not_fit", afterHours: true });
  const c4 = await w.call("c4", { rang: ist("09-07T14:00:00"), answeredAfterS: 3, enquiryId: E4, outcome: "booked" });
  const c5 = await w.call("c5", { rang: ist("09-08T09:00:00"), answeredAfterS: null, outcome: "missed", intent: null, endedReason: "missed", afterHours: true, durationS: 0 });
  const c6 = await w.call("c6", { rang: ist("09-09T12:00:00"), answeredAfterS: 4, intent: "complaint", outcome: "escalated" });
  const c7 = await w.call("c7", { rang: ist("09-10T13:00:00"), answeredAfterS: 4, intent: "complaint", outcome: "escalated" });
  const c8 = await w.call("c8", { rang: ist("09-11T15:00:00"), answeredAfterS: 3, enquiryId: E5, outcome: "review" });
  const c9 = await w.call("c9", { rang: ist("09-12T16:00:00"), answeredAfterS: 3, intent: "other", outcome: "closed_other" });
  await w.call("c-aug", { rang: new Date("2026-08-31T11:00:00Z"), answeredAfterS: 2, outcome: "not_fit" });

  const B1 = await w.booking({ enquiryId: E1, designerId: asha, startsAt: ist("09-04T11:00:00"), status: "attended" });
  const B2 = await w.booking({ enquiryId: E2, designerId: bela, startsAt: ist("09-10T11:00:00") });
  const B4 = await w.booking({ enquiryId: E4, designerId: bela, startsAt: ist("09-09T11:00:00") }); // reassigned from Asha to Bela
  await w.handoff({ bookingId: B1, designerId: asha, sentAt: ist("09-02T10:30:00"), acceptedAt: ist("09-02T10:45:00"), status: "accepted" });
  await w.handoff({ bookingId: B2, designerId: bela, sentAt: ist("09-03T11:30:00"), acceptedAt: ist("09-03T12:30:00"), status: "accepted" });
  await w.handoff({ bookingId: B4, designerId: asha, sentAt: ist("09-07T14:30:00"), status: "reassigned" });
  await w.handoff({ bookingId: B4, designerId: bela, sentAt: ist("09-07T15:00:00"), acceptedAt: ist("09-07T15:20:00"), status: "accepted", attempt: 2 });
  await w.crm(E1, "won", 1_200_000); await w.crm(E2, "quote_sent", 800_000); await w.crm(E4, "consult_booked");

  await w.cost(c1, "voice_minutes", 40, ist("09-02T10:05:00")); await w.cost(c1, "ai_tokens_in", 0.5, ist("09-02T10:06:00")); await w.cost(c1, "ai_tokens_out", 1, ist("09-02T10:06:00"));
  await w.cost(c2, "voice_minutes", 30, ist("09-03T11:05:00"));
  await w.cost(null, "phone_number", 750, ist("09-01T00:00:00"), "manual_fixed"); await w.cost(null, "hosting", 500, ist("09-01T00:00:00"), "manual_fixed");
  await w.cost(null, "voice_minutes", 99, new Date("2026-08-31T11:00:00Z")); // August: out of range

  await w.flag(c3, "price_mention"); await w.flag(c8, "rule_disagreement");
  await w.escalation(c6, "complaint", ist("09-09T12:00:00"), ist("09-09T12:10:00"));
  await w.escalation(c7, "complaint", ist("09-10T13:00:00"), ist("09-10T13:40:00"));

  await w.calcom("bk-a", ist("09-02T10:02:00"), "c1"); await w.calcom("bk-b", ist("09-03T11:02:00"), "c2"); await w.calcom("bk-c", ist("09-20T11:00:00"), null);
  await w.alert("booking_ambiguous", "a1", ist("09-14T12:00:00")); await w.alert("booking_missing", "m1", ist("09-15T12:00:00"));
  await w.alert("booking_orphan", "o1", ist("09-16T12:00:00")); await w.alert("booking_orphan", "o2", ist("09-17T12:00:00"));
  await w.evaluation(c1, E1, "post_call", "fit", []);

  // a demo call in the same month: excluded from every live number
  await w.demo(true);
  const dE = await w.enquiry({ fit: "fit", location: "DemoVille" });
  const dc = await w.call("demo-1", { rang: ist("09-06T10:00:00"), answeredAfterS: 1, enquiryId: dE, outcome: "booked" });
  await w.cost(dc, "voice_minutes", 1000, ist("09-06T10:05:00"));
  await w.demo(false);
  return { w, ids: { c1, c2, c3, c4, c5, c6, c7, c8, c9, E1, E2, E3, E4, E5, asha, bela, B1, B2, B4, priya, rahul } };
}
