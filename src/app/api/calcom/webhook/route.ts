import { handleCalcomWebhook } from "@/server/handlers/calcom-webhook";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const POST = (req: Request) => handleCalcomWebhook(req, getDeps());
