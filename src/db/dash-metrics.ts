import { DEFAULT_HOURS, type HoursConfig } from "@/core/hours";
import { workingMinutesBetween } from "@/core/booking/working-minutes";
import type { SqlClient } from "./pg-booking-repo";

// Every metric of the CEO dashboard, computed in SQL from our own tables. A "cohort" is the set of calls that rang in [from, to); everything
// downstream (enquiries, bookings, handoffs, CRM stage) is followed from those calls, so each stage is a subset of the one before it.
// `demo` selects the demo or the live rows: they never mix. No query here selects a phone number, a name or an email.

export interface Q { from: Date; to: Date; demo: boolean }
const P = (q: Q) => [q.from.toISOString(), q.to.toISOString(), q.demo];

const COHORT = `
  c as (select cl.* from calls cl where cl.is_demo = $3 and coalesce(cl.rang_at, cl.ended_at, cl.created_at) >= $1::timestamptz and coalesce(cl.rang_at, cl.ended_at, cl.created_at) < $2::timestamptz),
  enq as (select e.* from enquiries e where e.id in (select enquiry_id from c where enquiry_id is not null)),
  bk as (select b.* from bookings b join enq on enq.id = b.enquiry_id where b.status <> 'cancelled')`;

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const ratio = (a: number, b: number) => (b > 0 ? r4(a / b) : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const one = async (db: SqlClient, sql: string, q: Q) => (await db.query(sql, P(q))).rows[0] ?? {};
const IST_MS = 330 * 60_000;
const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

// ---- funnel ---------------------------------------------------------------------------------------------------------------------------------
export interface FunnelStage { key: string; label: string; unit: "calls" | "enquiries"; count: number | null; hasData: boolean; conversion: number | null }
const FIT_ENQ = "(select id from enq where fit = 'fit')";

export async function funnel(db: SqlClient, q: Q): Promise<{ stages: FunnelStage[] }> {
  const r = await one(db, `with ${COHORT}
    select
      (select count(*) from c)::int as received,
      (select count(*) from c where answered_at is not null)::int as answered,
      (select count(*) from enq)::int as enquiries,
      (select count(*) from enq where fit = 'fit')::int as qualified,
      (select count(distinct bk.enquiry_id) from bk where bk.enquiry_id in ${FIT_ENQ})::int as booked,
      (select count(distinct bk.enquiry_id) from bk join handoffs h on h.booking_id = bk.id where h.sent_at is not null and bk.enquiry_id in ${FIT_ENQ})::int as pushed,
      (select count(distinct bk.enquiry_id) from bk join handoffs h on h.booking_id = bk.id where h.accepted_at is not null and bk.enquiry_id in ${FIT_ENQ})::int as accepted,
      (select count(*) from enq where exists (select 1 from bk where bk.enquiry_id = enq.id and bk.status = 'attended')
          or exists (select 1 from crm_links l where l.enquiry_id = enq.id and l.stage in ('consult_held','quote_sent','won')))::int as held,
      (select count(*) from enq where exists (select 1 from crm_links l where l.enquiry_id = enq.id and l.stage in ('quote_sent','won')))::int as quoted,
      (select count(*) from enq where exists (select 1 from crm_links l where l.enquiry_id = enq.id and l.stage = 'won'))::int as won,
      (exists (select 1 from bk where bk.status in ('attended','no_show')) or exists (select 1 from crm_links l join enq on enq.id = l.enquiry_id where l.stage in ('consult_held','quote_sent','won','lost'))) as has_held,
      exists (select 1 from crm_links l join enq on enq.id = l.enquiry_id where l.stage in ('consult_held','quote_sent','won','lost')) as has_crm`, q);
  const def: [string, string, "calls" | "enquiries", string, boolean][] = [
    ["received", "Calls received", "calls", "received", true], ["answered", "Answered", "calls", "answered", true], ["enquiries", "New enquiries", "enquiries", "enquiries", true],
    ["qualified", "Qualified (fit)", "enquiries", "qualified", true], ["booked", "Booked on the call", "enquiries", "booked", true], ["pushed", "Handed to a designer", "enquiries", "pushed", true],
    ["accepted", "Designer accepted", "enquiries", "accepted", true], ["held", "Consultation held", "enquiries", "held", !!r.has_held], ["quoted", "Quote sent", "enquiries", "quoted", !!r.has_crm], ["won", "Won", "enquiries", "won", !!r.has_crm]];
  let prev: number | null = null;
  const stages = def.map(([key, label, unit, col, hasData]) => {
    const count = hasData ? n(r[col]) : null;
    const conversion = prev === null || count === null ? null : ratio(count, prev);
    prev = count;
    return { key, label, unit, count, hasData, conversion };
  });
  return { stages };
}

// ---- outcomes -------------------------------------------------------------------------------------------------------------------------------
export async function outcomes(db: SqlClient, q: Q) {
  const r = await one(db, `with ${COHORT}
    select (select count(*) from enq where fit='fit')::int fit, (select count(*) from enq where fit='not_fit')::int not_fit, (select count(*) from enq where fit='unclear')::int unclear,
      (select count(*) from c where intent in ('complaint','existing_client'))::int complaint, (select count(*) from c where intent = 'other' or outcome = 'closed_other')::int other,
      (select count(*) from c where outcome = 'missed' or ended_reason = 'missed')::int missed, (select count(*) from c where outcome = 'dropped')::int dropped`, q);
  const reasons = (await db.query(`with ${COHORT} select r as reason, count(*)::int as count from enq, unnest(enq.reason_codes) as r where enq.fit = 'not_fit' group by r order by count desc, r`, P(q))).rows;
  return { fit: n(r.fit), notFit: { total: n(r.not_fit), byReason: reasons.map((x) => ({ reason: String(x.reason), count: n(x.count) })) }, unclear: n(r.unclear), complaint: n(r.complaint), other: n(r.other), missed: n(r.missed), dropped: n(r.dropped) };
}

// ---- speed ----------------------------------------------------------------------------------------------------------------------------------
export async function speed(db: SqlClient, q: Q, hours: HoursConfig = DEFAULT_HOURS) {
  const a = await one(db, `with ${COHORT}
    select percentile_cont(0.5) within group (order by extract(epoch from (answered_at - rang_at))) filter (where answered_at is not null)::float8 as med,
           (count(*) filter (where answered_at is not null and answered_at - rang_at < interval '1 hour'))::int as fast, count(*)::int as total
    from c where rang_at is not null`, q);
  const pairs = (await db.query(`with ${COHORT} select h.sent_at, h.accepted_at from handoffs h join bk on bk.id = h.booking_id where h.accepted_at is not null and h.sent_at is not null`, P(q))).rows;
  const elapsed = pairs.map((p) => (new Date(p.accepted_at as string).getTime() - new Date(p.sent_at as string).getTime()) / 60_000);
  const working = pairs.map((p) => workingMinutesBetween(new Date(p.sent_at as string), new Date(p.accepted_at as string), hours));
  const m = median(elapsed), mw = median(working);
  return { medianAnswerSeconds: a.med == null ? null : r2(Number(a.med)), pctAnsweredUnder1h: ratio(n(a.fast), n(a.total)),
    medianAcceptMinutes: m === null ? null : r2(m), medianAcceptWorkingMinutes: mw === null ? null : r2(mw), acceptedHandoffs: pairs.length };
}

// ---- price ----------------------------------------------------------------------------------------------------------------------------------
export async function price(db: SqlClient, q: Q) {
  const r = await one(db, `with ${COHORT}
    select (select count(*) from enq where asked_for_number)::int as asked, (select count(*) from audit_flags f join c on c.id = f.call_id where f.kind = 'price_mention')::int as flags`, q);
  return { askedCount: n(r.asked), agentPriceFlags: n(r.flags) };
}

// ---- escalations ----------------------------------------------------------------------------------------------------------------------------
export async function escalations(db: SqlClient, q: Q) {
  const r = await one(db, `with ${COHORT}
    select count(*) filter (where e.reason = 'complaint')::int as complaints,
           count(*) filter (where e.reason = 'complaint' and e.resolved_at is not null)::int as resolved,
           count(*) filter (where e.reason = 'complaint' and e.resolved_at is not null and e.resolved_at - e.created_at <= interval '15 minutes')::int as within
    from escalations e join c on c.id = e.call_id`, q);
  const resolved = n(r.resolved);
  return { complaints: n(r.complaints), resolved, closedWithin15Min: n(r.within), pctClosedWithin15Min: resolved > 0 ? ratio(n(r.within), n(r.complaints)) : null, hasResolutionData: resolved > 0 };
}

// ---- router health --------------------------------------------------------------------------------------------------------------------------
export async function routerHealth(db: SqlClient, q: Q) {
  const r = await one(db, `select
      (select count(*) from calcom_bookings where is_demo = $3 and created_at >= $1::timestamptz and created_at < $2::timestamptz and claimed_by_call is not null)::int as matched,
      (select count(*) from calcom_bookings where is_demo = $3 and created_at >= $1::timestamptz and created_at < $2::timestamptz and claimed_by_call is null and status = 'accepted')::int as unclaimed,
      (select count(*) from outbox where is_demo = $3 and kind = 'design_lead_alert' and payload->>'kind' = 'booking_ambiguous' and created_at >= $1::timestamptz and created_at < $2::timestamptz)::int as ambiguous,
      (select count(*) from outbox where is_demo = $3 and kind = 'design_lead_alert' and payload->>'kind' = 'booking_missing' and created_at >= $1::timestamptz and created_at < $2::timestamptz)::int as missing,
      (select count(*) from outbox where is_demo = $3 and kind = 'design_lead_alert' and payload->>'kind' = 'booking_orphan' and created_at >= $1::timestamptz and created_at < $2::timestamptz)::int as orphan`, q);
  return { matched: n(r.matched), ambiguous: n(r.ambiguous), claimedButNoBooking: n(r.missing), bookingWithoutCall: n(r.orphan), unclaimedBookings: n(r.unclaimed) };
}

// ---- cost -----------------------------------------------------------------------------------------------------------------------------------
const LINES: [string, string, "voiceMinutes" | "aiTokens" | "fixedFees"][] = [["voice_minutes", "Voice minutes", "voiceMinutes"], ["ai_tokens_in", "AI tokens (in)", "aiTokens"], ["ai_tokens_out", "AI tokens (out)", "aiTokens"],
  ["phone_number", "Phone number", "fixedFees"], ["hosting", "Hosting", "fixedFees"], ["other_fixed", "Other fixed fees", "fixedFees"]];
export async function cost(db: SqlClient, q: Q) {
  const rows = (await db.query("select line, sum(amount_inr)::float8 as amt from usage_costs where is_demo = $3 and occurred_at >= $1::timestamptz and occurred_at < $2::timestamptz group by line", P(q))).rows;
  const by = new Map(rows.map((x) => [String(x.line), Number(x.amt)]));
  const groups = { voiceMinutes: 0, aiTokens: 0, fixedFees: 0 };
  const byLine = LINES.filter(([k]) => (by.get(k) ?? 0) !== 0).map(([line, label, g]) => { const amountInr = r2(by.get(line)!); groups[g] = r2(groups[g] + amountInr); return { line, label, amountInr }; });
  const totalInr = r2(byLine.reduce((a, x) => a + x.amountInr, 0));
  const f = await funnel(db, q);
  const calls = f.stages[0]!.count ?? 0, booked = f.stages.find((s) => s.key === "booked")!.count ?? 0;
  return { totalInr, byLine, groups, calls, booked, perCallInr: calls ? r2(totalInr / calls) : null, perBookedConsultationInr: booked ? r2(totalInr / booked) : null };
}

// ---- pipeline (the designers' deal values, synced from HubSpot; shown to Nikhil only) -------------------------------------------------------
export async function pipelineValue(db: SqlClient, q: Q) {
  const r = await one(db, `with ${COHORT}
    select coalesce(sum(l.deal_amount_inr) filter (where l.stage = 'won'), 0)::float8 as won_v, count(*) filter (where l.stage = 'won' and l.deal_amount_inr is not null)::int as won_n,
           coalesce(sum(l.deal_amount_inr) filter (where l.stage = 'quote_sent'), 0)::float8 as quoted_v, count(*) filter (where l.stage = 'quote_sent' and l.deal_amount_inr is not null)::int as quoted_n,
           coalesce(bool_or(l.deal_amount_inr is not null), false) as has
    from crm_links l join enq on enq.id = l.enquiry_id`, q);
  return { hasData: !!r.has, wonValueInr: n(r.won_v), wonCount: n(r.won_n), quotedValueInr: n(r.quoted_v), quotedCount: n(r.quoted_n), totalValueInr: n(r.won_v) + n(r.quoted_v) };
}

// ---- breakdowns -----------------------------------------------------------------------------------------------------------------------------
const LOCALITY = "coalesce(nullif(trim(split_part(coalesce(nullif(trim(enq.locality),''), enq.location_raw, ''), ',', 1)), ''), 'Unknown')";
const group = async (db: SqlClient, q: Q, keyExpr: string) => (await db.query(`with ${COHORT}
  select ${keyExpr} as key, count(*)::int as count, count(*) filter (where enq.fit = 'fit')::int as fit,
         count(*) filter (where exists (select 1 from bk where bk.enquiry_id = enq.id))::int as booked
  from enq group by 1 order by count desc, key`, P(q))).rows.map((x) => ({ key: String(x.key), count: n(x.count), fit: n(x.fit), booked: n(x.booked) }));

export async function breakdowns(db: SqlClient, q: Q) {
  const [locality, projectType] = await Promise.all([group(db, q, LOCALITY), group(db, q, "coalesce(nullif(enq.project_type,''), 'Unknown')")]);
  const language = (await db.query(`with ${COHORT} select coalesce(nullif(enq.language,''), 'unknown') as key, count(*)::int as count from enq group by 1 order by count desc, key`, P(q))).rows.map((x) => ({ key: String(x.key), count: n(x.count) }));
  const designer = (await db.query(`with ${COHORT} select d.name as key, count(*)::int as count from bk join designers d on d.id = bk.designer_id group by d.name order by count desc, d.name`, P(q))).rows.map((x) => ({ key: String(x.key), count: n(x.count) }));
  const hrs = (await db.query(`with ${COHORT} select extract(hour from rang_at at time zone 'Asia/Kolkata')::int as hour, count(*)::int as count, count(*) filter (where after_hours)::int as after from c where rang_at is not null group by 1`, P(q))).rows;
  const hourOfDay = Array.from({ length: 24 }, (_, hour) => { const h = hrs.find((x) => n(x.hour) === hour); return { hour, count: n(h?.count), afterHours: n(h?.after) }; });
  const total = hourOfDay.reduce((a, h) => a + h.count, 0), after = hourOfDay.reduce((a, h) => a + h.afterHours, 0);
  return { locality, projectType, designer, hourOfDay, afterHoursShare: ratio(after, total), language };
}

// ---- calls per day --------------------------------------------------------------------------------------------------------------------------
export async function daily(db: SqlClient, q: Q) {
  const rows = (await db.query(`with ${COHORT} select to_char(rang_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as day, count(*) filter (where not coalesce(after_hours, false))::int as inh, count(*) filter (where coalesce(after_hours, false))::int as aft from c where rang_at is not null group by 1`, P(q))).rows;
  const by = new Map(rows.map((r) => [String(r.day), r]));
  const out: { date: string; inHours: number; afterHours: number }[] = [];
  for (let t = q.from.getTime(); t < q.to.getTime(); t += 86_400_000) { const date = istDay(new Date(t)), r = by.get(date); out.push({ date, inHours: n(r?.inh), afterHours: n(r?.aft) }); }
  return out;
}

// ---- KPI tiles and the whole overview -------------------------------------------------------------------------------------------------------
type Funnel = Awaited<ReturnType<typeof funnel>>;
const cnt = (f: Funnel, k: string) => f.stages.find((s) => s.key === k)!.count;
const kpisFrom = (f: Funnel, c: Awaited<ReturnType<typeof cost>>, p: Awaited<ReturnType<typeof price>>) => ({
  calls: cnt(f, "received") ?? 0, qualified: cnt(f, "qualified") ?? 0, booked: cnt(f, "booked") ?? 0, pushed: cnt(f, "pushed") ?? 0, quoted: cnt(f, "quoted"), won: cnt(f, "won"),
  costPerBookedInr: c.perBookedConsultationInr, priceLeaks: p.agentPriceFlags });
export async function kpis(db: SqlClient, q: Q) { const [f, c, p] = await Promise.all([funnel(db, q), cost(db, q), price(db, q)]); return kpisFrom(f, c, p); }

export async function overview(db: SqlClient, q: Q) {
  const [f, o, s, p, e, r, c, pl, b, d] = await Promise.all([funnel(db, q), outcomes(db, q), speed(db, q), price(db, q), escalations(db, q), routerHealth(db, q), cost(db, q), pipelineValue(db, q), breakdowns(db, q), daily(db, q)]);
  return { range: { from: q.from.toISOString(), to: q.to.toISOString(), demo: q.demo }, kpis: kpisFrom(f, c, p), funnel: f, outcomes: o, speed: s, price: p, escalations: e, router: r, cost: c, pipeline: pl, breakdowns: b, daily: d };
}

export const METRICS = { funnel, outcomes, speed, price, escalations, router: routerHealth, cost, pipeline: pipelineValue, breakdowns, daily, kpis } as const;
export type MetricName = keyof typeof METRICS;
