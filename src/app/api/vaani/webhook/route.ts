import { handleVaaniWebhook } from "@/server/handlers/vaani-webhook";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const POST = (req: Request) => handleVaaniWebhook(req, getDeps());
