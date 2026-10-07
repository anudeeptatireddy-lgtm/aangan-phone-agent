import { DEFAULT_HOURS, HoursConfig, isWorkingTime, nextOpening } from "./hours";

export type EscalationReason = "complaint" | "review" | "human_requested";
export type EscalationMode = "live_transfer" | "callback_promised" | "queued_review";

export interface EscalationPlan {
  reason: EscalationReason;
  mode: EscalationMode;
  callbackDueAt: string | null; // ISO
  alertNikhil: boolean;
  /** Key into approved caller-facing scripts (wording is Nikhil's to approve). */
  callerScript: "transfer_now" | "senior_callback_by_10am" | "expect_call_in_working_hours" | "callback_by_10am";
}

export function planEscalation(reason: EscalationReason, now: Date, cfg: HoursConfig = DEFAULT_HOURS): EscalationPlan {
  const open = isWorkingTime(now, cfg);

  if (reason === "review") {
    // Unclear cases go to the front-desk queue; the caller is told to expect a call in working hours.
    return { reason, mode: "queued_review", callbackDueAt: open ? null : nextOpening(now, cfg).toISOString(),
      alertNikhil: false, callerScript: "expect_call_in_working_hours" };
  }
  if (open) {
    return { reason, mode: "live_transfer", callbackDueAt: null, alertNikhil: false, callerScript: "transfer_now" };
  }
  const due = nextOpening(now, cfg).toISOString();
  return reason === "complaint"
    ? { reason, mode: "callback_promised", callbackDueAt: due, alertNikhil: true, callerScript: "senior_callback_by_10am" }
    : { reason, mode: "callback_promised", callbackDueAt: due, alertNikhil: false, callerScript: "callback_by_10am" };
}
