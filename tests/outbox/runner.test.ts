import { describe, it, expect } from "vitest";
import { InMemoryPostCallRepo } from "@/server/postcall-repo";
import { InMemoryBookingRepo } from "@/server/booking-repo";
import { FakeNotifier } from "@/adapters/notify/fake";
import { FakeCrm } from "@/adapters/crm/fake";
import { FakeEmail } from "@/adapters/email/fake";
import { OutboxRunner } from "@/core/outbox/runner";
import { buildConfirmationEmail } from "@/core/outbox/confirmation-email";
import { designer } from "../booking/helpers";
import { liveEnquiry, book, NOW } from "../postcall/pipeline.helpers";

async function withNote(repo: InMemoryPostCallRepo, id: string, designerNote: string) {
  const e = (await repo.getEnquiry(id))!;
  await repo.upsertEnquiry({ id: e.id, callerId: e.callerId, input: e.input, fit: e.fit, reasonCodes: e.reasonCodes, flags: e.flags, ruleVersion: e.ruleVersion, designerNote });
}

async function setup() {
  const repo = new InMemoryPostCallRepo("pepper-0123456789ab");
  const bookings = new InMemoryBookingRepo([designer("A", "Aarav", { isPrincipal: true }), designer("B", "B")]);
  const notifier = new FakeNotifier(), crm = new FakeCrm(), email = new FakeEmail();
  const runner = new OutboxRunner({ repo, bookings, notifier, crm, email, now: () => NOW });
  const enq = await liveEnquiry(repo, "vc-1", { id: "11111111-1111-4111-8111-111111111111" });
  await repo.updateCaller(enq.callerId!, { name: "Priya Shah", email: "priya@example.com" });
  const booking = await book(bookings, enq.id);
  return { repo, bookings, notifier, crm, email, runner, enq, booking };
}

describe("hubspot_deal", () => {
  it("creates the contact and a deal (no amount), records the link, marks processed", async () => {
    const t = await setup();
    await withNote(t.repo, t.enq.id, "NEW CONSULTATION · Qualified\nPriya · Kothrud");
    await t.repo.enqueue("hubspot_deal", { enquiryId: t.enq.id, vendorCallId: "vc-1", bookingId: t.booking.id }, `hubspot_deal:${t.enq.id}`);
    expect(await t.runner.run()).toMatchObject({ processed: 1, failed: 0 });
    expect(t.crm.deals).toHaveLength(1);
    expect(t.crm.deals[0]!.description).toContain("NEW CONSULTATION");
    expect(t.crm.deals[0]!.name).toMatch(/Priya Shah/);
    expect([...t.crm.contacts.values()][0]).toMatchObject({ email: "priya@example.com", phone: "+919000000021", firstName: "Priya", lastName: "Shah" });
    expect(await t.repo.getCrmLink(t.enq.id)).toMatchObject({ dealId: t.crm.deals[0]!.id });
  });
  it("the deal description never contains the phone number or email", async () => {
    const t = await setup();
    await t.repo.enqueue("hubspot_deal", { enquiryId: t.enq.id, vendorCallId: "vc-1", bookingId: null }, "k1");
    await t.runner.run();
    const d = t.crm.deals[0]!;
    expect(`${d.name} ${d.description}`).not.toMatch(/9000000021|priya@example\.com/);
  });
  it("a retry after the CRM already has the deal does not create a second one", async () => {
    const t = await setup();
    await t.repo.saveCrmLink(t.enq.id, { contactId: "c", dealId: "d" });
    await t.repo.enqueue("hubspot_deal", { enquiryId: t.enq.id, vendorCallId: "vc-1", bookingId: null }, "k1");
    await t.runner.run();
    expect(t.crm.deals).toHaveLength(0);
    expect(await t.repo.pendingOutbox(["hubspot_deal"], 10)).toHaveLength(0);
  });
  it("a CRM failure leaves it pending for a retry; the fifth failure marks it failed and alerts the owner", async () => {
    const t = await setup();
    await t.repo.enqueue("hubspot_deal", { enquiryId: t.enq.id, vendorCallId: "vc-1", bookingId: null }, "k1");
    for (let i = 0; i < 4; i++) { t.crm.failNext(); expect(await t.runner.run()).toMatchObject({ failed: 1 }); }
    expect(await t.repo.pendingOutbox(["hubspot_deal"], 10)).toHaveLength(1);
    t.crm.failNext();
    await t.runner.run();
    expect(await t.repo.pendingOutbox(["hubspot_deal"], 10)).toHaveLength(0);
    const alerts = await t.repo.pendingOutbox(["owner_alert"], 10);
    expect(alerts).toHaveLength(1);
    expect(JSON.stringify(alerts[0]!.payload)).toMatch(/hubspot_deal/);
  });
});

describe("confirmation_email", () => {
  it("sends the caller a confirmation with the outbox key as idempotency key", async () => {
    const t = await setup();
    await t.repo.enqueue("confirmation_email", { bookingId: t.booking.id, enquiryId: t.enq.id, email: "priya@example.com", name: "Priya Shah", startsAt: t.booking.startsAt.toISOString() }, `confirmation_email:${t.booking.id}`);
    await t.runner.run();
    expect(t.email.sent).toHaveLength(1);
    expect(t.email.sent[0]).toMatchObject({ to: "priya@example.com", idempotencyKey: `confirmation_email:${t.booking.id}` });
    expect(t.email.sent[0]!.subject).toMatch(/Thursday 8 October, 11:00 am/);
  });
  it("is not sent for a booking that has since been cancelled", async () => {
    const t = await setup();
    await t.bookings.cancel(t.booking.id);
    await t.repo.enqueue("confirmation_email", { bookingId: t.booking.id, enquiryId: t.enq.id, email: "priya@example.com", name: null, startsAt: t.booking.startsAt.toISOString() }, "k");
    await t.runner.run();
    expect(t.email.sent).toHaveLength(0);
    expect(await t.repo.pendingOutbox(["confirmation_email"], 10)).toHaveLength(0);
  });
  it("a send failure stays pending and the retry sends once", async () => {
    const t = await setup();
    await t.repo.enqueue("confirmation_email", { bookingId: t.booking.id, enquiryId: t.enq.id, email: "priya@example.com", name: null, startsAt: t.booking.startsAt.toISOString() }, "k");
    t.email.failNext();
    await t.runner.run();
    await t.runner.run();
    expect(t.email.sent).toHaveLength(1);
  });
  it("the email says nothing about price and promises no discount or quote", () => {
    const m = buildConfirmationEmail({ name: "Priya", startsAt: new Date("2026-10-08T05:30:00Z") });
    const all = `${m.subject}\n${m.text}`;
    expect(all).not.toMatch(/₹|\brs\.?\b|lakh|\bcrore\b|per\s*sq|\bquote\b|\bprice\b|\bcost\b|\bbudget\b|discount/i);
    expect(m.text).toContain("Thursday 8 October, 11:00 am");
    expect(m.text).toMatch(/Hello Priya/);
  });
});

describe("designer_note_update", () => {
  it("edits the designer's Telegram note to the post-call version, keeping the buttons while still unanswered", async () => {
    const t = await setup();
    const h = await t.bookings.createHandoff({ bookingId: t.booking.id, designerId: "A", dueAt: new Date(NOW.getTime() + 1800_000) });
    await t.bookings.markHandoffSent(h.id, 4242, NOW);
    await withNote(t.repo, t.enq.id, "NEW CONSULTATION\nSummary: 3BHK");
    await t.repo.enqueue("designer_note_update", { enquiryId: t.enq.id, bookingId: t.booking.id }, "k");
    await t.runner.run();
    expect(t.notifier.edits).toHaveLength(1);
    expect(t.notifier.edits[0]).toMatchObject({ chatId: 100 + "A".charCodeAt(0), messageId: 4242 });
    expect(t.notifier.edits[0]!.text).toContain("Summary: 3BHK");
    expect(t.notifier.edits[0]!.buttons?.map((b) => b.data)).toEqual([`h:${h.id}:a`, `h:${h.id}:d`]);
  });
  it("after Accept the note is updated without buttons and keeps the accepted marker", async () => {
    const t = await setup();
    const h = await t.bookings.createHandoff({ bookingId: t.booking.id, designerId: "A", dueAt: new Date(NOW.getTime() + 1800_000) });
    await t.bookings.markHandoffSent(h.id, 4242, NOW);
    await t.bookings.transitionHandoff(h.id, ["sent"], "accepted", NOW);
    await withNote(t.repo, t.enq.id, "NEW CONSULTATION\nSummary: 3BHK");
    await t.repo.enqueue("designer_note_update", { enquiryId: t.enq.id, bookingId: t.booking.id }, "k");
    await t.runner.run();
    expect(t.notifier.edits[0]!.text).toMatch(/^✅ Accepted/);
    expect(t.notifier.edits[0]!.buttons).toBeUndefined();
  });
  it("nothing to edit yet (note not sent): processed without error", async () => {
    const t = await setup();
    await t.repo.enqueue("designer_note_update", { enquiryId: t.enq.id, bookingId: t.booking.id }, "k");
    expect(await t.runner.run()).toMatchObject({ processed: 1, failed: 0 });
    expect(t.notifier.edits).toHaveLength(0);
  });
});

describe("the runner ignores alert kinds (the AlertDrainer owns those)", () => {
  it("leaves owner alerts alone", async () => {
    const t = await setup();
    await t.repo.enqueue("owner_alert", { flag: "other", vendorCallId: "x" }, "a1");
    expect(await t.runner.run()).toMatchObject({ processed: 0, failed: 0 });
    expect(await t.repo.pendingOutbox(["owner_alert"], 10)).toHaveLength(1);
  });
});
