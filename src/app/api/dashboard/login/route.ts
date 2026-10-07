import { timingSafeEqual } from "node:crypto";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Form POST with the dashboard token; on success sets an httpOnly cookie so the token never sits in a URL. */
export async function POST(req: Request) {
  const want = getDeps().env.DASHBOARD_TOKEN;
  const form = await req.formData().catch(() => null);
  const given = String(form?.get("token") ?? "");
  const ok = !!want && given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
  const res = new Response(null, { status: 303, headers: { location: new URL(ok ? "/dashboard" : "/dashboard?error=1", req.url).toString() } });
  if (ok) res.headers.append("set-cookie", `dash=${encodeURIComponent(given)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`);
  return res;
}
