import { handleTelegramWebhook } from "@/server/handlers/telegram-webhook";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const POST = (req: Request) => handleTelegramWebhook(req, getDeps());
