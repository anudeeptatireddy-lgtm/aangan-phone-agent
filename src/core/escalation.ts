import { DEFAULT_HOURS, HoursConfig, isWorkingTime, istDate, istWeekdayName, minutesLeftToday, nextOpening } from "./hours";

export type EscalationReason = "complaint" | "review" | "human_requested";
export type EscalationMode = "live_transfer" | "callback_sla" | "callback_promised" | "queued_review" | "offer_choice";
export type CallerScriptKey =
  | "complaint_in_hours" | "complaint_transfer_failed" | "complaint_after_hours" | "expect_call"
  | "human_requested_in_hours" | "human_requested_transfer_failed" | "human_requested_after_hours";

export interface CallbackWhen { when: "today" | "day"; day?: string }

export interface EscalationPlan {
  reason: EscalationReason;
  mode: EscalationMode;
  callbackDueAt: string | null; // ISO
  alertNikhil: boolean;
  /** Who a live transfer goes to (resolved to a number from env by the caller). */
  transferTo: "design_lead" | "front_desk" | null;
  /** Key into the approved caller-facing scripts (src/core/scripts.ts). */
  callerScript: CallerScriptKey;
  /** For rendering "{when}" in the script: today, or a weekday name in English. */
  callbackWhen: CallbackWhen;
  // Failed live transfer inside working hours: a short SLA that starts at the failure (owner decision, round 2).
  slaMinutes?: number;
  alertDesignLeadNow?: boolean;
  alertNikhilIfUnackedMin?: number;
  queue?: "front_desk";
  queueEscalatesTo?: "design_lead";
}

export interface PlanOptions { transferFailed?: boolean }

export const COMPLAINT_SLA_MIN = 15;
export const FRONT_DESK_SLA_MIN = 30;
export const NIKHIL_ALERT_AFTER_MIN = 10;

export function callbackWhen(due: Date | null, now: Date): CallbackWhen {
  return !due || istDate(due) === istDate(now) ? { when: "today" } : { when: "day", day: istWeekdayName(due) };
}

export function planEscalation(reason: EscalationReason, now: Date, cfg: HoursConfig = DEFAULT_HOURS, opts: PlanOptions = {}): EscalationPlan {
  if (reason === "review") {
    // Unclear cases go to the front-desk queue; the caller is told to expect a call in working hours.
    const due = isWorkingTime(now, cfg) ? null : nextOpening(now, cfg);
    return { reason, mode: "queued_review", callbackDueAt: due?.toISOString() ?? null, alertNikhil: false, transferTo: null,
      callerScript: "expect_call", callbackWhen: callbackWhen(due, now) };
  }

  const open = isWorkingTime(now, cfg);
  const left = minutesLeftToday(now, cfg);

  if (open && !opts.transferFailed) {
    return { reason, mode: "live_transfer", callbackDueAt: null, alertNikhil: false,
      transferTo: reason === "complaint" ? "design_lead" : "front_desk",
      callerScript: reason === "complaint" ? "complaint_in_hours" : "human_requested_in_hours", callbackWhen: { when: "today" } };
  }

  if (open && opts.transferFailed) {
    // The SLA clock starts at the failed transfer, but only if there is enough of the working day left to honour it.
    if (reason === "complaint" && left >= COMPLAINT_SLA_MIN) {
      return { reason, mode: "callback_sla", callbackDueAt: new Date(now.getTime() + COMPLAINT_SLA_MIN * 60_000).toISOString(),
        alertNikhil: false, transferTo: null, callerScript: "complaint_transfer_failed", callbackWhen: { when: "today" },
        slaMinutes: COMPLAINT_SLA_MIN, alertDesignLeadNow: true, alertNikhilIfUnackedMin: NIKHIL_ALERT_AFTER_MIN };
    }
    if (reason === "human_requested" && left >= FRONT_DESK_SLA_MIN) {
      return { reason, mode: "callback_sla", callbackDueAt: new Date(now.getTime() + FRONT_DESK_SLA_MIN * 60_000).toISOString(),
        alertNikhil: false, transferTo: null, callerScript: "human_requested_transfer_failed", callbackWhen: { when: "today" },
        slaMinutes: FRONT_DESK_SLA_MIN, queue: "front_desk", queueEscalatesTo: "design_lead" };
    }
  }

  // After hours, or too little of the day left to honour the SLA: next-working-day handling.
  const due = nextOpening(now, cfg);
  return reason === "complaint"
    ? { reason, mode: "callback_promised", callbackDueAt: due.toISOString(), alertNikhil: true, transferTo: null,
        callerScript: "complaint_after_hours", callbackWhen: callbackWhen(due, now) }
    : { reason, mode: "offer_choice", callbackDueAt: due.toISOString(), alertNikhil: false, transferTo: null,
        callerScript: "human_requested_after_hours", callbackWhen: callbackWhen(due, now) };
}
