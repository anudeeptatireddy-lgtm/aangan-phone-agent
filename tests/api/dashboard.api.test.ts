import { describe, it, expect, beforeAll } from "vitest";
import { makeDeps } from "@/server/deps";
import type { Deps } from "@/server/deps";
import { handleDashApi, parseDashQuery } from "@/server/handlers/dashboard-api";
import { september, ENC_KEY, World } from "../dashboard/fixture";

const ENV = { NODE_ENV: "development", PHONE_HASH_PEPPER: "pepper-0123456789ab", PHONE_ENC_KEY: ENC_KEY, TOOL_SHARED_SECRET: "tool-secret-0123456789" };
const NOW = new Date("2026-10-07T06:00:00Z");
let w: World; let d: Deps;
beforeAll(async () => { ({ w } = await september()); d = makeDeps({ env: ENV, now: () => NOW, db: w.db }); }, 120_000);

const req = (path: string, o: { method?: string; body?: unknown; deps?: Deps } = {}) =>
  handleDashApi(new Request(`http://localhost/api/dashboard/${path}`, { method: o.method ?? "GET", headers: o.body ? { "content-type": "application/json" } : {}, body: o.body ? JSON.stringify(o.body) : undefined }), o.deps ?? d);
const SEP = "from=2026-09-01&to=2026-09-30";
const ALL_GET = [`overview?${SEP}`, `metrics/funnel?${SEP}`, `metrics/outcomes?${SEP}`, `metrics/speed?${SEP}`, `metrics/price?${SEP}`, `metrics/escalations?${SEP}`, `metrics/router?${SEP}`, `metrics/cost?${SEP}`,
  `metrics/pipeline?${SEP}`, `metrics/breakdowns?${SEP}`, `metrics/daily?${SEP}`, `metrics/kpis?${SEP}`, `calls?${SEP}`, `calls/c1`, `designers?${SEP}`, `review?week=2026-09-07`];

describe("every dashboard endpoint (no login outside production: the gating is tested in dashboard-auth.test.ts)", () => {
  it.each(ALL_GET)("%s: 200", async (path) => { expect((await req(path)).status).toBe(200); });
  it("503 when there is no database (the dashboard never reads in-memory stores)", async () => {
    const mem = makeDeps({ env: ENV, now: () => NOW });
    const r = await req("overview", { deps: mem });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "database_not_configured" });
  });
  it("responses are never cached", async () => {
    expect((await req(`overview?${SEP}`)).headers.get("cache-control")).toBe("no-store");
  });
});

describe("date range and the live / demo switch", () => {
  it("parses inclusive IST dates into [from, to); defaults to this month in IST; live by default", () => {
    const a = parseDashQuery(new URL(`http://x/?${SEP}`), NOW);
    expect(a).toEqual({ ok: true, q: { from: new Date("2026-08-31T18:30:00Z"), to: new Date("2026-09-30T18:30:00Z"), demo: false } });
    expect(parseDashQuery(new URL("http://x/"), NOW)).toEqual({ ok: true, q: { from: new Date("2026-09-30T18:30:00Z"), to: new Date("2026-10-31T18:30:00Z"), demo: false } });
    expect(parseDashQuery(new URL("http://x/?from=2026-09-05&to=2026-09-05&data=demo"), NOW)).toMatchObject({ ok: true, q: { demo: true, to: new Date("2026-09-05T18:30:00Z") } });
  });
  it.each(["from=2026-9-1", "from=2026-09-30&to=2026-09-01", "from=2026-13-01", "from=2020-01-01&to=2026-01-01", "from=2026-02-31&to=2026-03-01", "data=both", "from=garbage"])("400 for %s", async (qs) => {
    const r = await req(`overview?${qs}`);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/^bad_/);
  });
  it("the same range gives different numbers for live and demo, and they never mix", async () => {
    const live = await (await req(`metrics/funnel?${SEP}`)).json();
    const demo = await (await req(`metrics/funnel?${SEP}&data=demo`)).json();
    expect(live.stages[0].count).toBe(9);
    expect(demo.stages[0].count).toBe(1);
  });
});

describe("metrics endpoints", () => {
  it("overview bundles every section, with the range echoed", async () => {
    const o = await (await req(`overview?${SEP}`)).json();
    expect(o.kpis).toMatchObject({ calls: 9, qualified: 3, booked: 3, pushed: 3, quoted: 2, won: 1, costPerBookedInr: 440.5, priceLeaks: 1 });
    expect(o.range).toMatchObject({ demo: false, from: "2026-08-31T18:30:00.000Z" });
    expect(o.funnel.stages).toHaveLength(10);
  });
  it("each metric endpoint returns just its metric; an unknown name is 404", async () => {
    expect((await (await req(`metrics/price?${SEP}`)).json())).toEqual({ askedCount: 1, agentPriceFlags: 1 });
    expect((await (await req(`metrics/daily?${SEP}`)).json())).toHaveLength(30);
    expect((await req(`metrics/secrets?${SEP}`)).status).toBe(404);
  });
  it("no response carries a full phone number, a caller's email, or a quote figure the agent could have said", async () => {
    for (const path of ALL_GET) {
      const text = await (await req(path)).text();
      expect(text, path).not.toMatch(/\+91900000001\d|9000000011|priya\.shah@/);
    }
  });
});

describe("calls endpoints", () => {
  it("filters, search and paging pass through; the page reports the total", async () => {
    const j = await (await req(`calls?${SEP}&outcome=booked&limit=2`)).json();
    expect(j.total).toBe(3);
    expect(j.rows).toHaveLength(2);
    expect((await (await req(`calls?${SEP}&search=priya`)).json()).rows.map((r: { id: string }) => r.id)).toEqual(["c1"]);
    expect((await (await req(`calls?${SEP}&afterHours=true`)).json()).total).toBe(2);
    expect((await req(`calls?${SEP}&afterHours=maybe`)).status).toBe(400);
  });
  it("CSV export: text/csv with a filename, masked phones only, same filters", async () => {
    const r = await req(`calls?${SEP}&format=csv&outcome=booked`);
    expect(r.headers.get("content-type")).toMatch(/text\/csv/);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="aangan-calls-2026-09-01_2026-09-30\.csv"/);
    const body = await r.text();
    expect(body.trim().split("\n")).toHaveLength(4);
    expect(body).toContain("+91 90••••••11");
    expect(body).not.toContain("+919000000011");
  });
  it("call detail: found, or 404", async () => {
    const j = await (await req("calls/c1")).json();
    expect(j.call.id).toBe("c1");
    expect(j.caller.phoneMasked).toBe("+91 90••••••11");
    expect((await req("calls/nope")).status).toBe(404);
    expect((await req("calls/demo-1")).status).toBe(404);
    expect((await req("calls/demo-1?data=demo")).status).toBe(200);
  });
});

describe("revealing a phone number", () => {
  it("POST only; logs the reveal; returns the number; the request IP is recorded", async () => {
    expect((await req("calls/c1/reveal")).status).toBe(405);
    const before = ((await w.db.query("select count(*)::int n from phone_reveals")).rows[0] as { n: number }).n;
    const r = await handleDashApi(new Request("http://localhost/api/dashboard/calls/c1/reveal", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ phone: "+919000000011" });
    expect(((await w.db.query("select count(*)::int n from phone_reveals")).rows[0] as { n: number }).n).toBe(before + 1);
    expect((await w.db.query("select ip from phone_reveals order by revealed_at desc limit 1")).rows[0]).toEqual({ ip: "203.0.113.9" });
  });
  it("a call with no caller: 404; unknown call: 404; a reveal is never cached", async () => {
    expect((await req("calls/c5/reveal", { method: "POST" })).status).toBe(404);
    expect((await req("calls/nope/reveal", { method: "POST" })).status).toBe(404);
    expect((await req("calls/c1/reveal", { method: "POST" })).headers.get("cache-control")).toBe("no-store");
  });
});

describe("designers and the weekly review", () => {
  it("designers", async () => {
    const j = await (await req(`designers?${SEP}`)).json();
    expect(j.map((x: { name: string }) => x.name)).toEqual(["Asha", "Bela"]);
  });
  it("review: GET draws and keeps the week's sample; POST confirms or overturns; validation is a 400", async () => {
    const a = await (await req("review?week=2026-08-31")).json();
    expect(a.items.length).toBeGreaterThan(0);
    const cid = a.items.find((i: { agentDecision: string }) => /booked/.test(i.agentDecision)).callId;
    expect((await req("review", { method: "POST", body: { callId: cid, overturned: true, reviewer: "Nikhil" } })).status).toBe(400); // reason required
    expect((await req("review", { method: "POST", body: { callId: cid, overturned: true, reason: "should not have booked", reviewer: "Nikhil" } })).status).toBe(200);
    expect((await req("review", { method: "POST", body: { callId: "nope", overturned: false, reviewer: "Nikhil" } })).status).toBe(404);
    expect((await req("review", { method: "POST", body: { callId: cid } })).status).toBe(400);
    const b = await (await req("review?week=2026-08-31")).json();
    expect(b.items.map((i: { callId: string }) => i.callId)).toEqual(a.items.map((i: { callId: string }) => i.callId));
    expect(b).toMatchObject({ reviewed: 1, overturned: 1, overturnRate: 1 });
  });
  it("a bad week is a 400; a missing week defaults to the current IST week", async () => {
    expect((await req("review?week=2026-09-08")).status).toBe(400); // not a Monday
    expect((await req("review")).status).toBe(200);
  });
});
