import { handleTool } from "@/server/handlers/tools";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const POST = (req: Request) => handleTool("book_slot", req, getDeps());
