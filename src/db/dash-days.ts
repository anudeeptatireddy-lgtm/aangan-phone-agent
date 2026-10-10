import type { SqlClient } from "./pg-booking-repo";

/** Calls and converted (booked) calls per calendar day (IST) in the dashboard's range, for the calendar. Same cohort rule as the rest of the dashboard. */
export async function dailyCounts(db: SqlClient, q: { from: Date; to: Date; demo: boolean }): Promise<Record<string, { calls: number; booked: number }>> {
  const { rows } = await db.query(
    `select to_char(coalesce(rang_at, ended_at, created_at) at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as d, count(*)::int as calls, count(*) filter (where outcome = 'booked')::int as booked
       from calls where is_demo = $3 and coalesce(rang_at, ended_at, created_at) >= $1::timestamptz and coalesce(rang_at, ended_at, created_at) < $2::timestamptz group by 1`,
    [q.from.toISOString(), q.to.toISOString(), q.demo]);
  return Object.fromEntries(rows.map((r) => [String(r.d), { calls: Number(r.calls), booked: Number(r.booked) }]));
}
