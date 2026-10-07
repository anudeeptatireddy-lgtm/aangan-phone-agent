import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./helpers";
import { buildSeedSql } from "@/db/seed";
import { RULES_V1 } from "@/core/rules/config.v1";
import { SCRIPTS } from "@/core/scripts";
import { FESTIVAL_DATES } from "@/core/festivals";

let db: PGlite;
beforeAll(async () => { db = await freshDb({ seed: true }); }, 60_000);
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;

describe("supabase/seed.sql", () => {
  it("is exactly what the generator produces from the typed config (no drift)", () => {
    expect(readFileSync("supabase/seed.sql", "utf8")).toBe(buildSeedSql());
  });
  it("loads the active rule version v1 with config identical to RULES_V1 (Nikhil sign-off still pending)", async () => {
    const r = await rows<{ version: number; status: string; config: unknown }>("select version, status, config from rule_versions");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ version: 1, status: "active" });
    expect(r[0]!.config).toEqual(JSON.parse(JSON.stringify(RULES_V1)));
    expect((r[0]!.config as typeof RULES_V1).approval.nikhilProductionSignoff).toBe("pending");
  });
  it("loads every approved script in all three languages with its review status", async () => {
    const r = await rows<{ n: number }>("select count(*)::int as n from approved_texts");
    expect(r[0]!.n).toBe(Object.keys(SCRIPTS).length * 3);
    const s = await rows<{ status: string; body: string }>("select status, body from approved_texts where key='price_explanation' and locale='hi'");
    expect(s[0]!.status).toBe("approved_pending_native_check");
    expect(s[0]!.body).toBe(SCRIPTS.price_explanation.hi.text);
  });
  it("loads festival dates, the VIP referrer and Mon-Fri 10-19 hours", async () => {
    expect((await rows<{ d: string }>("select event_date::text as d from festival_dates where key='diwali'"))[0]!.d).toBe(FESTIVAL_DATES[0]!.date);
    expect((await rows<{ name: string }>("select name from vip_referrers")).map((r) => r.name)).toEqual(["Vikram Agarwal"]);
    const h = await rows<{ weekday: number; opens: string; closes: string }>("select weekday, opens::text, closes::text from studio_hours order by weekday");
    expect(h.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(h[0]).toMatchObject({ opens: "10:00:00", closes: "19:00:00" });
  });
  it("seeds 3 clearly-marked TEST designers: one principal, one design lead, no chat id or calendar yet", async () => {
    const d = await rows<{ name: string; is_test: boolean; is_principal: boolean; is_design_lead: boolean; telegram_chat_id: unknown; calendar_id: unknown }>("select * from designers order by name");
    expect(d).toHaveLength(3);
    for (const x of d) { expect(x.is_test).toBe(true); expect(x.name).toMatch(/^TEST /); expect(x.telegram_chat_id).toBeNull(); expect(x.calendar_id).toBeNull(); }
    expect(d.filter((x) => x.is_principal)).toHaveLength(1);
    expect(d.filter((x) => x.is_design_lead)).toHaveLength(1);
  });
  it("contains no secrets, phone numbers or budget figures outside the rule config", () => {
    const sql = readFileSync("supabase/seed.sql", "utf8");
    expect(sql).not.toMatch(/vaani_[0-9a-f]{16,}|vv_(live|whk)_|pat-[a-z0-9]+-[0-9a-f-]{20,}|\+91\s?\d{10}/);
  });
  it("is idempotent (safe to re-run)", async () => {
    await db.exec(readFileSync("supabase/seed.sql", "utf8"));
    expect((await rows<{ n: number }>("select count(*)::int as n from designers"))[0]!.n).toBe(3);
    expect((await rows<{ n: number }>("select count(*)::int as n from approved_texts"))[0]!.n).toBe(Object.keys(SCRIPTS).length * 3);
  });
});
