import type { CostRow } from "@/core/postcall/costs";
import type {
  CallPatch, CallRow, EnquiryRow, EnquiryUpsert, EscalationInput, EscalationRow, EvaluationInput, EvaluationRow, FlagInput, FlagRow, OutboxKind, OutboxRow, PostCallRepo,
} from "@/core/postcall/repo";
import { hashPhone, maskPhone } from "@/lib/phone";
import { decryptPhone, encryptPhone } from "@/lib/phone-crypto";
import type { SqlClient } from "./pg-booking-repo";
import { SCOPE } from "./scope";

const iso = (d: Date) => d.toISOString();
const date = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const jsonOf = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const toBuffer = (v: unknown): Buffer => (Buffer.isBuffer(v) ? v : v instanceof Uint8Array ? Buffer.from(v) : Buffer.from(String(v).replace(/^\\x/, ""), "hex"));
const versionNumber = (v: string) => Number(v.replace(/\D/g, ""));

// CallPatch key -> [column, serializer]
const CALL_COLS: Record<string, [string, (v: never) => unknown]> = {
  callerId: ["caller_id", (v) => v], enquiryId: ["enquiry_id", (v) => v], parentCallId: ["parent_call_id", (v) => v],
  rangAt: ["rang_at", (v: Date | null) => (v ? iso(v) : null)], answeredAt: ["answered_at", (v: Date | null) => (v ? iso(v) : null)], endedAt: ["ended_at", (v: Date | null) => (v ? iso(v) : null)],
  durationS: ["duration_s", (v) => v], afterHours: ["after_hours", (v) => v], intent: ["intent", (v) => v], outcome: ["outcome", (v) => v], endedReason: ["ended_reason", (v) => v],
  disclosureOk: ["disclosure_ok", (v) => v], recordingRef: ["recording_path", (v) => v],
  recordingExpiresAt: ["recording_expires_at", (v: Date | null) => (v ? iso(v) : null)], transcript: ["transcript", (v) => (v === null ? null : JSON.stringify(v))],
  summary: ["summary", (v) => v], contactName: ["contact_name", (v) => v], contactEmail: ["contact_email", (v) => v], postCallStatus: ["post_call_status", (v) => v], processedAt: ["processed_at", (v: Date | null) => (v ? iso(v) : null)],
  costAiInr: ["cost_ai_inr", (v) => v], costVoiceInr: ["cost_voice_inr", (v) => v], costTotalInr: ["cost_total_inr", (v) => v],
};
const CAST: Record<string, string> = { rang_at: "::timestamptz", answered_at: "::timestamptz", ended_at: "::timestamptz", recording_expires_at: "::timestamptz", processed_at: "::timestamptz", transcript: "::jsonb" };

const callOf = (r: Record<string, unknown>): CallRow => ({
  id: r.id as string, vendorCallId: r.vaani_call_id as string, callerId: (r.caller_id as string) ?? null, enquiryId: (r.enquiry_id as string) ?? null,
  parentCallId: (r.parent_call_id as string) ?? null, rangAt: date(r.rang_at), answeredAt: date(r.answered_at), endedAt: date(r.ended_at), durationS: num(r.duration_s),
  afterHours: (r.after_hours as boolean) ?? null, intent: (r.intent as string) ?? null, outcome: (r.outcome as CallRow["outcome"]) ?? null, endedReason: (r.ended_reason as string) ?? null,
  disclosureOk: (r.disclosure_ok as boolean) ?? null, recordingRef: (r.recording_path as string) ?? null, recordingExpiresAt: date(r.recording_expires_at),
  transcript: r.transcript == null ? null : (jsonOf(r.transcript) as CallRow["transcript"]), summary: (r.summary as string) ?? null, contactName: (r.contact_name as string) ?? null, contactEmail: (r.contact_email as string) ?? null,
  postCallStatus: r.post_call_status as CallRow["postCallStatus"], processedAt: date(r.processed_at), costAiInr: num(r.cost_ai_inr), costVoiceInr: num(r.cost_voice_inr), costTotalInr: num(r.cost_total_inr),
});

const enquiryOf = (r: Record<string, unknown>, ruleVersion: string): EnquiryRow => ({
  id: r.id as string, callerId: (r.caller_id as string) ?? null, channel: r.channel as string, input: jsonOf(r.rule_input) as EnquiryRow["input"], fit: r.fit as EnquiryRow["fit"],
  reasonCodes: (r.reason_codes as string[]) ?? [], missingFields: (r.missing_fields as string[]) ?? [], nextAction: (r.next_action as string) ?? null,
  flags: Object.keys((jsonOf(r.flags) as Record<string, unknown>) ?? {}), ruleVersion, language: (r.language as string) ?? null, currentState: (r.current_state as string) ?? null,
  sourceHeard: (r.source_heard as string) ?? null, timelineRaw: (r.timeline_raw as string) ?? null, designerNote: (r.designer_note as string) ?? null,
});

/** Postgres implementation of the post-call store. Phones are stored hashed (lookup) and encrypted (callbacks): never in plaintext. */
export class PgPostCallRepo implements PostCallRepo {
  constructor(private db: SqlClient, private keys: { pepper: string; encKey: string }) {}

  async upsertCaller(i: { phone: string; name?: string; email?: string; language?: string }) {
    const { rows } = await this.db.query(
      `insert into callers(phone_hash, phone_enc, phone_masked, name, email, language) values ($1,$2,$3,$4,$5,$6)
       on conflict (phone_hash) do update set last_seen_at = now(), name = coalesce(excluded.name, callers.name), email = coalesce(excluded.email, callers.email), language = coalesce(excluded.language, callers.language)
       returning id`,
      [hashPhone(i.phone, this.keys.pepper), encryptPhone(i.phone, this.keys.encKey), maskPhone(i.phone), i.name ?? null, i.email ?? null, i.language ?? null]);
    return { id: rows[0]!.id as string };
  }

  async callerContact(callerId: string) {
    const { rows } = await this.db.query("select phone_enc, name, email from callers where id = $1 and deleted_at is null", [callerId]);
    const r = rows[0];
    if (!r) return null;
    return { phone: decryptPhone(toBuffer(r.phone_enc), this.keys.encKey), name: (r.name as string) ?? null, email: (r.email as string) ?? null };
  }
  async getCrmLink(enquiryId: string) {
    const { rows } = await this.db.query("select hubspot_contact_id, hubspot_deal_id from crm_links where enquiry_id = $1", [enquiryId]);
    return rows[0] ? { contactId: rows[0].hubspot_contact_id as string, dealId: rows[0].hubspot_deal_id as string } : null;
  }
  async saveCrmLink(enquiryId: string, link: { contactId: string; dealId: string }, at: Date = new Date()) {
    await this.db.query("insert into crm_links(enquiry_id, hubspot_contact_id, hubspot_deal_id, stage, stage_changed_at, synced_at) values ($1,$2,$3,'new',$4::timestamptz,$4::timestamptz) on conflict (enquiry_id) where enquiry_id is not null do nothing", [enquiryId, link.contactId, link.dealId, iso(at)]);
  }
  async dueCrmLinks(now: Date, limit: number) {
    const { rows } = await this.db.query(
      `select l.enquiry_id, l.hubspot_deal_id, l.stage, l.deal_amount_inr from crm_links l
       where l.is_demo = ${SCOPE} and l.enquiry_id is not null and l.hubspot_deal_id is not null
         and (l.synced_at is null or l.synced_at <= $1::timestamptz - (case when l.stage in ('won','lost') then interval '6 hours' else interval '5 minutes' end))
       order by l.synced_at nulls first, l.id limit $2`, [iso(now), limit]);
    return rows.map((r) => ({ enquiryId: r.enquiry_id as string, dealId: r.hubspot_deal_id as string, stage: (r.stage as string) ?? null, dealAmountInr: num(r.deal_amount_inr) }));
  }
  async recordDealSync(enquiryId: string, u: { at: Date; stage?: string; amountInr?: number | null }) {
    await this.db.query(
      `update crm_links set synced_at = $2::timestamptz,
         stage_changed_at = case when $3::text is not null and stage is distinct from $3::text then $2::timestamptz else stage_changed_at end,
         stage = coalesce($3::text, stage),
         deal_amount_inr = case when $4::boolean then $5::numeric else deal_amount_inr end
       where enquiry_id = $1`, [enquiryId, iso(u.at), u.stage ?? null, u.amountInr !== undefined, u.amountInr ?? null]);
  }
  async getCrmLinkState(enquiryId: string) {
    const { rows } = await this.db.query("select stage, deal_amount_inr, stage_changed_at, synced_at from crm_links where enquiry_id = $1", [enquiryId]);
    const r = rows[0];
    return r ? { stage: (r.stage as string) ?? null, dealAmountInr: num(r.deal_amount_inr), stageChangedAt: date(r.stage_changed_at), syncedAt: date(r.synced_at) } : null;
  }

  async updateCaller(callerId: string, patch: { name?: string; email?: string; language?: string }) {
    await this.db.query("update callers set name = coalesce($2, name), email = coalesce($3, email), language = coalesce($4, language), last_seen_at = now() where id = $1", [callerId, patch.name ?? null, patch.email ?? null, patch.language ?? null]);
  }

  async upsertCall(vendorCallId: string, patch: CallPatch) {
    const cols: string[] = [], vals: unknown[] = [vendorCallId];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const m = CALL_COLS[k];
      if (!m) throw new Error(`unknown call field ${k}`);
      vals.push(m[1](v as never));
      cols.push(m[0]);
    }
    const insertCols = ["vaani_call_id", ...cols].join(", ");
    const placeholders = ["$1", ...cols.map((c, i) => `$${i + 2}${CAST[c] ?? ""}`)].join(", ");
    const updates = cols.length ? cols.map((c, i) => `${c} = $${i + 2}${CAST[c] ?? ""}`).join(", ") : "vaani_call_id = excluded.vaani_call_id";
    const { rows } = await this.db.query(`insert into calls(${insertCols}) values (${placeholders}) on conflict (vaani_call_id) do update set ${updates} returning *`, vals);
    return callOf(rows[0]!);
  }
  async getCall(vendorCallId: string) { const { rows } = await this.db.query("select * from calls where vaani_call_id=$1", [vendorCallId]); return rows[0] ? callOf(rows[0]) : null; }
  async recentCallsForCaller(callerId: string, since: Date) {
    const { rows } = await this.db.query("select * from calls where caller_id=$1 and ended_at >= $2::timestamptz order by ended_at desc", [callerId, iso(since)]);
    return rows.map(callOf);
  }

  async upsertEnquiry(e: EnquiryUpsert) {
    const i = e.input;
    const flags = JSON.stringify(Object.fromEntries(e.flags.map((f) => [f, true])));
    const v = versionNumber(e.ruleVersion);
    const values = [e.callerId ?? null, e.channel ?? "phone", i.location ?? null, i.project_type ?? null, i.scope ?? null, i.rooms_count ?? null, i.bhk ?? null, i.is_villa ?? null,
      i.carpet_sqft ?? null, e.currentState ?? null, e.timelineRaw ?? null, i.deadline_date ?? null, i.start_date ?? null, i.possession_date ?? null, i.decision_maker ?? null,
      i.owners_attending ?? null, i.tenure ?? null, i.landlord_consent ?? null, i.structural_work ?? null, i.referrer ?? null, e.sourceHeard ?? null, i.budget_inr ?? null,
      e.language ?? null, !!i.price_asked, flags, e.fit, e.reasonCodes, e.missingFields ?? [], e.nextAction ?? null, e.designerNote ?? null, JSON.stringify(i), v];
    const cols = ["caller_id", "channel", "location_raw", "project_type", "scope", "rooms_count", "bhk", "is_villa", "carpet_sqft", "current_state", "timeline_raw", "deadline_date",
      "start_date", "possession_date", "decision_maker", "owners_attending", "tenure", "landlord_consent", "structural_work", "referrer", "source_heard", "caller_budget_inr",
      "language", "asked_for_number", "flags", "fit", "reason_codes", "missing_fields", "next_action", "designer_note", "rule_input"];
    const cast = (c: string) => (c === "flags" || c === "rule_input" ? "::jsonb" : c.endsWith("_date") && c !== "possession_date" ? "::date" : c === "possession_date" ? "::date" : "");
    const n = cols.length;                                    // placeholders $1..$n for columns, $n+1 for the rule version number
    const set = cols.map((c, k) => `${c} = $${k + 1}${cast(c)}`).join(", ");
    const ph = cols.map((c, k) => `$${k + 1}${cast(c)}`).join(", ");
    const versionSql = `(select id from rule_versions where version = $${n + 1})`;
    let row: Record<string, unknown>;
    if (e.id) {
      const upd = await this.db.query(`update enquiries set ${set}, rule_version_id = ${versionSql}, updated_at = now() where id = $${n + 2} returning *`, [...values, e.id]);
      if (upd.rows[0]) row = upd.rows[0];
      else row = (await this.db.query(`insert into enquiries(id, ${cols.join(", ")}, rule_version_id) values ($${n + 2}, ${ph}, ${versionSql}) returning *`, [...values, e.id])).rows[0]!;
    } else {
      row = (await this.db.query(`insert into enquiries(${cols.join(", ")}, rule_version_id) values (${ph}, ${versionSql}) returning *`, values)).rows[0]!;
    }
    return enquiryOf(row, e.ruleVersion);
  }
  async getEnquiry(id: string) {
    const { rows } = await this.db.query("select q.*, rv.version as rv_version from enquiries q join rule_versions rv on rv.id = q.rule_version_id where q.id=$1", [id]);
    return rows[0] ? enquiryOf(rows[0], `v${rows[0].rv_version}`) : null;
  }

  async recordEvaluation(e: EvaluationInput) {
    await this.db.query(
      // clock_timestamp(), not the default now(). Two evaluations can still land in the same millisecond, so `latestEvaluation` breaks ties by insertion order (ctid; this table is insert-only), never by the random id.
      `insert into rule_evaluations(enquiry_id, call_id, phase, input, fit, reason_codes, rule_version_id, call_date, evaluated_at)
       values ($1, (select id from calls where vaani_call_id=$2), $3, $4::jsonb, $5, $6, (select id from rule_versions where version=$7), $8::timestamptz, clock_timestamp())`,
      [e.enquiryId ?? null, e.vendorCallId, e.phase, JSON.stringify(e.input), e.fit, e.reasonCodes, versionNumber(e.ruleVersion), iso(e.callDate)]);
  }
  async latestEvaluation(vendorCallId: string, phase: "live" | "post_call"): Promise<EvaluationRow | null> {
    const { rows } = await this.db.query(
      `select ev.phase, ev.fit, ev.reason_codes, ev.evaluated_at, ev.enquiry_id, rv.version from rule_evaluations ev join calls c on c.id = ev.call_id join rule_versions rv on rv.id = ev.rule_version_id
       where c.vaani_call_id=$1 and ev.phase=$2 order by ev.evaluated_at desc, ev.ctid desc limit 1`, [vendorCallId, phase]);
    const r = rows[0];
    return r ? { phase: r.phase as EvaluationRow["phase"], fit: r.fit as EvaluationRow["fit"], reasonCodes: r.reason_codes as string[], ruleVersion: `v${r.version}`, evaluatedAt: date(r.evaluated_at)!, enquiryId: (r.enquiry_id as string) ?? null } : null;
  }

  async addFlag(f: FlagInput): Promise<FlagRow> {
    const { rows } = await this.db.query(
      "insert into audit_flags(call_id, kind, severity, evidence, detected_by) values ((select id from calls where vaani_call_id=$1), $2, $3, $4, $5) returning id, kind, severity, evidence, detected_by",
      [f.vendorCallId, f.kind, f.severity ?? "high", f.evidence ?? null, f.detectedBy]);
    const r = rows[0]!;
    return { id: r.id as string, kind: r.kind as FlagRow["kind"], severity: r.severity as string, evidence: (r.evidence as string) ?? null, detectedBy: (r.detected_by as string) ?? null };
  }
  async listFlags(vendorCallId: string): Promise<FlagRow[]> {
    const { rows } = await this.db.query("select a.id, a.kind, a.severity, a.evidence, a.detected_by from audit_flags a join calls c on c.id=a.call_id where c.vaani_call_id=$1 order by a.created_at, a.id", [vendorCallId]);
    return rows.map((r) => ({ id: r.id as string, kind: r.kind as FlagRow["kind"], severity: r.severity as string, evidence: (r.evidence as string) ?? null, detectedBy: (r.detected_by as string) ?? null }));
  }

  async addUsageCosts(vendorCallId: string, rows: CostRow[], at: Date) {
    const month = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;
    for (const r of rows)
      await this.db.query(
        `insert into usage_costs(call_id, occurred_at, period_month, line, provider, quantity, unit, unit_cost, currency, fx_inr_per_usd, amount_inr, source)
         values ((select id from calls where vaani_call_id=$1), $2::timestamptz, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [vendorCallId, iso(at), month, r.line, r.provider, r.quantity, r.unit, r.unitCost, r.currency, r.fxInrPerUsd, r.amountInr, r.source]);
  }

  async recordEscalation(vendorCallId: string, e: EscalationInput) {
    await this.db.query(
      `insert into escalations(call_id, caller_id, reason, mode, callback_due_at, sla_minutes, queue, queue_escalates_to)
       select c.id, c.caller_id, $2, $3, $4::timestamptz, $5, $6, $7 from calls c where c.vaani_call_id=$1`,
      [vendorCallId, e.reason, e.mode, e.callbackDueAt ? iso(e.callbackDueAt) : null, e.slaMinutes ?? null, e.queue ?? null, e.queueEscalatesTo ?? null]);
  }
  async escalationsForCall(vendorCallId: string): Promise<EscalationRow[]> {
    const { rows } = await this.db.query("select e.reason, e.mode, e.callback_due_at, e.sla_minutes from escalations e join calls c on c.id=e.call_id where c.vaani_call_id=$1 order by e.created_at, e.id", [vendorCallId]);
    return rows.map((r) => ({ reason: r.reason as string, mode: (r.mode as string) ?? null, callbackDueAt: date(r.callback_due_at), slaMinutes: num(r.sla_minutes) }));
  }

  async enqueue(kind: OutboxKind, payload: Record<string, unknown>, dedupeKey: string) {
    const { rows } = await this.db.query("insert into outbox(kind, payload, dedupe_key) values ($1,$2::jsonb,$3) on conflict (dedupe_key) do nothing returning id", [kind, JSON.stringify(payload), dedupeKey]);
    return rows.length > 0;
  }
  async pendingOutbox(kinds: OutboxKind[], limit: number): Promise<OutboxRow[]> {
    const { rows } = await this.db.query(`select id, kind, payload, dedupe_key, status, attempts from outbox where status='pending' and is_demo = ${SCOPE} and kind = any($1::text[]) order by created_at, id limit $2`, [kinds, limit]);
    return rows.map((r) => ({ id: r.id as string, kind: r.kind as OutboxKind, payload: jsonOf(r.payload) as Record<string, unknown>, dedupeKey: r.dedupe_key as string, status: r.status as OutboxRow["status"], attempts: Number(r.attempts) }));
  }
  async markOutbox(id: string, status: "processed" | "failed" | "pending", error?: string) {
    await this.db.query("update outbox set status=$2, attempts=attempts+1, last_error=$3, processed_at = case when $2='processed' then now() else processed_at end where id=$1", [id, status, error ?? null]);
  }
}
