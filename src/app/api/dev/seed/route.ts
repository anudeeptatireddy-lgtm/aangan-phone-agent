import { z } from "zod";
import { getDeps } from "@/server/deps";

// Local-only helper so the simulator can stage callers/calls. Disabled in production.
const Body = z.object({
  callers: z.array(z.object({
    phone: z.string(), name: z.string().optional(), isExistingClient: z.boolean().optional(),
    calls: z.array(z.object({ minutesAgo: z.number(), endedReason: z.enum(["completed", "dropped"]),
      handoffDelivered: z.boolean().optional(), enquiryId: z.string().optional() })).default([]),
  })),
});

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const deps = getDeps();
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${deps.env.TOOL_SHARED_SECRET}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "invalid_body" }, { status: 400 });
  deps.repo.reset();
  for (const c of p.data.callers) {
    const caller = deps.repo.upsertCaller({ phone: c.phone, name: c.name, isExistingClient: c.isExistingClient });
    for (const call of c.calls)
      deps.repo.addCall({ callerId: caller.id, endedAt: new Date(deps.now().getTime() - call.minutesAgo * 60_000).toISOString(),
        endedReason: call.endedReason, handoffDelivered: call.handoffDelivered, enquiryId: call.enquiryId });
  }
  return Response.json({ ok: true, callers: p.data.callers.length });
}
