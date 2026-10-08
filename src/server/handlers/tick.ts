import { timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";
import type { Deps } from "../deps";
import { reconcileVaani } from "../vaanivoice-reconcile";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function bearerMatches(req: Request, want: string): boolean {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1]!), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function step<T>(name: string, f: () => Promise<T>): Promise<T | { error: string }> {
  try { return await f(); } catch (e) {
    log("error", "tick: step failed", { step: name, error: String((e as Error).message).slice(0, 200) });
    return { error: String((e as Error).message).slice(0, 200) };
  }
}

/** The scheduled tick (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`): timeouts, unsent notes, recovery of calls Vaani never delivered, call-to-booking routing, outbox, the designers' progress in HubSpot, alerts. Each step is isolated. */
export async function handleTick(req: Request, deps: Deps): Promise<Response> {
  const secret = deps.env.CRON_SECRET;
  if (!secret) return json(503, { error: "cron_secret_not_configured" });
  if (!bearerMatches(req, secret)) return json(401, { error: "unauthorized" });
  const sweep = await step("sweep", () => deps.handoff.sweep());
  const retry = await step("retry", () => deps.handoff.retryPending());
  const vaani = await step("vaani", () => reconcileVaani(deps)); // first: a recovered call queues its own routing, outbox items and alerts, which the steps below then run
  const routing = await step("routing", () => deps.router.routePending()); // before the outbox: a match queues the deal, email and note update
  const outbox = await step("outbox", () => deps.outbox.run());
  const hubspot = await step("hubspot", async () => (deps.crmConfigured ? deps.crmSync.run() : { skipped: "hubspot_not_configured" })); // after the outbox: a deal created this tick is read from the next one
  const alerts = await step("alerts", () => deps.alerts.drain());
  const ok = ![sweep, retry, vaani, routing, outbox, hubspot, alerts].some((r) => "error" in r);
  return json(200, { ok, sweep, retry, outbox, alerts, routing, vaani, hubspot });
}
