import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./helpers";

const TABLES = ["approved_texts", "audit_flags", "bookings", "calcom_bookings", "call_reviews", "callers", "calls", "crm_links", "dashboard_users", "designers",
  "enquiries", "escalations", "festival_dates", "handoffs", "outbox", "rule_evaluations", "rule_versions", "studio_hours", "usage_costs", "vip_referrers", "webhook_events"];

let db: PGlite;
beforeAll(async () => { db = await freshDb({ seed: true }); }, 60_000);
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

describe("schema v2 meets the owner's approval conditions", () => {
  it("has exactly the expected tables (adding one is a conscious change)", async () => {
    const t = await rows<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by 1");
    expect(t.map((r) => r.tablename)).toEqual(TABLES);
  });

  it("RLS is enabled AND forced on every table", async () => {
    const t = await rows<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
    expect(t).toHaveLength(TABLES.length);
    for (const r of t) { expect(r.relrowsecurity, r.relname).toBe(true); expect(r.relforcerowsecurity, r.relname).toBe(true); }
  });

  it("anon and authenticated have no privileges on any table, and no policies grant them access", async () => {
    const g = await rows("select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')");
    expect(g).toEqual([]);
    expect(await rows("select * from pg_policies where schemaname='public'")).toEqual([]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from callers")).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into vip_referrers(name) values ('x')")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
  });

  it("hardening: functions pin their search_path and btree_gist is not in the public schema", async () => {
    const f = await rows<{ proname: string; proconfig: string[] | null }>("select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'");
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect(x.proconfig?.some((c) => c.startsWith("search_path=")), x.proname).toBe(true);
    const e = await rows<{ ns: string }>("select extnamespace::regnamespace::text as ns from pg_extension where extname='btree_gist'");
    expect(e[0]!.ns).toBe("extensions");
  });

  it("phone numbers: only hash, ciphertext and masked columns exist; none is plaintext", async () => {
    const c = await rows<{ table_name: string; column_name: string }>("select table_name, column_name from information_schema.columns where table_schema='public' and (column_name ilike '%phone%' or column_name ilike '%mobile%' or column_name ilike '%e164%')");
    expect(c.map((r) => `${r.table_name}.${r.column_name}`).sort()).toEqual(["callers.phone_enc", "callers.phone_hash", "callers.phone_masked"]);
    const enc = await rows<{ data_type: string }>("select data_type from information_schema.columns where table_name='callers' and column_name='phone_enc'");
    expect(enc[0]!.data_type).toBe("bytea");
  });

  it("rule_version is stored on every enquiry and every evaluation (NOT NULL)", async () => {
    const n = await rows<{ table_name: string; is_nullable: string }>("select table_name, is_nullable from information_schema.columns where column_name='rule_version_id' and table_name in ('enquiries','rule_evaluations')");
    expect(n).toHaveLength(2);
    for (const r of n) expect(r.is_nullable, r.table_name).toBe("NO");
  });

  it("per-call cost fields exist on calls", async () => {
    const c = await rows<{ column_name: string }>("select column_name from information_schema.columns where table_name='calls' and column_name like 'cost_%' order by 1");
    expect(c.map((r) => r.column_name)).toEqual(["cost_ai_inr", "cost_total_inr", "cost_voice_inr"]);
  });

  it("no price/quote/rate-per-area fields anywhere (only the caller's volunteered budget and tooling costs)", async () => {
    const c = await rows<{ table_name: string; column_name: string }>("select table_name, column_name from information_schema.columns where table_schema='public'");
    const bad = c.filter((r) => /price|quote|per_?sq|sqft_rate|rate_per/i.test(r.column_name));
    expect(bad).toEqual([]);
    const money = c.filter((r) => /_inr$|budget|amount|cost|fx_/i.test(r.column_name)).map((r) => `${r.table_name}.${r.column_name}`).sort();
    expect(money).toEqual(["calls.cost_ai_inr", "calls.cost_total_inr", "calls.cost_voice_inr", "enquiries.caller_budget_inr", "usage_costs.amount_inr", "usage_costs.fx_inr_per_usd", "usage_costs.unit_cost"]);
  });
});

describe("post-call additions (migration 0002)", () => {
  it("calls carry the post-call status, summary and processing time; enquiries carry the designer note and the exact rule input", async () => {
    const c = await rows<{ column_name: string }>("select column_name from information_schema.columns where table_name='calls' and column_name in ('post_call_status','summary','processed_at')");
    expect(c.map((r) => r.column_name).sort()).toEqual(["post_call_status", "processed_at", "summary"]);
    const e = await rows<{ column_name: string }>("select column_name from information_schema.columns where table_name='enquiries' and column_name in ('designer_note','rule_input')");
    expect(e.map((r) => r.column_name).sort()).toEqual(["designer_note", "rule_input"]);
  });
  it("audit flags accept 'extraction_failed' and still reject unknown kinds", async () => {
    const callId = (await rows<{ id: string }>("insert into calls(vaani_call_id) values ('vc-flag') returning id"))[0]!.id;
    await db.query("insert into audit_flags(call_id, kind) values ($1,'extraction_failed')", [callId]);
    await expect(db.query("insert into audit_flags(call_id, kind) values ($1,'nonsense')", [callId])).rejects.toThrow(/check constraint/i);
  });
  it("post_call_status only takes the three known values", async () => {
    await expect(db.query("insert into calls(vaani_call_id, post_call_status) values ('vc-bad','weird')")).rejects.toThrow(/check constraint/i);
  });
  it("the outbox is idempotent on dedupe_key and restricted to known kinds and statuses", async () => {
    await db.query("insert into outbox(kind, dedupe_key) values ('owner_alert','a')");
    await expect(db.query("insert into outbox(kind, dedupe_key) values ('owner_alert','a')")).rejects.toThrow(/unique|duplicate/i);
    await expect(db.query("insert into outbox(kind, dedupe_key) values ('mystery','b')")).rejects.toThrow(/check constraint/i);
    await expect(db.query("insert into outbox(kind, dedupe_key, status) values ('owner_alert','c','weird')")).rejects.toThrow(/check constraint/i);
  });
});

describe("integrity rules", () => {
  const uid = () => crypto.randomUUID();
  let designerA = "", designerB = "", enquiryId = "";
  beforeAll(async () => {
    designerA = (await rows<{ id: string }>("insert into designers(name) values ('A') returning id"))[0]!.id;
    designerB = (await rows<{ id: string }>("insert into designers(name) values ('B') returning id"))[0]!.id;
    const c = (await rows<{ id: string }>("insert into callers(phone_hash, phone_enc, phone_masked) values ($1, $2, '+91 90••••••01') returning id", ["h" + uid(), new Uint8Array([1, 2, 3])]))[0]!.id;
    enquiryId = (await rows<{ id: string }>("insert into enquiries(caller_id) values ($1) returning id", [c]))[0]!.id;
  });
  const book = (d: string, s: string, e: string, status = "confirmed") =>
    db.query("insert into bookings(enquiry_id, designer_id, starts_at, ends_at, status) values ($1,$2,$3,$4,$5)", [enquiryId, d, s, e, status]);

  it("an enquiry is stamped with the ACTIVE rule version automatically", async () => {
    const e = await rows<{ v: number }>("select rv.version as v from enquiries q join rule_versions rv on rv.id=q.rule_version_id where q.id=$1", [enquiryId]);
    expect(e[0]!.v).toBe(1);
  });
  it("an enquiry cannot exist without a rule version", async () => {
    const empty = await freshDb({ seed: false });
    const c = (await empty.query<{ id: string }>("insert into callers(phone_hash, phone_enc, phone_masked) values ('h', $1, 'm') returning id", [new Uint8Array([1])])).rows[0]!.id;
    await expect(empty.query("insert into enquiries(caller_id) values ($1)", [c])).rejects.toThrow(/null value|not-null/i);
  }, 60_000);
  it("only one rule version can be active", async () => {
    await expect(db.query("insert into rule_versions(version, config, status) values (2, '{}', 'active')")).rejects.toThrow(/unique|duplicate/i);
    await db.query("insert into rule_versions(version, config, status) values (2, '{}', 'draft')");
  });
  it("calls are inbound-only (hard rule 5)", async () => {
    await expect(db.query("insert into calls(direction) values ('outbound')")).rejects.toThrow(/check constraint/i);
    await db.query("insert into calls(vaani_call_id) values ('vc-1')");
    await expect(db.query("insert into calls(vaani_call_id) values ('vc-1')")).rejects.toThrow(/unique|duplicate/i);
  });
  it("a designer cannot be double-booked", async () => {
    await book(designerA, "2026-10-12T10:00:00+05:30", "2026-10-12T11:00:00+05:30");
    await expect(book(designerA, "2026-10-12T10:30:00+05:30", "2026-10-12T11:30:00+05:30", "held")).rejects.toThrow(/exclusion constraint/i);
  });
  it("back-to-back slots, other designers and cancelled bookings do not conflict", async () => {
    await book(designerA, "2026-10-12T11:00:00+05:30", "2026-10-12T12:00:00+05:30");
    await book(designerB, "2026-10-12T10:30:00+05:30", "2026-10-12T11:30:00+05:30");
    await book(designerA, "2026-10-12T10:15:00+05:30", "2026-10-12T10:45:00+05:30", "cancelled");
  });
  it("a booking must end after it starts", async () => {
    await expect(book(designerB, "2026-10-13T11:00:00+05:30", "2026-10-13T10:00:00+05:30")).rejects.toThrow(/check constraint/i);
  });
  it("webhook events are idempotent on (source, external_id)", async () => {
    await db.query("insert into webhook_events(source, external_id) values ('vaani','evt_1')");
    await expect(db.query("insert into webhook_events(source, external_id) values ('vaani','evt_1')")).rejects.toThrow(/unique|duplicate/i);
  });
  it("a call can appear once per weekly review", async () => {
    const callId = (await rows<{ id: string }>("insert into calls(vaani_call_id) values ('vc-2') returning id"))[0]!.id;
    await db.query("insert into call_reviews(week_start, call_id, agent_decision) values ('2026-10-05', $1, 'fit')", [callId]);
    await expect(db.query("insert into call_reviews(week_start, call_id, agent_decision) values ('2026-10-05', $1, 'fit')", [callId])).rejects.toThrow(/unique|duplicate/i);
  });
  it("escalation modes match the planner's modes", async () => {
    const callId = (await rows<{ id: string }>("insert into calls(vaani_call_id) values ('vc-3') returning id"))[0]!.id;
    for (const mode of ["live_transfer", "callback_sla", "callback_promised", "queued_review", "offer_choice", "continue_booking"])
      await db.query("insert into escalations(call_id, reason, mode) values ($1,'complaint',$2)", [callId, mode]);
    await expect(db.query("insert into escalations(call_id, reason, mode) values ($1,'complaint','nonsense')", [callId])).rejects.toThrow(/check constraint/i);
  });
});
