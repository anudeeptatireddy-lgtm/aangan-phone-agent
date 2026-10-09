import { describe, it, expect, beforeAll } from "vitest";
import { makeDeps } from "@/server/deps";
import type { Deps } from "@/server/deps";
import { handleDashApi } from "@/server/handlers/dashboard-api";
import { handleDashboardLogin, handleDashboardSummary } from "@/server/handlers/dashboard";
import { dashboardAccess, sessionValue } from "@/server/dashboard-auth";
import { september, ENC_KEY, World } from "../dashboard/fixture";

const PASSWORD = "correct horse battery staple";
const BASE = { PHONE_HASH_PEPPER: "pepper-0123456789ab", PHONE_ENC_KEY: ENC_KEY, TOOL_SHARED_SECRET: "tool-secret-0123456789" };
const NOW = new Date("2026-10-07T06:00:00Z");
const SEP = "from=2026-09-01&to=2026-09-30";
const PATHS = [`overview?${SEP}`, `metrics/funnel?${SEP}`, `calls?${SEP}`, "calls/c1", `designers?${SEP}`, "review?week=2026-09-07"];
let w: World; let dev: Deps; let prod: Deps; let locked: Deps; let open: Deps;
beforeAll(async () => {
  ({ w } = await september());
  dev = makeDeps({ env: { ...BASE, NODE_ENV: "development" }, now: () => NOW, db: w.db });
  prod = makeDeps({ env: { ...BASE, NODE_ENV: "production", DASHBOARD_PASSWORD: PASSWORD }, now: () => NOW, db: w.db });
  locked = makeDeps({ env: { ...BASE, NODE_ENV: "production" }, now: () => NOW, db: w.db });
  open = makeDeps({ env: { ...BASE, NODE_ENV: "production", DASHBOARD_OPEN: "true" }, now: () => NOW, db: w.db });
}, 120_000);

const call = (deps: Deps, path: string, h: Record<string, string> = {}, init: RequestInit = {}, url = "http://localhost:3000") =>
  handleDashApi(new Request(`${url}/api/dashboard/${path}`, { ...init, headers: { ...h, ...(init.headers as Record<string, string> | undefined) } }), deps);

describe("outside production: no login at all", () => {
  it.each(["development", "test"])("NODE_ENV=%s: every dashboard endpoint answers with no credentials", async (env) => {
    const d = makeDeps({ env: { ...BASE, NODE_ENV: env }, now: () => NOW, db: w.db });
    for (const p of PATHS) expect((await call(d, p)).status, p).toBe(200);
  });
  it("the legacy summary endpoint is open too", async () => {
    expect((await handleDashboardSummary(new Request("http://localhost:3000/api/dashboard/summary"), makeDeps({ env: { ...BASE, NODE_ENV: "development" }, now: () => NOW }))).status).toBe(200);
  });
});

describe("in production: one password, and it fails closed", () => {
  it("no password configured: EVERYTHING is blocked (503), whatever credentials are sent", async () => {
    for (const p of PATHS) {
      expect((await call(locked, p)).status, p).toBe(503);
      expect((await call(locked, p, { authorization: "Bearer anything", cookie: "dash=anything" })).status, p).toBe(503);
    }
    expect(await (await call(locked, "overview")).json()).toEqual({ error: "dashboard_password_not_set" });
  });
  it("a configured password: 401 without it or with a wrong one; 200 with the bearer or the session cookie", async () => {
    for (const p of PATHS) {
      expect((await call(prod, p)).status, p).toBe(401);
      expect((await call(prod, p, { authorization: "Bearer wrong" })).status, p).toBe(401);
      expect((await call(prod, p, { authorization: `Bearer ${PASSWORD}` })).status, p).toBe(200);
      expect((await call(prod, p, { cookie: `dash=${sessionValue(PASSWORD)}` })).status, p).toBe(200);
    }
  });
  it("the cookie is a derived session value, never the password: sending the password as the cookie does not work", async () => {
    expect(sessionValue(PASSWORD)).not.toContain(PASSWORD);
    expect(sessionValue(PASSWORD)).toMatch(/^[0-9a-f]{64}$/);
    expect((await call(prod, "overview", { cookie: `dash=${encodeURIComponent(PASSWORD)}` })).status).toBe(401);
  });
  it("the password is never taken from the URL", async () => {
    expect((await call(prod, `overview?password=${encodeURIComponent(PASSWORD)}&token=${encodeURIComponent(PASSWORD)}`)).status).toBe(401);
  });
});

describe("the mode comes from NODE_ENV only, never from the Host header (which anyone can fake)", () => {
  it("production stays locked when the request claims to be localhost", async () => {
    for (const host of ["localhost:3000", "127.0.0.1", "[::1]:3000"]) {
      expect((await call(prod, "overview", { host, "x-forwarded-host": host }, {}, `http://${host}`)).status, host).toBe(401);
      expect((await call(locked, "overview", { host }, {}, `http://${host}`)).status, host).toBe(503);
    }
  });
  it("development stays open when the request claims to be a public site", async () => {
    expect((await call(dev, "overview", { host: "dashboard.aangan.example", "x-forwarded-host": "dashboard.aangan.example" }, {}, "https://dashboard.aangan.example")).status).toBe(200);
  });
  it("the access decision is a pure function of NODE_ENV and the password", () => {
    expect(dashboardAccess({ NODE_ENV: "development" })).toMatchObject({ mode: "open", who: "local user" });
    expect(dashboardAccess({ NODE_ENV: "test", DASHBOARD_PASSWORD: "x".repeat(12) })).toMatchObject({ mode: "open" });
    expect(dashboardAccess({ NODE_ENV: "production" })).toEqual({ mode: "blocked" });
    expect(dashboardAccess({ NODE_ENV: "production", DASHBOARD_PASSWORD: "" })).toEqual({ mode: "blocked" });
    expect(dashboardAccess({ NODE_ENV: "production", DASHBOARD_PASSWORD: PASSWORD })).toMatchObject({ mode: "password", who: "dashboard" });
  });
});

describe("the password screen's form handler", () => {
  const login = (deps: Deps, password: string | null) => {
    const f = new FormData(); if (password !== null) f.set("password", password);
    return handleDashboardLogin(new Request("http://localhost:3000/api/dashboard/login", { method: "POST", body: f }), deps);
  };
  it("right password: 303 to the dashboard and an httpOnly SameSite=Strict cookie holding the derived value", async () => {
    const r = await login(prod, PASSWORD);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("http://localhost:3000/dashboard");
    const c = r.headers.get("set-cookie")!;
    expect(c).toContain(`dash=${sessionValue(PASSWORD)}`);
    expect(c).toMatch(/HttpOnly/i); expect(c).toMatch(/SameSite=Strict/i); expect(c).not.toContain(encodeURIComponent(PASSWORD));
  });
  it("wrong or missing password: back to the screen with an error, no cookie", async () => {
    for (const p of ["nope", "", null]) { const r = await login(prod, p); expect(r.headers.get("location")).toBe("http://localhost:3000/dashboard?error=1"); expect(r.headers.get("set-cookie")).toBeNull(); }
  });
  it("no password set in production: blocked, no cookie ever; outside production it just opens the dashboard", async () => {
    const r = await login(locked, "anything");
    expect(r.status).toBe(503); expect(r.headers.get("set-cookie")).toBeNull();
    const o = await login(dev, "whatever");
    expect(o.status).toBe(303); expect(o.headers.get("location")).toBe("http://localhost:3000/dashboard"); expect(o.headers.get("set-cookie")).toBeNull();
  });
});

describe("who did it: 'local user' locally, 'dashboard' behind the password", () => {
  it("a phone reveal is logged with who", async () => {
    await call(dev, "calls/c1/reveal", {}, { method: "POST" });
    await call(prod, "calls/c1/reveal", { authorization: `Bearer ${PASSWORD}` }, { method: "POST" });
    const who = (await w.db.query("select who from phone_reveals order by revealed_at")).rows.map((r) => (r as { who: string }).who);
    expect(who).toEqual(["local user", "dashboard"]);
  });
  it("locally an overturn is recorded as 'local user' with no name needed (and a name typed in is ignored); in production the reviewer's name is required", async () => {
    const week = (await (await call(dev, "review?week=2026-08-31")).json()).items as { agentDecision: string; callId: string }[];
    const cid = week.find((i) => /booked/.test(i.agentDecision))!.callId;
    expect((await call(dev, "review", {}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callId: cid, overturned: true, reason: "no", reviewer: "Somebody Else" }) })).status).toBe(200);
    expect((await w.db.query("select reviewer from call_reviews where reviewed_at is not null")).rows).toEqual([{ reviewer: "local user" }]);
    const auth = { authorization: `Bearer ${PASSWORD}`, "content-type": "application/json" };
    expect((await call(prod, "review", auth, { method: "POST", body: JSON.stringify({ callId: cid, overturned: false }) })).status).toBe(400);
    expect((await call(prod, "review", auth, { method: "POST", body: JSON.stringify({ callId: cid, overturned: false, reviewer: "Nikhil" }) })).status).toBe(200);
    expect((await w.db.query("select reviewer from call_reviews where reviewed_at is not null")).rows).toEqual([{ reviewer: "Nikhil" }]);
  });
});

describe("the open demo: production with DASHBOARD_OPEN=true needs no password, and is read-only", () => {
  it("every dashboard endpoint answers with no credentials", async () => {
    for (const p of PATHS) expect((await call(open, p)).status, p).toBe(200);
  });
  it("it is an explicit switch: only the exact value true opens it; unset, false or anything else stays locked", async () => {
    for (const v of [undefined, "false", "TRUE", "1", "yes", ""]) {
      const d = makeDeps({ env: { ...BASE, NODE_ENV: "production", ...(v === undefined ? {} : { DASHBOARD_OPEN: v as "true" }) }, now: () => NOW, db: w.db });
      expect((await call(d, "overview")).status, String(v)).toBe(503);
    }
  });
  it("with a password also set, the open switch wins (the owner chose a public demo)", async () => {
    const d = makeDeps({ env: { ...BASE, NODE_ENV: "production", DASHBOARD_PASSWORD: PASSWORD, DASHBOARD_OPEN: "true" }, now: () => NOW, db: w.db });
    expect((await call(d, "overview")).status).toBe(200);
  });
  it("a public link can never reveal a real phone number or change a review: both are refused", async () => {
    const before = Number(((await w.db.query("select count(*)::int n from phone_reveals")).rows[0] as { n: number }).n);
    expect((await call(open, "calls/c1/reveal", {}, { method: "POST" })).status).toBe(403);
    expect(Number(((await w.db.query("select count(*)::int n from phone_reveals")).rows[0] as { n: number }).n)).toBe(before);
    const rows = ((await w.db.query("select count(*)::int n from call_reviews where reviewed_at is not null")).rows[0] as { n: number }).n;
    expect((await call(open, "review", { "content-type": "application/json" }, { method: "POST", body: JSON.stringify({ callId: "c1", overturned: true, reason: "x" }) })).status).toBe(403);
    expect(((await w.db.query("select count(*)::int n from call_reviews where reviewed_at is not null")).rows[0] as { n: number }).n).toBe(rows);
  });
  it("the access decision stays a pure function of the environment, never the Host header", async () => {
    expect(dashboardAccess({ NODE_ENV: "production", DASHBOARD_OPEN: "true" })).toMatchObject({ mode: "open", public: true });
    expect(dashboardAccess({ NODE_ENV: "production", DASHBOARD_OPEN: "false" })).toEqual({ mode: "blocked" });
    expect(dashboardAccess({ NODE_ENV: "development", DASHBOARD_OPEN: "true" })).toMatchObject({ mode: "open", public: false, who: "local user" });
    expect((await call(locked, "overview", { host: "localhost" }, {}, "http://localhost")).status).toBe(503);
  });
});

