import { handleTick } from "@/server/handlers/tick";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => handleTick(req, getDeps());
