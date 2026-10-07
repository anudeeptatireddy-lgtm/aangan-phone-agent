import { DEFAULT_HOURS, type HoursConfig } from "@/core/hours";
import { workingMinutesBetween } from "@/core/booking/working-minutes";
import type { PostCallRepo } from "@/core/postcall/repo";
import type { SqlClient } from "./pg-booking-repo";
import type { Q } from "./dash-metrics";

// Row-level dashboard data: the calls table, one call in full, designer performance, the weekly review and the audited phone reveal.
// Phone numbers: only `callers.phone_masked` is ever selected here. The one function that returns a real number is `revealPhone`, and it logs first.

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const d = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const jsonOf = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const median = (xs: number[]) => { if (!xs.length) return null; const t = [...xs].sort((a, b) => a - b), m = t.length >> 1; return t.length % 2 ? t[m]! : (t[m - 1]! + t[m]!) / 2; };
const LOCALITY = "coalesce(nullif(trim(split_part(coalesce(nullif(trim(e.locality),''), e.location_raw, ''), ',', 1)), ''), null)";

// ---- calls table ----------------------------------------------------------------------------------------------------------------------------
export interface CallsQuery extends Q { outcome?: string; fit?: string; designerId?: string; afterHours?: boolean; search?: string; limit?: number; offset?: number }
export interface CallListRow {
  id: string; rangAt: Date | null; callerName: string | null; phoneMasked: string | null; locality: string | null; scope: string | null; outcome: string | null; fit: string | null;
  afterHours: boolean | null; bookingStartsAt: Date | null; bookingStatus: string | null; designer: string | null; handoffStatus: string | null; status: string; durationS: number | null;
}
const likeEscape = (x: string) => x.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function listCalls(db: SqlClient, q: CallsQuery): Promise<{ total: number; rows: CallListRow[] }> {
  const p: unknown[] = [q.from.toISOString(), q.to.toISOString(), q.demo];
  const where = ["c.is_demo = $3", "coalesce(c.rang_at, c.ended_at, c.created_at) >= $1::timestamptz", "coalesce(c.rang_at, c.ended_at, c.created_at) < $2::timestamptz"];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace(/\?/g, `$${p.length}`)); }; // one value, possibly used several times in the clause
  if (q.outcome) add("c.outcome::text = ?", q.outcome);
  if (q.fit) add("e.fit::text = ?", q.fit);
  if (q.designerId) add("bk.designer_id = ?::uuid", q.designerId);
  if (q.afterHours !== undefined) add("coalesce(c.after_hours, false) = ?", q.afterHours);
  if (q.search?.trim()) add("(cr.name ilike ? escape '\\' or e.location_raw ilike ? escape '\\' or c.vaani_call_id ilike ? escape '\\' or cr.phone_masked ilike ? escape '\\' or c.summary ilike ? escape '\\')", `%${likeEscape(q.search.trim())}%`);
  const sql = where.join(" and ");
  const from = `from calls c left join callers cr on cr.id = c.caller_id left join enquiries e on e.id = c.enquiry_id
    left join lateral (select b.* from bookings b where b.enquiry_id = e.id and b.status <> 'cancelled' order by b.starts_at limit 1) bk on true
    left join designers dz on dz.id = bk.designer_id
    left join lateral (select h.status from handoffs h where h.booking_id = bk.id order by h.attempt_no desc, h.sent_at desc nulls last limit 1) hf on true`;
  const total = n((await db.query(`select count(*)::int as n ${from} where ${sql}`, p)).rows[0]?.n);
  const lim = Math.min(Math.max(q.limit ?? 50, 1), 500), off = Math.max(q.offset ?? 0, 0);
  const rows = (await db.query(
    `select c.vaani_call_id as id, c.rang_at, c.ended_at, c.duration_s, cr.name as caller_name, cr.phone_masked, ${LOCALITY} as locality, e.scope, c.outcome::text as outcome, e.fit::text as fit, c.after_hours,
            bk.starts_at as booking_starts_at, bk.status as booking_status, dz.name as designer, hf.status as handoff_status, c.post_call_status
     ${from} where ${sql} order by coalesce(c.rang_at, c.ended_at, c.created_at) desc, c.vaani_call_id desc limit ${lim} offset ${off}`, p)).rows;
  return { total, rows: rows.map((r) => ({ id: String(r.id), rangAt: d(r.rang_at) ?? d(r.ended_at), callerName: s(r.caller_name), phoneMasked: s(r.phone_masked), locality: s(r.locality), scope: s(r.scope), outcome: s(r.outcome), fit: s(r.fit),
    afterHours: (r.after_hours as boolean | null) ?? null, bookingStartsAt: d(r.booking_starts_at), bookingStatus: s(r.booking_status), designer: s(r.designer), handoffStatus: s(r.handoff_status),
    status: s(r.handoff_status) ?? String(r.post_call_status), durationS: r.duration_s == null ? null : Number(r.duration_s) })) };
}

const IST = (x: Date | null) => (x ? new Date(x.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ") : "");
const cell = (v: unknown) => {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;                       // defuse spreadsheet formula injection
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export function callsCsv(rows: CallListRow[]): string {
  const head = "time_ist,call_id,caller_name,phone_masked,locality,scope,outcome,fit,booking_start_ist,designer,status";
  return [head, ...rows.map((r) => [IST(r.rangAt), r.id, r.callerName, r.phoneMasked, r.locality, r.scope, r.outcome, r.fit, IST(r.bookingStartsAt), r.designer, r.status].map(cell).join(","))].join("\n") + "\n";
}

// ---- one call in full ---------------------------------------------------------------------------------------------------------------------
const maskEmail = (e: string | null) => { if (!e) return null; const [u, dom] = e.split("@"); return dom ? `${u!.slice(0, 1)}•••@${dom}` : "•••"; };

export async function getCallDetail(db: SqlClient, vendorCallId: string, demo: boolean) {
  const c = (await db.query(
    `select c.*, cr.name as caller_name, cr.phone_masked, cr.email as caller_email, e.id as e_id, e.fit::text as e_fit, e.reason_codes, e.missing_fields, e.next_action, e.location_raw, e.locality, e.project_type, e.scope, e.bhk, e.carpet_sqft,
            e.current_state, e.timeline_raw, e.decision_maker, e.owners_attending, e.source_heard, e.language as e_language, e.asked_for_number, e.designer_note, e.referrer, rv.version as rv_version
     from calls c left join callers cr on cr.id = c.caller_id left join enquiries e on e.id = c.enquiry_id left join rule_versions rv on rv.id = e.rule_version_id
     where c.vaani_call_id = $1 and c.is_demo = $2`, [vendorCallId, demo])).rows[0];
  if (!c) return null;
  const callId = c.id as string, enqId = (c.e_id as string) ?? null;
  const [evals, booking, flags, esc, alerts, crm] = await Promise.all([
    db.query("select ev.phase, ev.fit::text as fit, ev.reason_codes, ev.evaluated_at, rv.version from rule_evaluations ev join rule_versions rv on rv.id = ev.rule_version_id where ev.call_id = $1 order by ev.evaluated_at, ev.id", [callId]),
    enqId ? db.query("select b.*, dz.name as designer_name from bookings b join designers dz on dz.id = b.designer_id where b.enquiry_id = $1 and b.status <> 'cancelled' order by b.starts_at limit 1", [enqId]) : Promise.resolve({ rows: [] }),
    db.query("select kind, severity, evidence, created_at, resolved_at from audit_flags where call_id = $1 order by created_at, id", [callId]),
    db.query("select reason, mode, created_at, callback_due_at, sla_minutes, queue, resolved_at from escalations where call_id = $1 order by created_at, id", [callId]),
    db.query("select kind, payload, status, created_at from outbox where is_demo = $2 and kind in ('design_lead_alert','owner_alert','nikhil_alert') and payload->>'vendorCallId' = $1 order by created_at, id", [vendorCallId, demo]),
    enqId ? db.query("select hubspot_contact_id, hubspot_deal_id, stage, deal_amount_inr from crm_links where enquiry_id = $1", [enqId]) : Promise.resolve({ rows: [] }),
  ]);
  const b = booking.rows[0];
  const handoffs = b ? (await db.query("select h.*, dz.name as designer_name from handoffs h join designers dz on dz.id = h.designer_id where h.booking_id = $1 order by h.attempt_no, h.sent_at nulls last", [b.id])).rows : [];
  const ruleVersion = c.rv_version == null ? null : `v${c.rv_version}`;
  return {
    call: { id: String(c.vaani_call_id), rangAt: d(c.rang_at), answeredAt: d(c.answered_at), endedAt: d(c.ended_at), durationS: c.duration_s == null ? null : Number(c.duration_s), afterHours: (c.after_hours as boolean | null) ?? null,
      outcome: s(c.outcome), intent: s(c.intent), endedReason: s(c.ended_reason), postCallStatus: String(c.post_call_status), summary: s(c.summary), recordingUrl: s(c.recording_path),
      disclosureOk: (c.disclosure_ok as boolean | null) ?? null, costTotalInr: c.cost_total_inr == null ? null : Number(c.cost_total_inr) },
    transcript: c.transcript == null ? [] : (jsonOf(c.transcript) as { speaker: string; text: string }[]),
    caller: c.caller_id ? { name: s(c.caller_name), phoneMasked: s(c.phone_masked), emailMasked: maskEmail(s(c.caller_email)) } : null,
    enquiry: enqId ? { id: enqId, locality: s(c.locality) ?? (s(c.location_raw)?.split(",")[0]?.trim() || null), projectType: s(c.project_type), scope: s(c.scope), bhk: c.bhk == null ? null : Number(c.bhk), carpetSqft: c.carpet_sqft == null ? null : Number(c.carpet_sqft),
      currentState: s(c.current_state), timeline: s(c.timeline_raw), decisionMaker: s(c.decision_maker), ownersAttending: (c.owners_attending as boolean | null) ?? null, sourceHeard: s(c.source_heard), language: s(c.e_language),
      askedForPrice: !!c.asked_for_number, referrer: s(c.referrer), fit: s(c.e_fit), designerNote: s(c.designer_note) } : null,
    decision: enqId ? { fit: s(c.e_fit), ruleVersion, reasonCodes: (c.reason_codes as string[]) ?? [], missingFields: (c.missing_fields as string[]) ?? [], nextAction: s(c.next_action),
      evaluations: evals.rows.map((r) => ({ phase: String(r.phase), fit: String(r.fit), reasonCodes: (r.reason_codes as string[]) ?? [], ruleVersion: `v${r.version}`, at: d(r.evaluated_at)! })) } : null,
    booking: b ? { id: String(b.id), startsAt: d(b.starts_at)!, status: String(b.status), designer: String(b.designer_name), mode: s(b.mode) } : null,
    handoffs: handoffs.map((h) => ({ attempt: Number(h.attempt_no), designer: String(h.designer_name), status: String(h.status), sentAt: d(h.sent_at), dueAt: d(h.due_at), acceptedAt: d(h.accepted_at), declinedAt: d(h.declined_at), declineReason: s(h.decline_reason) })),
    flags: flags.rows.map((r) => ({ kind: String(r.kind), severity: String(r.severity), evidence: s(r.evidence), at: d(r.created_at)!, resolvedAt: d(r.resolved_at) })),
    escalations: esc.rows.map((r) => ({ reason: String(r.reason), mode: s(r.mode), at: d(r.created_at)!, callbackDueAt: d(r.callback_due_at), slaMinutes: r.sla_minutes == null ? null : Number(r.sla_minutes), queue: s(r.queue), resolvedAt: d(r.resolved_at) })),
    alerts: alerts.rows.map((r) => { const p = jsonOf(r.payload) as Record<string, unknown>; return { kind: String(p.kind ?? p.flag ?? "other"), priority: s(p.priority), to: r.kind === "design_lead_alert" ? "design_lead" : r.kind === "nikhil_alert" ? "nikhil" : "owner", status: String(r.status), at: d(r.created_at)! }; }),
    hubspot: crm.rows[0] ? { contactId: s(crm.rows[0].hubspot_contact_id), dealId: s(crm.rows[0].hubspot_deal_id), stage: s(crm.rows[0].stage), dealAmountInr: crm.rows[0].deal_amount_inr == null ? null : Number(crm.rows[0].deal_amount_inr) } : null,
  };
}
export type CallDetail = NonNullable<Awaited<ReturnType<typeof getCallDetail>>>;

// ---- designers --------------------------------------------------------------------------------------------------------------------------------
export async function designerStats(db: SqlClient, q: Q, hours: HoursConfig = DEFAULT_HOURS) {
  const P = [q.from.toISOString(), q.to.toISOString(), q.demo];
  const COHORT = `c as (select cl.* from calls cl where cl.is_demo = $3 and coalesce(cl.rang_at, cl.ended_at, cl.created_at) >= $1::timestamptz and coalesce(cl.rang_at, cl.ended_at, cl.created_at) < $2::timestamptz),
    enq as (select e.id from enquiries e where e.id in (select enquiry_id from c where enquiry_id is not null)),
    bk as (select b.* from bookings b join enq on enq.id = b.enquiry_id where b.status <> 'cancelled')`;
  const rows = (await db.query(`with ${COHORT}
    select dz.id, dz.name, (select count(*) from bk where bk.designer_id = dz.id)::int as assigned,
      (select count(*) from bk where bk.designer_id = dz.id and bk.status = 'attended')::int as consultations,
      (select count(*) from bk join crm_links l on l.enquiry_id = bk.enquiry_id where bk.designer_id = dz.id and l.stage in ('quote_sent','won'))::int as quotes,
      (select count(*) from bk join crm_links l on l.enquiry_id = bk.enquiry_id where bk.designer_id = dz.id and l.stage = 'won')::int as wins
    from designers dz where dz.is_demo = $3 and ((dz.active and not coalesce(dz.is_test, false)) or exists (select 1 from bk where bk.designer_id = dz.id)) order by dz.name`, P)).rows;
  const pairs = (await db.query(`with ${COHORT} select h.designer_id, h.sent_at, h.accepted_at from handoffs h join bk on bk.id = h.booking_id where h.accepted_at is not null and h.sent_at is not null`, P)).rows;
  return rows.map((r) => {
    const mine = pairs.filter((x) => x.designer_id === r.id);
    const el = mine.map((x) => (new Date(x.accepted_at as string).getTime() - new Date(x.sent_at as string).getTime()) / 60_000);
    const wk = mine.map((x) => workingMinutesBetween(new Date(x.sent_at as string), new Date(x.accepted_at as string), hours));
    const m = median(el), mw = median(wk);
    return { id: String(r.id), name: String(r.name), assigned: n(r.assigned), accepted: mine.length, medianAcceptMinutes: m === null ? null : r2(m), medianAcceptWorkingMinutes: mw === null ? null : r2(mw), consultations: n(r.consultations), quotes: n(r.quotes), wins: n(r.wins) };
  });
}

// ---- weekly review ----------------------------------------------------------------------------------------------------------------------------
const SAMPLE = 10;
const CRITICAL = /booked|escalated|not_fit/;
const addDays = (iso: string, k: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
/** Monday (IST) of the week containing `at`, as YYYY-MM-DD. */
export function weekStartOf(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60_000);
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(ist.toISOString().slice(0, 10), -dow);
}

export async function getReview(db: SqlClient, o: { demo: boolean; weekStart: string }) {
  const from = new Date(`${o.weekStart}T00:00:00+05:30`).toISOString(), to = new Date(`${addDays(o.weekStart, 7)}T00:00:00+05:30`).toISOString();
  // Draw once: the unique (week_start, call_id) plus this guard mean a refresh can never re-draw the sample.
  const have = n((await db.query("select count(*)::int as n from call_reviews r join calls c on c.id = r.call_id where r.week_start = $1::date and c.is_demo = $2", [o.weekStart, o.demo])).rows[0]?.n);
  if (have === 0)
    await db.query(
      `insert into call_reviews(week_start, call_id, agent_decision, is_demo)
       select $1::date, x.id, coalesce(x.outcome::text, 'unknown') || coalesce(' / ' || x.fit::text, ''), $4
       from (select c.id, c.outcome, e.fit from calls c left join enquiries e on e.id = c.enquiry_id
             where c.is_demo = $4 and c.post_call_status = 'processed' and coalesce(c.rang_at, c.ended_at) >= $2::timestamptz and coalesce(c.rang_at, c.ended_at) < $3::timestamptz
             order by random() limit ${SAMPLE}) x
       on conflict (week_start, call_id) do nothing`, [o.weekStart, from, to, o.demo]);
  const items = (await db.query(
    `select r.id, c.vaani_call_id, c.rang_at, c.outcome::text as outcome, c.summary, r.agent_decision, r.overturned, r.overturn_reason, r.reviewer, r.reviewed_at, e.fit::text as fit, e.reason_codes, ${LOCALITY} as locality
     from call_reviews r join calls c on c.id = r.call_id left join enquiries e on e.id = c.enquiry_id
     where r.week_start = $1::date and c.is_demo = $2 order by c.rang_at, c.vaani_call_id`, [o.weekStart, o.demo])).rows.map((r) => ({
    reviewId: String(r.id), callId: String(r.vaani_call_id), rangAt: d(r.rang_at), outcome: s(r.outcome), fit: s(r.fit), reasonCodes: (r.reason_codes as string[]) ?? [], locality: s(r.locality), summary: s(r.summary),
    agentDecision: String(r.agent_decision), overturned: r.reviewed_at ? !!r.overturned : null, reason: s(r.overturn_reason), reviewer: s(r.reviewer), reviewedAt: d(r.reviewed_at) }));
  const reviewed = items.filter((i) => i.reviewedAt).length, overturned = items.filter((i) => i.overturned).length;
  const all = (await db.query("select count(*) filter (where r.reviewed_at is not null)::int as rev, count(*) filter (where r.overturned and r.reviewed_at is not null)::int as ov from call_reviews r join calls c on c.id = r.call_id where c.is_demo = $1", [o.demo])).rows[0]!;
  return { weekStart: o.weekStart, weekEnd: addDays(o.weekStart, 6), items, reviewed, overturned, overturnRate: reviewed ? r4(overturned / reviewed) : null,
    allTime: { reviewed: n(all.rev), overturned: n(all.ov), rate: n(all.rev) ? r4(n(all.ov) / n(all.rev)) : null } };
}

export async function reviewCall(db: SqlClient, o: { callId: string; overturned: boolean; reason?: string; reviewer: string; demo?: boolean }): Promise<{ ok: true } | { ok: false; error: "reviewer_required" | "not_in_review" | "reason_required" }> {
  if (!o.reviewer?.trim()) return { ok: false, error: "reviewer_required" };
  const row = (await db.query(
    `select r.id, r.agent_decision from call_reviews r join calls c on c.id = r.call_id where c.vaani_call_id = $1 and c.is_demo = $2 order by r.week_start desc limit 1`, [o.callId, o.demo ?? false])).rows[0];
  if (!row) return { ok: false, error: "not_in_review" };
  if (o.overturned && CRITICAL.test(String(row.agent_decision)) && !o.reason?.trim()) return { ok: false, error: "reason_required" };
  await db.query("update call_reviews set overturned=$2, overturn_reason=$3, reviewer=$4, reviewed_at=now(), overturned_at = case when $2 then now() else null end where id=$1",
    [row.id, o.overturned, o.overturned ? o.reason?.trim() ?? null : null, o.reviewer.trim().slice(0, 80)]);
  return { ok: true };
}

// ---- phone reveal -----------------------------------------------------------------------------------------------------------------------------
const REVEALS_PER_HOUR = 30;
export async function revealPhone(db: SqlClient, repo: Pick<PostCallRepo, "callerContact">, o: { vendorCallId: string; demo: boolean; ip?: string }):
  Promise<{ ok: true; phone: string } | { ok: false; error: "no_caller" | "not_found" | "rate_limited" }> {
  const row = (await db.query("select id, caller_id from calls where vaani_call_id = $1 and is_demo = $2", [o.vendorCallId, o.demo])).rows[0];
  if (!row) return { ok: false, error: "not_found" };
  if (!row.caller_id) return { ok: false, error: "no_caller" };
  const recent = n((await db.query("select count(*)::int as n from phone_reveals where revealed_at > now() - interval '1 hour'")).rows[0]?.n);
  if (recent >= REVEALS_PER_HOUR) return { ok: false, error: "rate_limited" };
  await db.query("insert into phone_reveals(call_id, caller_id, ip, is_demo) values ($1,$2,$3,$4)", [row.id, row.caller_id, o.ip ?? null, o.demo]); // logged BEFORE the number leaves
  const contact = await repo.callerContact(String(row.caller_id));
  if (!contact) return { ok: false, error: "no_caller" };
  return { ok: true, phone: contact.phone };
}
