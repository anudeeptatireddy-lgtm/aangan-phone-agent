import type { SqlClient } from "../../src/db/pg-booking-repo";

// Everything the demo seeder creates carries is_demo = true (migration 0005), so removing it is one DELETE per table, children before parents.
// It never looks at live rows, and it refuses to run while real calls exist unless forced.
const ORDER = ["phone_reveals", "call_reviews", "audit_flags", "escalations", "handoffs", "bookings", "crm_links", "rule_evaluations", "usage_costs", "outbox", "calcom_bookings", "calls", "enquiries", "callers", "designers"] as const;

export async function countDemo(db: SqlClient): Promise<{ total: number; byTable: Record<string, number> }> {
  const byTable: Record<string, number> = {};
  let total = 0;
  for (const t of ORDER) { const n = Number((await db.query(`select count(*)::int as n from ${t} where is_demo`)).rows[0]?.n ?? 0); byTable[t] = n; total += n; }
  return { total, byTable };
}

export async function resetDemo(db: SqlClient, opts: { force?: boolean } = {}): Promise<{ deleted: number }> {
  const real = Number((await db.query("select count(*)::int as n from calls where not is_demo")).rows[0]?.n ?? 0);
  if (real > 0 && !opts.force) throw new Error(`Refusing to reset: ${real} real calls exist in this database. Demo rows are separate and only they would be deleted, but pass --force to confirm this is the right database.`);
  // self references first
  await db.query("update calls set parent_call_id = null where is_demo");
  await db.query("update handoffs set reassigned_to_handoff_id = null where is_demo");
  let deleted = 0;
  for (const t of ORDER) deleted += (await db.query(`with d as (delete from ${t} where is_demo returning 1) select count(*)::int as n from d`)).rows[0]?.n as number ?? 0;
  return { deleted };
}
