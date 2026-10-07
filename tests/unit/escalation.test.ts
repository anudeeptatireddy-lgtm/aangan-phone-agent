import { describe, it, expect } from "vitest";
import { planEscalation } from "@/core/escalation";
import { minutesLeftToday } from "@/core/hours";

const ist = (iso: string) => new Date(`${iso}+05:30`);
const at = (t: string) => ist(`2026-10-07T${t}`); // Wednesday

describe("minutesLeftToday", () => {
  it("counts to 19:00 IST in working hours, 0 otherwise", () => {
    expect(minutesLeftToday(at("18:45:00"))).toBe(15);
    expect(minutesLeftToday(at("12:00:00"))).toBe(420);
    expect(minutesLeftToday(at("19:00:00"))).toBe(0);
    expect(minutesLeftToday(ist("2026-10-10T12:00:00"))).toBe(0); // Saturday
  });
});

describe("complaint", () => {
  it("in working hours -> live transfer to the design lead", () => {
    const p = planEscalation("complaint", at("11:32:00"));
    expect(p).toMatchObject({ mode: "live_transfer", transferTo: "design_lead", callbackDueAt: null, alertNikhil: false, callerScript: "complaint_in_hours" });
  });
  it("after hours -> senior callback by 10am next working day + alert Nikhil", () => {
    const p = planEscalation("complaint", at("22:10:00"));
    expect(p).toMatchObject({ mode: "callback_promised", alertNikhil: true, callerScript: "complaint_after_hours" });
    expect(p.callbackDueAt).toBe(ist("2026-10-08T10:00:00").toISOString());
    expect(p.callbackWhen).toEqual({ when: "day", day: "Thursday" });
  });
  it("Friday night -> Monday 10am; before opening -> today 10am", () => {
    expect(planEscalation("complaint", ist("2026-10-09T21:00:00")).callbackDueAt).toBe(ist("2026-10-12T10:00:00").toISOString());
    const early = planEscalation("complaint", at("08:00:00"));
    expect(early.callbackDueAt).toBe(at("10:00:00").toISOString());
    expect(early.callbackWhen).toEqual({ when: "today" });
  });
  it("failed transfer with 15+ minutes of hours left -> 15-minute SLA from the failure, alert design lead now, Nikhil if unacknowledged in 10 min", () => {
    const now = at("12:00:00");
    const p = planEscalation("complaint", now, undefined, { transferFailed: true });
    expect(p).toMatchObject({ mode: "callback_sla", slaMinutes: 15, alertDesignLeadNow: true, alertNikhilIfUnackedMin: 10, alertNikhil: false, callerScript: "complaint_transfer_failed" });
    expect(p.callbackDueAt).toBe(new Date(now.getTime() + 15 * 60_000).toISOString());
  });
  it("failed transfer with exactly 15 minutes left still uses the SLA path; 14 minutes left uses the after-hours script", () => {
    expect(planEscalation("complaint", at("18:45:00"), undefined, { transferFailed: true }).mode).toBe("callback_sla");
    const late = planEscalation("complaint", at("18:46:00"), undefined, { transferFailed: true });
    expect(late).toMatchObject({ mode: "callback_promised", alertNikhil: true, callerScript: "complaint_after_hours" });
    expect(late.callbackDueAt).toBe(ist("2026-10-08T10:00:00").toISOString());
  });
});

describe("review", () => {
  it("queued for a human callback in working hours; never live", () => {
    expect(planEscalation("review", at("12:00:00"))).toMatchObject({ mode: "queued_review", callbackDueAt: null, alertNikhil: false, callerScript: "expect_call" });
    const after = planEscalation("review", at("22:00:00"));
    expect(after.mode).toBe("queued_review");
    expect(after.callbackDueAt).toBe(ist("2026-10-08T10:00:00").toISOString());
  });
});

describe("human_requested ('I want a person')", () => {
  it("in hours -> live transfer to the front desk", () => {
    expect(planEscalation("human_requested", at("12:00:00"))).toMatchObject({ mode: "live_transfer", transferTo: "front_desk", callerScript: "human_requested_in_hours", alertNikhil: false });
  });
  it("transfer fails with 30+ minutes left -> front desk queue item, 30-minute SLA, escalates to the design lead", () => {
    const now = at("12:00:00");
    const p = planEscalation("human_requested", now, undefined, { transferFailed: true });
    expect(p).toMatchObject({ mode: "callback_sla", slaMinutes: 30, queue: "front_desk", queueEscalatesTo: "design_lead", callerScript: "human_requested_transfer_failed", alertNikhil: false });
    expect(p.callbackDueAt).toBe(new Date(now.getTime() + 30 * 60_000).toISOString());
  });
  it("transfer fails with under 30 minutes left -> after-hours choice", () => {
    expect(planEscalation("human_requested", at("18:40:00"), undefined, { transferFailed: true }).mode).toBe("offer_choice");
  });
  it("after hours -> offer the choice (take details for a morning callback, or book now); no Nikhil alert", () => {
    const p = planEscalation("human_requested", at("22:00:00"));
    expect(p).toMatchObject({ mode: "offer_choice", callerScript: "human_requested_after_hours", alertNikhil: false });
    expect(p.callbackDueAt).toBe(ist("2026-10-08T10:00:00").toISOString());
    expect(p.callbackWhen).toEqual({ when: "day", day: "Thursday" });
  });
});
