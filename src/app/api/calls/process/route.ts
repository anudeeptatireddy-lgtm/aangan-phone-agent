import { handleProcessCall } from "@/server/handlers/post-call";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const POST = (req: Request) => handleProcessCall(req, getDeps());
