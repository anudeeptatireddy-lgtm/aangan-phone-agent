import { handleTool } from "@/server/handlers/tools";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const POST = (req: Request) => handleTool("check_fit", req, getDeps());
