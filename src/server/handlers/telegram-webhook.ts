import { timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";
import type { Deps } from "../deps";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function secretMatches(given: string | null, want: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface CallbackQuery { id?: string; from?: { id?: number }; data?: string }
interface Update { update_id?: number; callback_query?: CallbackQuery }

/**
 * Telegram -> us. Authenticated by the secret_token we registered with setWebhook (header X-Telegram-Bot-Api-Secret-Token).
 * Always answers 200 for authenticated updates, including ones we ignore, so Telegram does not keep redelivering them.
 */
export async function handleTelegramWebhook(req: Request, deps: Deps): Promise<Response> {
  const secret = deps.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: "webhook_secret_not_configured" });
  if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), secret)) return json(401, { error: "bad_secret" });

  let update: Update;
  try { update = (await req.json()) as Update; } catch { return json(400, { error: "bad_json" }); }
  if (typeof update !== "object" || update === null) return json(400, { error: "bad_json" });

  if (typeof update.update_id === "number" && deps.repo.recordWebhookEvent(`telegram:${update.update_id}`, "telegram.update", deps.now().toISOString())) {
    return json(200, { ok: true, duplicate: true });
  }
  const q = update.callback_query;
  if (!q || typeof q.id !== "string" || typeof q.data !== "string" || typeof q.from?.id !== "number") return json(200, { ok: true, ignored: true });

  try {
    const r = await deps.handoff.handleCallback({ callbackQueryId: q.id, fromChatId: q.from.id, data: q.data });
    return json(200, { ok: true, outcome: r.outcome });
  } catch (e) {
    log("error", "telegram webhook: callback failed", { error: String(e) });
    await deps.notifier.answerCallback(q.id, "Something went wrong. Please try again.").catch(() => undefined);
    return json(200, { ok: false }); // 200: a retry of the same press would only repeat the failure; the sweep covers timing
  }
}
