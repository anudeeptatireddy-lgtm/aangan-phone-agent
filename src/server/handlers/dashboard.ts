import { timingSafeEqual } from "node:crypto";
import { buildSummary } from "@/core/dashboard/summary";
import type { Deps } from "../deps";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Bearer header (API) or the `dash` cookie (the page). Never the URL: query strings end up in logs and browser history. */
export function dashboardAuthorized(req: Request, token: string): boolean {
  const bearer = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (bearer && same(bearer, token)) return true;
  const cookie = /(?:^|;\s*)dash=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  return !!cookie && same(decodeURIComponent(cookie), token);
}

export async function summaryFor(deps: Deps, days: number) {
  const to = new Date(deps.now().getTime() + 86_400_000 - (deps.now().getTime() + 330 * 60_000) % 86_400_000); // end of today IST
  const from = new Date(to.getTime() - days * 86_400_000);
  return buildSummary(await deps.dashboard.fetchRows(from, to), { from, to });
}

export async function handleDashboardSummary(req: Request, deps: Deps): Promise<Response> {
  const token = deps.env.DASHBOARD_TOKEN;
  if (!token) return json(503, { error: "dashboard_token_not_configured" });
  if (!dashboardAuthorized(req, token)) return json(401, { error: "unauthorized" });
  const raw = new URL(req.url).searchParams.get("days");
  const days = raw === null ? 30 : Number(raw);
  if (!Number.isInteger(days) || days < 1) return json(400, { error: "bad_days" });
  return json(200, await summaryFor(deps, Math.min(days, 366)));
}
