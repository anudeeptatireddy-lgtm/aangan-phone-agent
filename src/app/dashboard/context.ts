import { cookies } from "next/headers";
import { dashboardAccess, verdictFor } from "@/server/dashboard-auth";
import { parseDashQuery } from "@/server/handlers/dashboard-api";
import { getDeps, type Deps } from "@/server/deps";
import { previousRange, type Q } from "@/db/dash-metrics";
import type { SqlClient } from "@/db/pg-booking-repo";

export type SP = Record<string, string | undefined>;
export type DashCtx =
  | { state: "blocked" }                       // production without DASHBOARD_PASSWORD: fail closed
  | { state: "login"; error: boolean }         // production with a password and no session
  | { state: "nodb" }
  | { state: "ok"; deps: Deps; db: SqlClient; q: Q; prev: Q & { kind: "month" | "days" }; demo: boolean; from: string; to: string; notice?: string; who: "local user" | "dashboard" | "open demo"; locked: boolean };

const IST_MS = 330 * 60_000;
const ist = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

/** Access gate (NODE_ENV and DASHBOARD_PASSWORD only), database gate, and the date range / live-demo choice for a dashboard page. Same rules as the API. */
export async function dashContext(sp: SP): Promise<DashCtx> {
  const deps = getDeps();
  const access = dashboardAccess(deps.env);
  if (access.mode === "blocked") return { state: "blocked" };
  const jar = await cookies();
  if (verdictFor(new Request("http://x", { headers: { cookie: `dash=${jar.get("dash")?.value ?? ""}` } }), access) !== "ok") return { state: "login", error: !!sp.error };
  if (!deps.db) return { state: "nodb" };
  const demo = sp.data === "demo";
  const params = new URLSearchParams();
  if (sp.from) params.set("from", sp.from);
  if (sp.to) params.set("to", sp.to);
  if (demo) params.set("data", "demo");
  // Demo data lives in the month it was made (September 2026 for the 40 enquiries), so open there rather than on an empty "this month".
  if (demo && !sp.from && !sp.to) {
    const m = (await deps.db.query("select max(coalesce(rang_at, ended_at)) as t from calls where is_demo")).rows[0]?.t;
    if (m) {
      const [y, mo] = ist(new Date(String(m))).split("-").map(Number) as [number, number, number];
      params.set("from", `${y}-${String(mo).padStart(2, "0")}-01`);
      params.set("to", new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)); // day 0 of the next month = last day of this one
    }
  }
  let notice: string | undefined;
  let r = parseDashQuery(new URL(`http://x/?${params}`), deps.now());
  if (!r.ok) { notice = "That date range was not valid, so this month is shown."; r = parseDashQuery(new URL(`http://x/${demo ? "?data=demo" : ""}`), deps.now()); }
  if (!r.ok) return { state: "nodb" };
  return { state: "ok", deps, db: deps.db, q: r.q, prev: previousRange(r.q), demo, from: ist(r.q.from), to: ist(new Date(r.q.to.getTime() - 1)), notice, who: access.who, locked: access.mode === "password" };
}

/** Query string that carries the range and the live/demo choice from page to page. */
export function carry(c: { from: string; to: string; demo: boolean }, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams({ from: c.from, to: c.to });
  if (c.demo) p.set("data", "demo");
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") p.set(k, v);
  return `?${p}`;
}
