import type { DashboardSource } from "@/core/dashboard/source";
import type { DashRows } from "@/core/dashboard/summary";
import type { SqlClient } from "./pg-booking-repo";

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

/** Read-only aggregate queries for the owner dashboard. Selects no phone, name or email column. */
export class PgDashboardSource implements DashboardSource {
  constructor(private db: SqlClient) {}
  async fetchRows(from: Date, to: Date): Promise<DashRows> {
    const p = [from.toISOString(), to.toISOString()];
    const inRange = "coalesce(c.rang_at, c.ended_at) >= $1::timestamptz and coalesce(c.rang_at, c.ended_at) < $2::timestamptz";
    const [calls, enquiries, handoffs, flags] = await Promise.all([
      this.db.query(`select c.rang_at, c.ended_at, c.duration_s, c.outcome, c.after_hours, c.cost_ai_inr, c.cost_voice_inr, c.cost_total_inr, c.post_call_status from calls c where ${inRange}`, p),
      this.db.query(`select distinct e.id, e.fit from calls c join enquiries e on e.id = c.enquiry_id where ${inRange}`, p),
      this.db.query("select status from handoffs where due_at >= $1::timestamptz and due_at < $2::timestamptz", p),
      this.db.query(`select f.kind, (f.resolved_at is not null) as resolved from audit_flags f join calls c on c.id = f.call_id where ${inRange}`, p),
    ]);
    return {
      calls: calls.rows.map((r) => ({ rangAt: date(r.rang_at) ?? date(r.ended_at), durationS: num(r.duration_s), outcome: (r.outcome as string) ?? null, afterHours: (r.after_hours as boolean) ?? null,
        costAiInr: num(r.cost_ai_inr), costVoiceInr: num(r.cost_voice_inr), costTotalInr: num(r.cost_total_inr), postCallStatus: r.post_call_status as string })),
      enquiries: enquiries.rows.map((r) => ({ fit: (r.fit as "fit" | "not_fit" | "unclear") ?? null })),
      handoffs: handoffs.rows.map((r) => ({ status: r.status as string })),
      flags: flags.rows.map((r) => ({ kind: r.kind as string, resolved: !!r.resolved })),
    };
  }
}
