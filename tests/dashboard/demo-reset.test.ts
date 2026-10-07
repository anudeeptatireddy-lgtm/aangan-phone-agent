import { describe, it, expect } from "vitest";
import { september, ENC_KEY, PEPPER } from "./fixture";
import { getReview, revealPhone } from "@/db/dash-calls";
import { PgPostCallRepo } from "@/db/pg-postcall-repo";
import { resetDemo, countDemo } from "../../scripts/demo/reset";

const TABLES = ["callers", "designers", "enquiries", "calls", "rule_evaluations", "bookings", "handoffs", "escalations", "usage_costs", "audit_flags", "call_reviews", "crm_links", "outbox", "calcom_bookings", "phone_reveals"];
const live = async (w: Awaited<ReturnType<typeof september>>["w"]) => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, ((await w.db.query(`select count(*)::int n from ${t} where not is_demo`)).rows[0] as { n: number }).n])));

describe("seed:demo:reset", () => {
  it("removes every demo row in every table (foreign keys included) and touches no live row", async () => {
    const { w, ids } = await september();
    // a richer demo dataset: booking, handoff chain, review, reveal log, crm, escalation, outbox, calcom
    await w.demo(true);
    const dd = await w.designer("DemoA", { demo: true }), de = await w.enquiry({ fit: "fit" }), dcall = await w.call("demo-x", { rang: new Date("2026-09-05T05:00:00Z"), answeredAfterS: 1, enquiryId: de, outcome: "booked" });
    const dcall2 = await w.call("demo-y", { rang: new Date("2026-09-05T06:00:00Z"), answeredAfterS: 1, outcome: "review" });
    await w.db.query("update calls set parent_call_id=$1 where id=$2", [dcall, dcall2]);
    const b = await w.booking({ enquiryId: de, designerId: dd, startsAt: new Date("2026-09-08T05:30:00Z") });
    const h1 = await w.handoff({ bookingId: b, designerId: dd, sentAt: new Date(), status: "reassigned" }), h2 = await w.handoff({ bookingId: b, designerId: dd, sentAt: new Date(), status: "accepted", attempt: 2 });
    await w.db.query("update handoffs set reassigned_to_handoff_id=$2 where id=$1", [h1, h2]);
    await w.crm(de, "won", 5); await w.cost(dcall, "voice_minutes", 3, new Date()); await w.flag(dcall, "price_mention"); await w.escalation(dcall, "complaint", new Date(), null);
    await w.calcom("demo-bk", new Date(), null); await w.alert("booking_orphan", "demo-o", new Date());
    await w.db.query("insert into call_reviews(week_start, call_id, agent_decision) values ('2026-09-07', $1, 'booked')", [dcall]);
    await w.db.query("insert into phone_reveals(call_id) values ($1)", [dcall]);
    await w.demo(false);
    const before = await live(w);
    expect((await countDemo(w.db)).total).toBeGreaterThan(10);

    // refuses while real calls exist, unless forced
    await expect(resetDemo(w.db)).rejects.toThrow(/real calls/i);
    expect((await countDemo(w.db)).total).toBeGreaterThan(10);

    const r = await resetDemo(w.db, { force: true });
    expect(r.deleted).toBeGreaterThan(10);
    expect((await countDemo(w.db)).total).toBe(0);
    expect(await live(w)).toEqual(before);
    expect(ids.c1).toBeTruthy();
  }, 120_000);

  it("with no real calls it needs no flag, and it is idempotent", async () => {
    const { w } = await september();
    await w.db.query("delete from usage_costs where not is_demo"); await w.db.query("delete from audit_flags where not is_demo"); await w.db.query("delete from escalations where not is_demo");
    await w.db.query("delete from handoffs where not is_demo"); await w.db.query("delete from bookings where not is_demo"); await w.db.query("delete from crm_links where not is_demo");
    await w.db.query("delete from rule_evaluations where not is_demo"); await w.db.query("delete from calls where not is_demo");
    await resetDemo(w.db);
    expect((await resetDemo(w.db)).deleted).toBe(0);
    expect((await countDemo(w.db)).total).toBe(0);
  }, 120_000);

  it("rows the DASHBOARD writes about demo calls (the weekly-review draw, a phone reveal) are demo too, so a reset still works", async () => {
    const { w } = await september();
    await w.demo(true);
    const e = await w.enquiry({ fit: "fit" }); const caller = await w.caller("Demo Person", "+919000099001");
    await w.call("demo-dash", { rang: new Date("2026-09-08T05:00:00Z"), answeredAfterS: 1, enquiryId: e, callerId: caller, outcome: "booked" });
    await w.demo(false);                                   // the dashboard process is NOT in demo scope
    await getReview(w.db, { demo: true, weekStart: "2026-09-07" });
    await revealPhone(w.db, new PgPostCallRepo(w.db, { pepper: PEPPER, encKey: ENC_KEY }), { vendorCallId: "demo-dash", demo: true });
    expect((await w.db.query("select count(*)::int n from call_reviews r join calls c on c.id=r.call_id where c.is_demo and not r.is_demo")).rows[0]).toEqual({ n: 0 });
    expect((await w.db.query("select count(*)::int n from phone_reveals r join calls c on c.id=r.call_id where c.is_demo and not r.is_demo")).rows[0]).toEqual({ n: 0 });
    await w.db.query("select 1");
    await expect(resetDemo(w.db, { force: true })).resolves.toBeTruthy();
    expect((await countDemo(w.db)).total).toBe(0);
  }, 120_000);
});
