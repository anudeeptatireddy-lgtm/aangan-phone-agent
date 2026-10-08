import { buildSummary } from "@/core/dashboard/summary";
import { dashboardAccess, sessionValue, verdictFor } from "../dashboard-auth";
import type { Deps } from "../deps";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const accessOf = (deps: Deps) => dashboardAccess(deps.env);

/** Shared gate for every dashboard API route: null = go ahead, else the refusal. */
export function dashboardGate(req: Request, deps: Deps): Response | null {
  const v = verdictFor(req, accessOf(deps));
  if (v === "ok") return null;
  return v === "blocked" ? json(503, { error: "dashboard_password_not_set" }) : json(401, { error: "unauthorized" });
}

export async function summaryFor(deps: Deps, days: number) {
  const to = new Date(deps.now().getTime() + 86_400_000 - (deps.now().getTime() + 330 * 60_000) % 86_400_000); // end of today IST
  const from = new Date(to.getTime() - days * 86_400_000);
  return buildSummary(await deps.dashboard.fetchRows(from, to), { from, to });
}

export async function handleDashboardSummary(req: Request, deps: Deps): Promise<Response> {
  const refused = dashboardGate(req, deps);
  if (refused) return refused;
  const raw = new URL(req.url).searchParams.get("days");
  const days = raw === null ? 30 : Number(raw);
  if (!Number.isInteger(days) || days < 1) return json(400, { error: "bad_days" });
  return json(200, await summaryFor(deps, Math.min(days, 366)));
}

/** The password screen's form POST (production only). The cookie holds a derived value, never the password. */
export async function handleDashboardLogin(req: Request, deps: Deps): Promise<Response> {
  const access = accessOf(deps);
  const url = new URL(req.url);
  const to = (path: string) => new Response(null, { status: 303, headers: { location: new URL(path, url).toString() } });
  if (access.mode === "blocked") return json(503, { error: "dashboard_password_not_set" });
  if (access.mode === "open") return to("/dashboard");
  const form = await req.formData().catch(() => null);
  const given = String(form?.get("password") ?? "");
  const ok = given.length > 0 && verdictFor(new Request(url, { headers: { authorization: `Bearer ${given}` } }), access) === "ok";
  if (!ok) { await new Promise((r) => setTimeout(r, 400)); return to("/dashboard?error=1"); } // a small delay blunts guessing
  const res = to("/dashboard");
  res.headers.append("set-cookie", `dash=${sessionValue(access.password)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${url.protocol === "https:" ? "; Secure" : ""}`);
  return res;
}
