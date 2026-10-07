import { describe, it, expect } from "vitest";
import { planEscalation } from "@/core/escalation";

const ist = (iso: string) => new Date(`${iso}+05:30`);

describe("planEscalation", () => {
  it("complaint in working hours -> live transfer, no callback", () => {
    const p = planEscalation("complaint", ist("2026-10-07T11:32:00"));
    expect(p.mode).toBe("live_transfer");
    expect(p.callbackDueAt).toBeNull();
    expect(p.alertNikhil).toBe(false);
  });
  it("complaint after hours -> senior callback by 10am next working day + alert Nikhil", () => {
    const p = planEscalation("complaint", ist("2026-10-07T22:10:00"));
    expect(p.mode).toBe("callback_promised");
    expect(p.callbackDueAt).toBe(ist("2026-10-08T10:00:00").toISOString());
    expect(p.alertNikhil).toBe(true);
  });
  it("complaint on Friday night -> Monday 10am", () => {
    const p = planEscalation("complaint", ist("2026-10-09T21:00:00"));
    expect(p.callbackDueAt).toBe(ist("2026-10-12T10:00:00").toISOString());
  });
  it("review is always queued for a human callback in working hours (never live)", () => {
    const inHours = planEscalation("review", ist("2026-10-07T12:00:00"));
    expect(inHours.mode).toBe("queued_review");
    expect(inHours.alertNikhil).toBe(false);
    const after = planEscalation("review", ist("2026-10-07T22:00:00"));
    expect(after.mode).toBe("queued_review");
    expect(after.callbackDueAt).toBe(ist("2026-10-08T10:00:00").toISOString());
  });
  it("human_requested: live in hours, callback after hours, no Nikhil alert", () => {
    expect(planEscalation("human_requested", ist("2026-10-07T12:00:00")).mode).toBe("live_transfer");
    const a = planEscalation("human_requested", ist("2026-10-07T22:00:00"));
    expect(a.mode).toBe("callback_promised");
    expect(a.alertNikhil).toBe(false);
  });
  it("complaint live transfer goes to the design lead; 'human_requested' to the front desk", () => {
    expect(planEscalation("complaint", ist("2026-10-07T12:00:00")).transferTo).toBe("design_lead");
    expect(planEscalation("human_requested", ist("2026-10-07T12:00:00")).transferTo).toBe("front_desk");
  });
  it("transfer failure in hours falls back to the after-hours callback (and alerts Nikhil for complaints)", () => {
    const p = planEscalation("complaint", ist("2026-10-07T12:00:00"), undefined, { transferFailed: true });
    expect(p).toMatchObject({ mode: "callback_promised", alertNikhil: true, callerScript: "complaint_after_hours" });
    expect(p.callbackDueAt).toBe(ist("2026-10-08T10:00:00").toISOString());
    expect(p.callbackWhen).toEqual({ when: "day", day: "Thursday" });
  });
  it("before opening the callback is 'today' at 10:00", () => {
    const p = planEscalation("complaint", ist("2026-10-07T08:00:00"));
    expect(p.callbackDueAt).toBe(ist("2026-10-07T10:00:00").toISOString());
    expect(p.callbackWhen).toEqual({ when: "today" });
  });
});
