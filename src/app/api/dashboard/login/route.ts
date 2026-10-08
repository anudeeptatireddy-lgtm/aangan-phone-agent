import { handleDashboardLogin } from "@/server/handlers/dashboard";
import { getDeps } from "@/server/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Production password screen: form POST with `password`. Outside production there is no login and this just redirects to the dashboard. */
export const POST = (req: Request) => handleDashboardLogin(req, getDeps());
