import { handleDashApi } from "@/server/handlers/dashboard-api";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// /api/dashboard/{overview, metrics/<name>, calls, calls/<id>, calls/<id>/reveal, designers, review}. (login and summary are their own routes.)
export const GET = (req: Request) => handleDashApi(req, getDeps());
export const POST = (req: Request) => handleDashApi(req, getDeps());
