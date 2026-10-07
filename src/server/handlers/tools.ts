import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { log } from "@/lib/log";
import { normalizeE164 } from "@/lib/phone";
import { lookupCaller } from "@/core/lookup";
import { routeCall } from "@/core/routing/route-call";
import { callbackWhen, planEscalation } from "@/core/escalation";
import { nextOpening } from "@/core/hours";
import { resolveFestival } from "@/core/festivals";
import { checkFit, CheckFitInput } from "@/core/rules/engine";
import { RULES_V1 } from "@/core/rules/config.v1";
import { Locale, renderScript, SCRIPTS, ScriptKey } from "@/core/scripts";
import type { Deps } from "../deps";

export type ToolName = "lookup_caller" | "check_fit" | "get_slots" | "book_slot" | "request_human" | "resolve_date";

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
const ResolveDateBody = z.object({ text: z.string().min(1), language: z.enum(["en", "hi", "mr"]).default("en") });
const RequestHumanBody = z.object({
  transfer_failed: z.boolean().optional(),
  /** Second call after an after-hours "I want a person" offer: take details for a callback, or carry on and book. */
  escalation_id: z.string().optional(),
  choice: z.enum(["callback", "book"]).optional(),
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
    case "resolve_date": {
      const p = ResolveDateBody.safeParse(body);
      if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
      const r = resolveFestival(p.data.text, now, p.data.language);
      if (!r.resolved)
        return json(200, { resolved: false, reason: r.reason, instruction: "Ask the caller for a calendar date. Never use a distance or date they state for a festival or event." });
      return json(200, { resolved: true, key: r.key, date: r.date, days_from_now: r.days_from_now, readback: r.readback, readback_status: r.readback_status,
        instruction: "Read the readback to the caller. If they confirm, call check_fit with deadline_date set to this date." });
    }
    case "request_human": {
      const p = RequestHumanBody.safeParse(body);
      if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
      const lang = p.data.language as Locale;

      // Second step of the after-hours "I want a person" offer.
      if (p.data.escalation_id && p.data.choice) {
        const rec = deps.repo.getEscalation(p.data.escalation_id);
        if (!rec) return json(404, { error: "escalation_not_found" });
        if (p.data.choice === "book") {
          deps.repo.updateEscalation(rec.id, { mode: "continue_booking" });
          return json(200, { escalation_id: rec.id, mode: "continue_booking", next: "continue_qualifying" });
        }
        const due = nextOpening(now, deps.hours);
        deps.repo.updateEscalation(rec.id, { mode: "callback_promised", callbackDueAt: due.toISOString() });
        return json(200, { escalation_id: rec.id, mode: "callback_promised", callback_due_at: due.toISOString(), caller_script: "expect_call",
          caller_message: renderScript("expect_call", lang, callbackWhen(due, now)), caller_message_status: SCRIPTS.expect_call[lang].status, nikhil_alert_pending: false });
      }

      // A live transfer needs a configured target; without one we must not pretend to transfer (treat as a failed transfer).
      const wantsTransfer = planEscalation(p.data.reason, now, deps.hours).mode === "live_transfer";
      const target = p.data.reason === "complaint" ? (deps.env.DESIGN_LEAD_NUMBER ? "design_lead" : deps.env.FRONT_DESK_NUMBER ? "front_desk" : null)
        : deps.env.FRONT_DESK_NUMBER ? "front_desk" : null;
      const transferFailed = !!p.data.transfer_failed || (wantsTransfer && !target);
      const plan = planEscalation(p.data.reason, now, deps.hours, { transferFailed });
      if (plan.transferTo && target) plan.transferTo = target;
      const e164 = p.data.phone ? normalizeE164(p.data.phone) : null;
      const caller = e164 ? await deps.repo.findCallerByPhone(e164) : undefined;
      const rec = deps.repo.addEscalation({ callerId: caller?.id, reason: plan.reason, mode: plan.mode,
        callbackDueAt: plan.callbackDueAt, alertNikhil: plan.alertNikhil, summary: p.data.summary, createdAt: now.toISOString(),
        slaMinutes: plan.slaMinutes, queue: plan.queue, queueEscalatesTo: plan.queueEscalatesTo,
        alertDesignLeadNow: plan.alertDesignLeadNow, alertNikhilIfUnackedMin: plan.alertNikhilIfUnackedMin });
      log("warn", "request_human", { reason: plan.reason, mode: plan.mode, escalation_id: rec.id });
      return json(200, { escalation_id: rec.id, mode: plan.mode, transfer_target: plan.transferTo, callback_due_at: plan.callbackDueAt,
        sla_minutes: plan.slaMinutes ?? null, alert_design_lead_now: plan.alertDesignLeadNow ?? false,
        alert_nikhil_if_unacked_min: plan.alertNikhilIfUnackedMin ?? null, queue: plan.queue ?? null, queue_escalates_to: plan.queueEscalatesTo ?? null,
        caller_script: plan.callerScript, caller_message: renderScript(plan.callerScript, lang, plan.callbackWhen),
        caller_message_status: SCRIPTS[plan.callerScript][lang].status, nikhil_alert_pending: plan.alertNikhil });
    }
  }
}
