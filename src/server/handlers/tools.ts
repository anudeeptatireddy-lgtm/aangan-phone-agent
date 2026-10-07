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

export function authorized(req: Request, secret: string): boolean {
  const h = req.headers.get("authorization") ?? "";
  const given = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

const LookupBody = z.object({
  phone: z.string().default(""),
  intent: z.enum(["new_enquiry", "existing_client", "complaint", "other", "unknown"]).optional(),
  first_utterance: z.string().optional(),
  call_id: z.string().optional(),   // the voice vendor's call id: lets the post-call pipeline find what the live tools did
});
const LanguageBody = z.object({ language: z.enum(["en", "hi", "mr"]).default("en") });
const EnquiryExtras = z.object({
  enquiry_id: z.string().optional(),
  caller_name: z.string().max(120).optional(),
  caller_email: z.string().email().optional(),
  phone: z.string().optional(),
  call_id: z.string().optional(),
});
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const GetSlotsBody = z.object({
  enquiry_id: z.string(), wants_principal: z.boolean().optional(), count: z.number().int().min(1).max(6).optional(),
  earliest_date: ymd.optional(), on_date: ymd.optional(), after_time: hhmm.optional(), before_time: hhmm.optional(),
  weekday_only: z.boolean().optional(), weekend_only: z.boolean().optional(),
});
const BookSlotBody = z.object({
  enquiry_id: z.string(), start: z.string(), caller_name: z.string().max(120).optional(), caller_email: z.string().email().optional(),
  wants_principal: z.boolean().optional(), idempotency_key: z.string().max(200).optional(),
});
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
      if (p.data.call_id) {
        const e164 = normalizeE164(p.data.phone);
        const caller = e164 ? await deps.postcall.upsertCaller({ phone: e164 }) : null;
        await deps.postcall.upsertCall(p.data.call_id, caller ? { callerId: caller.id } : {});
      }
      log("info", "lookup_caller", { phone: p.data.phone, route: decision.route, reason: decision.reason });
      return json(200, { ...result, recommended_route: decision.route, route_reason: decision.reason });
    }
    case "check_fit": {
      const p = CheckFitInput.safeParse(body);
      if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
      const lang = (LanguageBody.safeParse(body).data?.language ?? "en") as Locale;
      const extras = EnquiryExtras.safeParse(body);
      if (!extras.success) return json(400, { error: "invalid_body", issues: extras.error.issues.map((i) => i.path.join(".")) });
      const out = checkFit(p.data, now, RULES_V1); // budget_inr is consumed here, never echoed
      const parsedInput = CheckFitInput.parse(body);
      const e164 = extras.data.phone ? normalizeE164(extras.data.phone) : null;
      const callerId = e164 ? (await deps.repo.findCallerByPhone(e164))?.id : undefined;
      const fields = { input: parsedInput, fit: out.result, reasonCodes: out.reason_codes, nextAction: out.next_action, flags: out.flags, ruleVersion: out.rule_version,
        ...(extras.data.caller_name ? { callerName: extras.data.caller_name } : {}), ...(extras.data.caller_email ? { callerEmail: extras.data.caller_email } : {}),
        ...(callerId ? { callerId } : {}) };
      let enquiryId = extras.data.enquiry_id;
      if (enquiryId) { if (!deps.enquiries.update(enquiryId, fields)) return json(404, { error: "enquiry_not_found" }); }
      else enquiryId = deps.enquiries.create({ ...fields, language: LanguageBody.safeParse(body).data?.language, createdAt: now.toISOString() }).id;
      if (extras.data.call_id) {
        // Mirror into the persisted store (same enquiry id) and record the LIVE evaluation, so the post-call run can audit it.
        const pc = await deps.postcall.getCall(extras.data.call_id);
        let pcCaller = pc?.callerId ?? null;
        if (!pcCaller && e164) pcCaller = (await deps.postcall.upsertCaller({ phone: e164 })).id;
        await deps.postcall.upsertEnquiry({ id: enquiryId, callerId: pcCaller, input: parsedInput, fit: out.result, reasonCodes: out.reason_codes, missingFields: out.missing_fields,
          nextAction: out.next_action, flags: out.flags, ruleVersion: out.rule_version, language: LanguageBody.safeParse(body).data?.language });
        await deps.postcall.upsertCall(extras.data.call_id, { enquiryId, ...(pcCaller ? { callerId: pcCaller } : {}) });
        await deps.postcall.recordEvaluation({ vendorCallId: extras.data.call_id, enquiryId, phase: "live", input: parsedInput, fit: out.result, reasonCodes: out.reason_codes, ruleVersion: out.rule_version, callDate: now });
      }
      const caller_messages = out.script_keys.map((key) => ({ key, text: renderScript(key, lang), status: SCRIPTS[key as ScriptKey][lang].status }));
      log("info", "check_fit", { result: out.result, action: out.next_action, reasons: out.reason_codes, version: out.rule_version });
      return json(200, { ...out, caller_messages, enquiry_id: enquiryId });
    }
    case "get_slots": {
      const p = GetSlotsBody.safeParse(body);
      if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
      const enquiry = deps.enquiries.get(p.data.enquiry_id);
      if (!enquiry) return json(404, { error: "enquiry_not_found" });
      const r = await deps.booking.getSlots({ enquiry, wantsPrincipal: p.data.wants_principal, count: p.data.count,
        prefs: { earliestDate: p.data.earliest_date, onDate: p.data.on_date, afterTime: p.data.after_time, beforeTime: p.data.before_time,
          weekdayOnly: p.data.weekday_only, weekendOnly: p.data.weekend_only } });
      log("info", "get_slots", { ok: r.ok, offered: r.slots.length, next: r.next_action });
      return json(200, r);
    }
    case "book_slot": {
      const p = BookSlotBody.safeParse(body);
      if (!p.success) return json(400, { error: "invalid_body", issues: p.error.issues.map((i) => i.path.join(".")) });
      const enquiry = deps.enquiries.get(p.data.enquiry_id);
      if (!enquiry) return json(404, { error: "enquiry_not_found" });
      const r = await deps.booking.bookSlot({ enquiry, start: p.data.start, callerEmail: p.data.caller_email, callerName: p.data.caller_name,
        wantsPrincipal: p.data.wants_principal, idempotencyKey: p.data.idempotency_key });
      log(r.ok ? "info" : "warn", "book_slot", r.ok ? { booking_id: r.booking_id, handoff_sent: r.handoff_sent, replayed: r.replayed } : { error: r.error });
      return json(200, r);
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
      if (p.data.call_id) {
        await deps.postcall.upsertCall(p.data.call_id, {});
        await deps.postcall.recordEscalation(p.data.call_id, { reason: plan.reason, mode: plan.mode, callbackDueAt: plan.callbackDueAt ? new Date(plan.callbackDueAt) : null,
          slaMinutes: plan.slaMinutes ?? null, queue: plan.queue ?? null, queueEscalatesTo: plan.queueEscalatesTo ?? null });
      }
      log("warn", "request_human", { reason: plan.reason, mode: plan.mode, escalation_id: rec.id });
      return json(200, { escalation_id: rec.id, mode: plan.mode, transfer_target: plan.transferTo, callback_due_at: plan.callbackDueAt,
        sla_minutes: plan.slaMinutes ?? null, alert_design_lead_now: plan.alertDesignLeadNow ?? false,
        alert_nikhil_if_unacked_min: plan.alertNikhilIfUnackedMin ?? null, queue: plan.queue ?? null, queue_escalates_to: plan.queueEscalatesTo ?? null,
        caller_script: plan.callerScript, caller_message: renderScript(plan.callerScript, lang, plan.callbackWhen),
        caller_message_status: SCRIPTS[plan.callerScript][lang].status, nikhil_alert_pending: plan.alertNikhil });
    }
  }
}
