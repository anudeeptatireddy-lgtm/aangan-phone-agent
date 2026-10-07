import { handleVaaniVoiceWebhook } from "@/server/handlers/vaanivoice-webhook";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
// Configure in Vaani: https://<host>/api/vaanivoice/webhook/<VAANIVOICE_WEBHOOK_SECRET>
export const POST = async (req: Request, ctx: { params: Promise<{ secret: string }> }) => handleVaaniVoiceWebhook(req, getDeps(), (await ctx.params).secret);
