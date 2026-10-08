import { describe, it, expect } from "vitest";
import { makeDeps } from "@/server/deps";
import { handleDashboardSummary } from "@/server/handlers/dashboard";

const NOW = new Date("2026-10-07T06:00:00Z");
const BASE = { PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789" };
const mk = (env = "development") => makeDeps({ env: { ...BASE, NODE_ENV: env }, now: () => NOW });
const get = (qs = "") => new Request(`http://localhost/api/dashboard/summary${qs}`);

describe("GET /api/dashboard/summary", () => {
  it("no login outside production; in production it is closed without the password", async () => {
    expect((await handleDashboardSummary(get(), mk())).status).toBe(200);
    expect((await handleDashboardSummary(get(), mk("production"))).status).toBe(503);
  });
  it("returns the summary for the last N days (default 30, max 366)", async () => {
    const d = mk();
    await d.postcall.upsertCall("c1", { rangAt: new Date("2026-10-06T05:00:00Z"), durationS: 120, outcome: "booked", costTotalInr: 10, postCallStatus: "processed" });
    const r = await handleDashboardSummary(get("?days=7"), d);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.totals.calls).toBe(1);
    expect(j.daily).toHaveLength(7);
    expect((await (await handleDashboardSummary(get("?days=9999"), d)).json()).daily.length).toBe(366);
    expect((await handleDashboardSummary(get("?days=abc"), d)).status).toBe(400);
  });
});
