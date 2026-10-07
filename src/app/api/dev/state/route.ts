import { getDeps } from "@/server/deps";

// Local-only window into what the post-call pipeline produced (flags, outbox, alerts sent). No phones or emails. 404 in production.
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const deps = getDeps();
  if (req.headers.get("authorization") !== `Bearer ${deps.env.TOOL_SHARED_SECRET}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("call");
  return Response.json({
    outbox: [...(deps.postcall as import("@/server/postcall-repo").InMemoryPostCallRepo).outbox.values()].map((o) => ({ kind: o.kind, status: o.status, dedupeKey: o.dedupeKey })),
    alertsSent: deps.fakeNotifier!.alerts,
    ...(id ? { call: await deps.postcall.getCall(id).then((c) => c && { outcome: c.outcome, intent: c.intent, status: c.postCallStatus, disclosureOk: c.disclosureOk, afterHours: c.afterHours, costAiInr: c.costAiInr }), flags: await deps.postcall.listFlags(id) } : {}),
  });
}
