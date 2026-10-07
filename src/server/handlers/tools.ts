import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { log } from "@/lib/log";
import { normalizeE164 } from "@/lib/phone";
import { lookupCaller } from "@/core/lookup";
import { routeCall } from "@/core/routing/route-call";
import { planEscalation } from "@/core/escalation";
import { checkFit, CheckFitInput } from "@/core/rules/engine";
import type { Deps } from "../deps";

export type ToolName = "lookup_caller" | "check_fit" | "get_slots" | "book_slot" | "request_human";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function authorized(req: Request, secret: string): boolean {
  const h = req.headers.get("authorization") ?? "";
  const given = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

const LookupBody = z.object({
  phone: z.string().default(""),
  intent: z.enum(["new_enquiry", "existing_client", "complaint", "other", "unknown"]).optional(),
  first_utterance: z.string().optional(),
});
const RequestHumanBody = z.object({
  reason: z.enum(["complaint", "review", "human_requested"]),
  phone: z.string().optional(),
  call_id: z.string().optional(),
  summary: z.string().max(1000).optional(),
});

export async function handleTool(tool: ToolName, req: Request, deps: Deps): Promise<Response> {
  if (!authorized(req, deps.env.TOOL_SHARED_SECRET)) return json(401, { error: "unauthorized" });

  // Booking arrives in the next session; never fabricate a slot.
  if (tool === "get_slots" || tool === "book_slot") return json(501, { error: "not_implemented", detail: "booking tools are built in Session 3" });

  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const now = deps.now();

  switch (tool) {
    case "lookup_caller": {
      const p = LookupBody.safeParse(body);
      if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
      const result = await lookupCaller(deps.repo, p.data.phone, now);
      const decision = routeCall({ isExistingClient: result.is_existing_client, intent: p.data.intent,
        utterance: p.data.first_utterance, designerNames: deps.designerNames });
      log("info", "lookup_caller", { phone: p.data.phone, route: decision.route, reason: decision.reason });
      return json(200, { ...result, recommended_route: decision.route, route_reason: decision.reason });
    }
    case "check_fit": {
      const p = CheckFitInput.safeParse(body);
      if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
      const out = checkFit(p.data); // budget_inr is consumed here, never echoed
      log("info", "check_fit", { result: out.result, reasons: out.reason_codes });
      return json(200, out);
    }
    case "request_human": {
      const p = RequestHumanBody.safeParse(body);
      if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
      const plan = planEscalation(p.data.reason, now, deps.hours);
      const e164 = p.data.phone ? normalizeE164(p.data.phone) : null;
      const caller = e164 ? await deps.repo.findCallerByPhone(e164) : undefined;
      const rec = deps.repo.addEscalation({ callerId: caller?.id, reason: plan.reason, mode: plan.mode,
        callbackDueAt: plan.callbackDueAt, alertNikhil: plan.alertNikhil, summary: p.data.summary, createdAt: now.toISOString() });
      log("warn", "request_human", { reason: plan.reason, mode: plan.mode, escalation_id: rec.id });
      return json(200, { escalation_id: rec.id, mode: plan.mode, callback_due_at: plan.callbackDueAt,
        caller_script: plan.callerScript, nikhil_alert_pending: plan.alertNikhil });
    }
  }
}
