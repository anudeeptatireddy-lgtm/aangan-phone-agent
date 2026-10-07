import { describe, it, expect } from "vitest";
import { AlertDrainer, designLeadText } from "@/core/postcall/alerts";
import { InMemoryPostCallRepo } from "@/server/postcall-repo";
import { FakeNotifier } from "@/adapters/notify/fake";

const setup = (lead: number | null = 333) => {
  const repo = new InMemoryPostCallRepo("pepper-0123456789ab");
  const notifier = new FakeNotifier();
  return { repo, notifier, drainer: new AlertDrainer({ repo, notifier, ownerChatId: 111, nikhilChatId: 222, designLeadChat: async () => lead }) };
};

describe("design_lead_alert delivery", () => {
  it("goes to the design lead's chat only, never to the owner or Nikhil", async () => {
    const { repo, notifier, drainer } = setup();
    await repo.enqueue("design_lead_alert", { kind: "booking_missing", priority: "urgent", vendorCallId: "vc-9" }, "k1");
    expect(await drainer.drain()).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(notifier.alerts.map((x) => x.chatId)).toEqual([333]);
    expect(await repo.pendingOutbox(["design_lead_alert"], 10)).toHaveLength(0);
  });
  it("waits (is not dropped) while no design lead has a Telegram chat", async () => {
    const { repo, drainer } = setup(null);
    await repo.enqueue("design_lead_alert", { kind: "booking_orphan", priority: "low", bookingUid: "u1" }, "k1");
    expect(await drainer.drain()).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(await repo.pendingOutbox(["design_lead_alert"], 10)).toHaveLength(1);
  });
  it("urgent is unmistakable, low is quiet, and each kind says what to do", () => {
    const urgent = designLeadText({ kind: "booking_missing", priority: "urgent", vendorCallId: "vc-1" });
    expect(urgent).toMatch(/^🚨 URGENT/);
    expect(urgent).toMatch(/told .*booked|believes/i);
    expect(urgent).toMatch(/front.?desk/i);
    expect(designLeadText({ kind: "booking_orphan", priority: "low", bookingUid: "u1" })).toMatch(/^ℹ/);
    const amb = designLeadText({ kind: "booking_ambiguous", priority: "normal", vendorCallId: "vc-2", bookingUids: ["x1", "x2"] });
    expect(amb).toContain("x1"); expect(amb).toContain("x2"); expect(amb).toMatch(/by hand|link/i);
    for (const k of ["booking_not_fit", "booking_no_designer", "booking_no_enquiry", "booking_cancelled", "booking_rescheduled", "complaint_callback"])
      expect(designLeadText({ kind: k, priority: "normal", vendorCallId: "vc-3" }), k).toContain("vc-3");
  });
  it("shows the consultation time in IST and never a phone or email", () => {
    const t = designLeadText({ kind: "booking_no_designer", priority: "urgent", vendorCallId: "vc-4", startsAt: "2026-10-08T05:30:00.000Z", evidence: "call 9876543210 / a@b.com" });
    expect(t).toMatch(/8 Oct/);
    expect(t).toMatch(/11:00/);
    expect(t).not.toMatch(/9876543210|a@b\.com/);
  });
  it("an unknown kind still delivers something readable", () => {
    expect(designLeadText({ kind: "brand_new", priority: "normal", vendorCallId: "vc-5" })).toContain("vc-5");
  });
});
