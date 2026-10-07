import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { log } from "@/lib/log";
import { normalizeE164 } from "@/lib/phone";
import { lookupCaller } from "@/core/lookup";
import { routeCall } from "@/core/routing/route-call";
import { planEscalation } from "@/core/escalation";
import { checkFit, CheckFitInput } from "@/core/rules/engine";
import { RULES_V1 } from "@/core/rules/config.v1";
import { Locale, renderScript, SCRIPTS, ScriptKey } from "@/core/scripts";
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
const LanguageBody = z.object({ language: z.enum(["en", "hi", "mr"]).default("en") });
const RequestHumanBody = z.object({
  transfer_failed: z.boolean().optional(),
  language: z.enum(["en", "hi", "mr"]).default("en"),
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
      const lang = (LanguageBody.safeParse(body).data?.language ?? "en") as Locale;
      const out = checkFit(p.data, now, RULES_V1); // budget_inr is consumed here, never echoed
      const caller_messages = out.script_keys.map((key) => ({ key, text: renderScript(key, lang), status: SCRIPTS[key as ScriptKey][lang].status }));
      log("info", "check_fit", { result: out.result, action: out.next_action, reasons: out.reason_codes, version: out.rule_version });
      return json(200, { ...out, caller_messages });
    }
    case "request_human": {
      const p = RequestHumanBody.safeParse(body);
      if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
      // A live transfer needs a configured target; without one we must not pretend to transfer (fall back to a callback).
      const wantsTransfer = planEscalation(p.data.reason, now, deps.hours).mode === "live_transfer";
      const target = p.data.reason === "complaint" ? (deps.env.DESIGN_LEAD_NUMBER ? "design_lead" : deps.env.FRONT_DESK_NUMBER ? "front_desk" : null)
        : deps.env.FRONT_DESK_NUMBER ? "front_desk" : null;
      const transferFailed = !!p.data.transfer_failed || (wantsTransfer && !target);
      const plan = planEscalation(p.data.reason, now, deps.hours, { transferFailed });
      if (plan.transferTo && target) plan.transferTo = target;
      const e164 = p.data.phone ? normalizeE164(p.data.phone) : null;
      const caller = e164 ? await deps.repo.findCallerByPhone(e164) : undefined;
      const rec = deps.repo.addEscalation({ callerId: caller?.id, reason: plan.reason, mode: plan.mode,
        callbackDueAt: plan.callbackDueAt, alertNikhil: plan.alertNikhil, summary: p.data.summary, createdAt: now.toISOString() });
      log("warn", "request_human", { reason: plan.reason, mode: plan.mode, escalation_id: rec.id });
      const lang = p.data.language as Locale;
      return json(200, { escalation_id: rec.id, mode: plan.mode, transfer_target: plan.transferTo, callback_due_at: plan.callbackDueAt,
        caller_script: plan.callerScript, caller_message: renderScript(plan.callerScript, lang, plan.callbackWhen),
        caller_message_status: SCRIPTS[plan.callerScript][lang].status, nikhil_alert_pending: plan.alertNikhil });
    }
  }
}
