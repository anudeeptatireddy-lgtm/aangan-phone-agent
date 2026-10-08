import { z } from "zod";
import { METRICS, overview, type MetricName, type Q } from "@/db/dash-metrics";
import { callsCsv, designerStats, getCallDetail, getReview, listCalls, revealPhone, reviewCall, weekStartOf, type CallsQuery } from "@/db/dash-calls";
import type { Deps } from "../deps";
import { accessOf, dashboardGate } from "./dashboard";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const IST_MS = 330 * 60_000;
const DAY = 86_400_000;
const MAX_DAYS = 400;

/** An IST calendar date `YYYY-MM-DD` -> the instant that day starts in IST, or null if it is not a real date. */
function istStart(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) return null;
  return new Date(t - IST_MS);
}
const istDateOf = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

/** `from` / `to` are inclusive IST dates; default is this month in IST. `data=demo` switches to the demo rows (default live). */
export function parseDashQuery(url: URL, now: Date): { ok: true; q: Q } | { ok: false; error: string } {
  const data = url.searchParams.get("data") ?? "live";
  if (data !== "live" && data !== "demo") return { ok: false, error: "bad_data" };
  const f = url.searchParams.get("from"), t = url.searchParams.get("to");
  const today = istDateOf(now);
  let from: Date | null, toInclusive: Date | null;
  if (f === null && t === null) { from = istStart(`${today.slice(0, 7)}-01`); const [y, m] = today.split("-").map(Number) as [number, number]; toInclusive = istStart(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`); if (!from || !toInclusive) return { ok: false, error: "bad_range" }; return { ok: true, q: { from, to: toInclusive, demo: data === "demo" } }; }
  from = f === null ? null : istStart(f);
  if (f !== null && !from) return { ok: false, error: "bad_from" };
  toInclusive = t === null ? null : istStart(t);
  if (t !== null && !toInclusive) return { ok: false, error: "bad_to" };
  if (!from) from = istStart(`${t!.slice(0, 7)}-01`)!;
  if (!toInclusive) toInclusive = istStart(f! > today ? f! : today)!;
  const to = new Date(toInclusive.getTime() + DAY);
  if (to <= from || (to.getTime() - from.getTime()) / DAY > MAX_DAYS) return { ok: false, error: "bad_range" };
  return { ok: true, q: { from, to, demo: data === "demo" } };
}

const isMonday = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && istStart(s) !== null && new Date(`${s}T00:00:00Z`).getUTCDay() === 1;

const ReviewBody = z.object({ callId: z.string().min(1), overturned: z.boolean(), reason: z.string().max(500).optional(), reviewer: z.string().max(80).optional() });

/** One entry point for every /api/dashboard/* data route: login, database, range, then the route. */
export async function handleDashApi(req: Request, deps: Deps): Promise<Response> {
  const refused = dashboardGate(req, deps);
  if (refused) return refused;
  const who = accessOf(deps).mode === "open" ? "local user" : "dashboard";
  const db = deps.db;
  if (!db) return json(503, { error: "database_not_configured" }); // the dashboard reads Postgres only
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/dashboard\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a, b] = parts;
  const range = parseDashQuery(url, deps.now());
  if (!range.ok) return json(400, { error: range.error });
  const q = range.q;
  const GET = req.method === "GET";

  if (head === "overview" && GET) return json(200, await overview(db, q));
  if (head === "metrics" && GET && a) {
    const fn = (METRICS as Record<string, (db: typeof deps.db & object, q: Q) => Promise<unknown>>)[a];
    if (!Object.hasOwn(METRICS, a) || !fn) return json(404, { error: "unknown_metric" });
    return json(200, await fn(db, q));
  }
  if (head === "designers" && GET) return json(200, await designerStats(db, q));

  if (head === "calls" && !a && GET) {
    const sp = url.searchParams;
    const ah = sp.get("afterHours");
    if (ah !== null && ah !== "true" && ah !== "false") return json(400, { error: "bad_filter" });
    const num = (k: string) => (sp.get(k) === null ? undefined : Number(sp.get(k)));
    const lim = num("limit"), off = num("offset");
    if ((lim !== undefined && !Number.isInteger(lim)) || (off !== undefined && !Number.isInteger(off))) return json(400, { error: "bad_filter" });
    const designerId = sp.get("designerId");
    if (designerId && !/^[0-9a-f-]{36}$/i.test(designerId)) return json(400, { error: "bad_filter" });
    const query: CallsQuery = { ...q, outcome: sp.get("outcome") ?? undefined, fit: sp.get("fit") ?? undefined, designerId: designerId ?? undefined,
      afterHours: ah === null ? undefined : ah === "true", search: sp.get("search") ?? undefined, limit: lim, offset: off };
    if (sp.get("format") === "csv") {
      const all = await listCalls(db, { ...query, limit: 500, offset: 0 });
      const f = istDateOf(q.from), t = istDateOf(new Date(q.to.getTime() - 1));
      return new Response(callsCsv(all.rows), { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="aangan-calls-${f}_${t}.csv"` } });
    }
    return json(200, await listCalls(db, query));
  }
  if (head === "calls" && a && !b && GET) {
    const detail = await getCallDetail(db, a, q.demo);
    return detail ? json(200, detail) : json(404, { error: "call_not_found" });
  }
  if (head === "calls" && a && b === "reveal") {
    if (req.method !== "POST") return json(405, { error: "post_only" });
    const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "").trim() || undefined;
    const r = await revealPhone(db, deps.postcall, { vendorCallId: a, demo: q.demo, ip, who });
    if (r.ok) return json(200, { phone: r.phone });
    return json(r.error === "rate_limited" ? 429 : 404, { error: r.error });
  }
  if (head === "review") {
    const week = url.searchParams.get("week") ?? weekStartOf(deps.now());
    if (GET) return isMonday(week) ? json(200, await getReview(db, { demo: q.demo, weekStart: week })) : json(400, { error: "bad_week" });
    if (req.method === "POST") {
      const body = ReviewBody.safeParse(await req.json().catch(() => null));
      if (!body.success) return json(400, { error: "bad_body" });
      // No login locally means no name: the review is "local user". Behind the password the reviewer types their own name (self-declared).
      const reviewer = who === "local user" ? "local user" : body.data.reviewer ?? "";
      const r = await reviewCall(db, { ...body.data, reviewer, demo: q.demo });
      if (r.ok) return json(200, { ok: true });
      return json(r.error === "not_in_review" ? 404 : 400, { error: r.error });
    }
  }
  return json(404, { error: "not_found" });
}
