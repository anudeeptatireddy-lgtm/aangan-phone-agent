import { handleDashboardSummary } from "@/server/handlers/dashboard";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (req: Request) => handleDashboardSummary(req, getDeps());
