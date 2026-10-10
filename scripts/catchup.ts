// Catch-up for calls whose Vaani webhook came late (or never): re-delivers each call to OUR live webhook, which re-fetches the call from Vaani itself
// (nothing in the request is trusted) and processes it. Safe to run twice: a call already processed answers "already_processed".
//   pnpm catchup <call_id> [<call_id> ...]        call ids are in Vaani -> Conversations -> History (they look like webrtc-1791628224-ed71690f)
//   BASE_URL=http://localhost:3000 pnpm catchup ...   to aim it at a local server instead of the live site
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const secret = process.env.VAANIVOICE_WEBHOOK_SECRET;
const base = process.env.BASE_URL ?? "https://aangan-phone-agent-eight.vercel.app";
const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!secret) { console.error("VAANIVOICE_WEBHOOK_SECRET is needed (it is in .env.local)."); process.exit(1); }
if (!ids.length) { console.error("Usage: pnpm catchup <call_id> [<call_id> ...]\nCall ids are in Vaani -> Conversations -> History."); process.exit(1); }

let bad = 0;
for (const id of ids) {
  if (!/^[A-Za-z0-9_.:-]{6,120}$/.test(id)) { console.log(`${id}: not a call id, skipped`); bad++; continue; }
  try {
    const res = await fetch(`${base}/api/vaanivoice/webhook/${secret}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "call_postprocessing", data: { call_id: id } }) });
    const body = (await res.json().catch(() => ({}))) as { status?: string; outcome?: string; error?: string; ignored?: string };
    const ok = res.ok && !body.ignored;
    if (!ok) bad++;
    console.log(`${id}: ${res.status} ${body.status ?? body.error ?? body.ignored ?? ""}${body.outcome ? ` (${body.outcome})` : ""}${res.status === 503 ? "  <- Vaani has no transcript for it yet; run again in a minute" : ""}`);
  } catch (e) { bad++; console.log(`${id}: could not reach ${base} (${String((e as Error).message).slice(0, 80)})`); }
}
process.exit(bad ? 1 : 0);
