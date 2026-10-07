import { describe, it, expect } from "vitest";
import { makeDeps } from "@/server/deps";
import { handleDashboardSummary, dashboardAuthorized } from "@/server/handlers/dashboard";

const TOKEN = "dash-token-0123456789";
const NOW = new Date("2026-10-07T06:00:00Z");
const mk = (token: string | null = TOKEN) => makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789", ...(token ? { DASHBOARD_TOKEN: token } : {}) }, now: () => NOW });
const get = (qs = "", auth?: string) => new Request(`http://localhost/api/dashboard/summary${qs}`, { headers: auth ? { authorization: auth } : {} });

describe("GET /api/dashboard/summary", () => {
  it("503 without DASHBOARD_TOKEN, 401 without or with a wrong bearer", async () => {
    expect((await handleDashboardSummary(get("", `Bearer ${TOKEN}`), mk(null))).status).toBe(503);
    expect((await handleDashboardSummary(get(), mk())).status).toBe(401);
    expect((await handleDashboardSummary(get("", "Bearer wrong-wrong-wrong-1"), mk())).status).toBe(401);
  });
  it("returns the summary for the last N days (default 30, max 366)", async () => {
    const d = mk();
    await d.postcall.upsertCall("c1", { rangAt: new Date("2026-10-06T05:00:00Z"), durationS: 120, outcome: "booked", costTotalInr: 10, postCallStatus: "processed" });
    const r = await handleDashboardSummary(get("?days=7", `Bearer ${TOKEN}`), d);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.totals.calls).toBe(1);
    expect(j.daily).toHaveLength(7);
    expect((await (await handleDashboardSummary(get("?days=9999", `Bearer ${TOKEN}`), d)).json()).daily.length).toBe(366);
    expect((await handleDashboardSummary(get("?days=abc", `Bearer ${TOKEN}`), d)).status).toBe(400);
  });
  it("dashboardAuthorized accepts the bearer or the cookie, constant-time, nothing else", () => {
    expect(dashboardAuthorized(new Request("http://x", { headers: { cookie: `dash=${TOKEN}` } }), TOKEN)).toBe(true);
    expect(dashboardAuthorized(new Request("http://x", { headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN)).toBe(true);
    expect(dashboardAuthorized(new Request("http://x?token=" + TOKEN), TOKEN)).toBe(false); // never from the URL
    expect(dashboardAuthorized(new Request("http://x", { headers: { cookie: "dash=nope" } }), TOKEN)).toBe(false);
  });
});
