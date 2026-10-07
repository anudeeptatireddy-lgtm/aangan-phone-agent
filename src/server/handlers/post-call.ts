import { z } from "zod";
import { log } from "@/lib/log";
import type { Deps } from "../deps";
import { authorized } from "./tools";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CallBody = z.object({
  vendor: z.string().min(1),
  vendorCallId: z.string().min(1),
  callerPhone: z.string().optional(),
  rangAt: z.string().optional(),
  answeredAt: z.string().optional(),
  endedAt: z.string(),
  durationS: z.number().optional(),
  endedReason: z.string().optional(),
  transcript: z.array(z.object({ speaker: z.enum(["agent", "caller"]), text: z.string(), atMs: z.number().optional() })),
  recordingRef: z.string().optional(),
  language: z.string().optional(),
});

/** Runs the post-call pipeline for one finished call (vendor-neutral record). */
export async function handleProcessCall(req: Request, deps: Deps): Promise<Response> {
  if (!authorized(req, deps.env.TOOL_SHARED_SECRET)) return json(401, { error: "unauthorized" });
  const p = CallBody.safeParse(await req.json().catch(() => null));
  if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
  if (!deps.pipeline) return json(503, { error: "extractor_not_configured" });
  const r = await deps.pipeline.process(p.data);
  log("info", "post_call", { vendor_call_id: r.vendorCallId, status: r.status, outcome: r.outcome, flags: r.flags });
  return json(200, r); // a summary only: no transcript, no phone, no email
}

/** Delivers pending alert items (owner / Nikhil). Called by a scheduler in production (Session 5). */
export async function handleDrainOutbox(req: Request, deps: Deps): Promise<Response> {
  if (!authorized(req, deps.env.TOOL_SHARED_SECRET)) return json(401, { error: "unauthorized" });
  return json(200, await deps.alerts.drain());
}
