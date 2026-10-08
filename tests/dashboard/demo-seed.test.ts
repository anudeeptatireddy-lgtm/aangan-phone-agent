import { describe, it, expect, beforeAll } from "vitest";
import { freshDb } from "../db/helpers";
import { seedDemo } from "../../scripts/demo/seed";
import { resetDemo, countDemo } from "../../scripts/demo/reset";
import { FIXTURES } from "../fixtures/enquiries";
import { overview } from "@/db/dash-metrics";
import { listCalls } from "@/db/dash-calls";
import { PgPostCallRepo } from "@/db/pg-postcall-repo";
import { World, ENC_KEY, PEPPER, SEP } from "./fixture";
import type { PGlite } from "@electric-sql/pglite";

const ENV = { PHONE_HASH_PEPPER: PEPPER, PHONE_ENC_KEY: ENC_KEY };
const TABLES = ["callers", "designers", "enquiries", "calls", "rule_evaluations", "bookings", "handoffs", "escalations", "usage_costs", "audit_flags", "call_reviews", "crm_links", "outbox", "calcom_bookings", "phone_reveals"];
let db: PGlite; let report: Awaited<ReturnType<typeof seedDemo>>;
const q = { ...SEP, demo: true };
const one = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

beforeAll(async () => { db = await freshDb({ seed: true }); report = await seedDemo(db, ENV); }, 300_000);

describe("seed:demo", () => {
  it("loads all 40 September enquiries as calls through the real pipeline", async () => {
    expect(report.calls).toBe(40);
    expect((await one<{ n: number }>("select count(*)::int n from calls where is_demo"))[0]!.n).toBe(40);
    expect((await one<{ n: number }>("select count(*)::int n from calls where is_demo and post_call_status='processed'"))[0]!.n).toBe(40);
  });
  it("every row it created is marked demo, and not one live row exists in any table", async () => {
    for (const t of TABLES) expect((await one<{ n: number }>(`select count(*)::int n from ${t} where not is_demo`))[0]!.n, t).toBe(t === "designers" ? 3 : 0); // the 3 TEST designers from supabase/seed.sql are live
    expect((await countDemo(db)).total).toBeGreaterThan(200);
  });
  it("the rules engine gave each of the 38 fixtures its expected class (T08 is a missed call, T09 a complaint)", async () => {
    const rows = await one<{ id: string; fit: string }>("select c.vaani_call_id as id, e.fit::text as fit from calls c join enquiries e on e.id = c.enquiry_id where c.is_demo");
    const got = new Map(rows.map((r) => [r.id.replace("demo-", ""), r.fit]));
    const wrong = FIXTURES.filter((f) => got.get(f.id) !== f.expected.result).map((f) => `${f.id}: ${got.get(f.id)} != ${f.expected.result}`);
    expect(wrong).toEqual([]);
    expect(await one("select outcome::text from calls where vaani_call_id='demo-T08'")).toEqual([{ outcome: "missed" }]);
    expect(await one("select outcome::text, intent from calls where vaani_call_id='demo-T09'")).toEqual([{ outcome: "escalated", intent: "complaint" }]);
  });
  it("spreads the calls across September, with a real share after hours", async () => {
    const o = await overview(db, q);
    expect(o.daily.filter((d) => d.inHours + d.afterHours > 0).length).toBeGreaterThanOrEqual(18);
    expect(o.daily.reduce((a, d) => a + d.inHours + d.afterHours, 0)).toBe(40);
    expect(o.daily.reduce((a, d) => a + d.afterHours, 0)).toBeGreaterThanOrEqual(6);
    const hours = (await one<{ h: number }>("select distinct extract(hour from rang_at at time zone 'Asia/Kolkata')::int h from calls where is_demo")).map((r) => r.h);
    expect(hours.length).toBeGreaterThanOrEqual(8);
  });
  it("the funnel is complete and never grows from one stage to the next", async () => {
    const f = (await overview(db, q)).funnel.stages;
    expect(f.every((s) => s.hasData)).toBe(true);
    const counts = f.map((s) => s.count!);
    expect(counts[0]).toBe(40);
    for (let i = 1; i < counts.length; i++) if (i !== 2) expect(counts[i]!, f[i]!.key).toBeLessThanOrEqual(counts[i - 1]!); // enquiries (new) may follow answered
    expect(counts[4]!).toBeGreaterThanOrEqual(10);     // booked
    expect(counts[8]!).toBeGreaterThanOrEqual(3);      // quoted
    expect(counts[9]!).toBeGreaterThanOrEqual(1);      // won
  });
  it("has bookings, handoffs (including reassignments), CRM deals with values, and an escalation", async () => {
    expect((await one<{ n: number }>("select count(*)::int n from handoffs where is_demo and attempt_no > 1"))[0]!.n).toBeGreaterThanOrEqual(2);
    expect((await one<{ n: number }>("select count(*)::int n from handoffs where is_demo and status='accepted'"))[0]!.n).toBeGreaterThanOrEqual(8);
    expect((await one<{ n: number }>("select count(*)::int n from crm_links where is_demo and deal_amount_inr is not null"))[0]!.n).toBeGreaterThanOrEqual(3);
    expect((await overview(db, q)).pipeline.hasData).toBe(true);
    expect((await overview(db, q)).escalations).toMatchObject({ complaints: 1, hasResolutionData: true });
  });
  it("router health shows what a real month would: matches, plus one agent-said-booked-nothing-found and one orphan booking", async () => {
    const r = (await overview(db, q)).router;
    expect(r.matched).toBeGreaterThanOrEqual(10);
    expect(r.claimedButNoBooking).toBe(1);
    expect(r.bookingWithoutCall).toBe(1);
  });
  it("costs come from our cost model: voice minutes, AI tokens, and fixed fees", async () => {
    const c = (await overview(db, q)).cost;
    expect(c.byLine.map((l) => l.line)).toEqual(expect.arrayContaining(["voice_minutes", "ai_tokens_in", "ai_tokens_out", "phone_number", "hosting"]));
    expect(c.totalInr).toBeGreaterThan(1000);
    expect(c.perBookedConsultationInr).toBeGreaterThan(0);
  });
  it("the agent never said a price (the scan found nothing), and callers who asked got the approved explanation", async () => {
    const o = await overview(db, q);
    expect(o.price.agentPriceFlags).toBe(0);
    expect(o.price.askedCount).toBeGreaterThanOrEqual(4);
    const t = (await one<{ transcript: unknown }>("select transcript from calls where vaani_call_id='demo-T02'"))[0]!.transcript;
    expect(JSON.stringify(t)).not.toMatch(/₹|lakh|per sq/i);
  });
  it("every call opens with the virtual-assistant and recording disclosure", async () => {
    expect((await one<{ n: number }>("select count(*)::int n from calls where is_demo and outcome <> 'missed' and disclosure_ok is not true"))[0]!.n).toBe(0);
  });
  it("only masked phones appear in the calls table, and demo numbers are in the made-up range", async () => {
    const rows = (await listCalls(db, { ...q, limit: 100 })).rows;
    expect(rows).toHaveLength(40);
    expect(rows.every((r) => r.phoneMasked === null || /^\+91 90••••••\d\d$/.test(r.phoneMasked))).toBe(true);
    const repo = new PgPostCallRepo(db, { pepper: PEPPER, encKey: ENC_KEY });
    const cid = (await one<{ caller_id: string }>("select caller_id from calls where vaani_call_id='demo-T01'"))[0]!.caller_id;
    expect((await repo.callerContact(cid))!.phone).toMatch(/^\+9190000\d{5}$/);
  });
  it("timestamps are September's, not the day the seed ran (alerts, escalations, flags)", async () => {
    const odd = await one("select 1 from outbox where is_demo and created_at > '2026-10-01' union all select 1 from escalations where is_demo and created_at > '2026-10-01' union all select 1 from calls where is_demo and created_at > '2026-10-01'");
    expect(odd).toEqual([]);
  });
  it("nothing was sent anywhere real: live outbox drains see no demo item, and live rotation sees no demo designer", async () => {
    await db.query("select set_config('app.demo','off',false)");
    const repo = new PgPostCallRepo(db, { pepper: PEPPER, encKey: ENC_KEY });
    expect(await repo.pendingOutbox(["owner_alert", "nikhil_alert", "design_lead_alert", "hubspot_deal", "confirmation_email", "designer_note_update", "call_routing"], 100)).toEqual([]);
  });
});

describe("realistic callers", () => {
  it("a caller's name is the one in their own enquiry, not a made-up one that contradicts the transcript", async () => {
    const names = Object.fromEntries((await one<{ id: string; name: string | null }>("select c.vaani_call_id as id, cr.name from calls c left join callers cr on cr.id = c.caller_id where c.is_demo")).map((r) => [r.id.replace("demo-", ""), r.name]));
    expect(names.T01).toBe("Priya");            // "Hi, I'm Priya."
    expect(names.F01).toBe("Sumit Bhatt");      // the form's Name field
    expect(names.W01).toBe("Kiran Mazumdar");   // the WhatsApp sender
    expect(names.T09).toBe("Sheetal Deshpande");
  });
});

describe("running it again, and reversing it", () => {
  it("running it twice does not duplicate anything (it resets its own rows first)", async () => {
    const again = await seedDemo(db, ENV);
    expect(again.calls).toBe(40);
    expect((await one<{ n: number }>("select count(*)::int n from calls where is_demo"))[0]!.n).toBe(40);
  }, 300_000);
  it("reset removes it all; real data added meanwhile survives, and it refuses (without --force) once real calls exist", async () => {
    const w = new World(db);
    await w.demo(false); await w.call("real-1", { rang: new Date("2026-09-10T05:00:00Z"), answeredAfterS: 2, outcome: "booked" });
    await expect(resetDemo(db)).rejects.toThrow(/real calls/i);
    await expect(seedDemo(db, ENV)).rejects.toThrow(/real calls/i);
    await resetDemo(db, { force: true });
    expect((await countDemo(db)).total).toBe(0);
    expect((await one<{ n: number }>("select count(*)::int n from calls where not is_demo"))[0]!.n).toBe(1);
  }, 300_000);
});
