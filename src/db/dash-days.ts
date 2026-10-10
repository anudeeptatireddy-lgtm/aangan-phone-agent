import type { SqlClient } from "./pg-booking-repo";

/** Calls and converted (booked) calls per calendar day (IST) in the dashboard's range, for the calendar. Same cohort rule as the rest of the dashboard. */
export async function dailyCounts(db: SqlClient, q: { from: Date; to: Date; demo: boolean }): Promise<Record<string, { calls: number; booked: number }>> {
  const { rows } = await db.query(
    `select to_char(coalesce(rang_at, ended_at, created_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as d, count(*)::int as calls, count(*) filter (where outcome = 'booked')::int as booked
       from calls where is_demo = $3 and coalesce(rang_at, ended_at, created_at) >= $1::timestamptz and coalesce(rang_at, ended_at, created_at) < $2::timestamptz group by 1`,
    [q.from.toISOString(), q.to.toISOString(), q.demo]);
  return Object.fromEntries(rows.map((r) => [String(r.d), { calls: Number(r.calls), booked: Number(r.booked) }]));
}

export interface CallbackRow { callId: string; at: Date | null; caller: string | null; place: string | null; phoneMasked: string | null; reason: string; emailed: "sent" | "queued" | "failed" | "none"; qualified: number; booked: number }

/** Qualified (fit) calls with no consultation booked: who needs a callback, and why. `qualified` / `booked` are the totals the sentence above the list uses. */
export async function callbacksNeeded(db: SqlClient, q: { from: Date; to: Date; demo: boolean }): Promise<CallbackRow[]> {
  const P = [q.from.toISOString(), q.to.toISOString(), q.demo];
  const base = `from calls c join enquiries e on e.id = c.enquiry_id left join callers cr on cr.id = c.caller_id
    where c.is_demo = $3 and coalesce(c.rang_at, c.ended_at, c.created_at) >= $1::timestamptz and coalesce(c.rang_at, c.ended_at, c.created_at) < $2::timestamptz and e.fit = 'fit'`;
  const totals = (await db.query(`select count(*)::int qualified, count(*) filter (where c.outcome = 'booked')::int booked ${base}`, P)).rows[0] as { qualified: number; booked: number };
  const { rows } = await db.query(
    `select c.vaani_call_id id, coalesce(c.rang_at, c.ended_at, c.created_at) at, coalesce(cr.name, c.contact_name) caller, coalesce(e.locality, e.location_raw) place, cr.phone_masked,
       (select x.reason from escalations x where x.call_id = c.id order by x.created_at limit 1) esc,
       (select o.status from outbox o where o.kind = 'designer_email' and o.payload->>'callback' = 'true' and o.payload->>'vendorCallId' = c.vaani_call_id order by o.created_at desc limit 1) mail
     ${base} and c.outcome in ('review','escalated') and not exists (select 1 from bookings b where b.enquiry_id = e.id and b.status <> 'cancelled')
     order by 2 desc`, P);
  return rows.map((r) => ({
    callId: String(r.id), at: r.at ? new Date(String(r.at)) : null, caller: (r.caller as string | null) ?? null, place: (r.place as string | null) ?? null, phoneMasked: (r.phone_masked as string | null) ?? null,
    reason: r.esc === "human_requested" ? "Asked to speak to a person" : "No consultation was booked on the call",
    emailed: r.mail === "processed" ? "sent" : r.mail === "pending" ? "queued" : r.mail === "failed" ? "failed" : "none", ...totals }));
}
