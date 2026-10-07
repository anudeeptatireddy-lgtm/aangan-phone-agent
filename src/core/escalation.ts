import { DEFAULT_HOURS, HoursConfig, isWorkingTime, istDate, istWeekdayName, nextOpening } from "./hours";

export type EscalationReason = "complaint" | "review" | "human_requested";
export type EscalationMode = "live_transfer" | "callback_promised" | "queued_review";
export type CallerScriptKey =
  | "complaint_in_hours" | "complaint_after_hours" | "expect_call" | "human_requested_in_hours" | "human_requested_after_hours";

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
  callbackWhen: { when: "today" | "day"; day?: string };
}

export interface PlanOptions { transferFailed?: boolean }

export function planEscalation(reason: EscalationReason, now: Date, cfg: HoursConfig = DEFAULT_HOURS, opts: PlanOptions = {}): EscalationPlan {
  const open = isWorkingTime(now, cfg);
  const whenFor = (due: Date | null): EscalationPlan["callbackWhen"] =>
    !due || istDate(due) === istDate(now) ? { when: "today" } : { when: "day", day: istWeekdayName(due) };

  if (reason === "review") {
    // Unclear cases go to the front-desk queue; the caller is told to expect a call in working hours.
    const due = open ? null : nextOpening(now, cfg);
    return { reason, mode: "queued_review", callbackDueAt: due?.toISOString() ?? null, alertNikhil: false, transferTo: null,
      callerScript: "expect_call", callbackWhen: whenFor(due) };
  }

  const canTransfer = open && !opts.transferFailed;
  if (canTransfer) {
    return { reason, mode: "live_transfer", callbackDueAt: null, alertNikhil: false,
      transferTo: reason === "complaint" ? "design_lead" : "front_desk",
      callerScript: reason === "complaint" ? "complaint_in_hours" : "human_requested_in_hours", callbackWhen: { when: "today" } };
  }
  // After hours, or the transfer failed: promise a callback by 10am on the next working day.
  const due = nextOpening(now, cfg);
  return reason === "complaint"
    ? { reason, mode: "callback_promised", callbackDueAt: due.toISOString(), alertNikhil: true, transferTo: null,
        callerScript: "complaint_after_hours", callbackWhen: whenFor(due) }
    : { reason, mode: "callback_promised", callbackDueAt: due.toISOString(), alertNikhil: false, transferTo: null,
        callerScript: "human_requested_after_hours", callbackWhen: whenFor(due) };
}
