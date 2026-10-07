import { describe, it, expect } from "vitest";
import { isEligible } from "@/core/booking/eligibility";
import { designer, enquiry, ist, makeSvc } from "./helpers";

const START = ist("2026-10-08T11:00:00"), END = ist("2026-10-08T12:00:00");
const nocal = (id: string, name: string, o = {}) => designer(id, name, { calendarId: null, ...o });

describe("isEligible without a calendar requirement", () => {
  it("a designer with no calendar is eligible only when the calendar is not required", () => {
    expect(isEligible(nocal("A", "A"), { project_type: "home" })).toBe(false);
    expect(isEligible(nocal("A", "A"), { project_type: "home" }, { requireCalendar: false })).toBe(true);
    expect(isEligible(nocal("A", "A", { active: false }), { project_type: "home" }, { requireCalendar: false })).toBe(false);
  });
});

describe("BookingService.recordExternalBooking (a booking made by the voice platform's Cal.com)", () => {
  const mk = (designers = [nocal("A", "A", { isPrincipal: true }), nocal("B", "B"), nocal("C", "C")]) => makeSvc({ designers, requireCalendar: false });
  const book = (t: ReturnType<typeof mk>, o: { start?: Date; uid?: string; enq?: ReturnType<typeof enquiry> } = {}) =>
    t.svc.recordExternalBooking({ enquiry: o.enq ?? enquiry(), start: o.start ?? START, end: END, externalId: o.uid ?? "cal-uid-1" });

  it("assigns by rotation, confirms the booking against the external id, and sends the designer's note", async () => {
    const t = mk();
    const r = await book(t);
    expect(r).toMatchObject({ ok: true, handoffSent: true });
    if (!r.ok) throw new Error();
    const b = (await t.repo.getBooking(r.bookingId))!;
    expect(b).toMatchObject({ status: "confirmed", calendarEventId: "cal-uid-1", designerId: r.designerId, mode: "site_visit" });
    expect(t.notifier.handoffs).toHaveLength(1);
    expect(t.notifier.handoffs[0]!.note.buttons).toHaveLength(2);
    const h = (await t.repo.handoffsForBooking(r.bookingId))[0]!;
    expect(h).toMatchObject({ status: "sent", attemptNo: 1 });
    expect(h.dueAt.getTime()).toBeGreaterThan(t.clock.t.getTime());
  });
  it("two simultaneous attempts for the same Cal.com booking make ONE booking (the second must not fall through to another designer)", async () => {
    const t = mk();
    const [x, y] = await Promise.all([book(t, { uid: "race-1" }), book(t, { uid: "race-1" })]);
    if (!x.ok || !y.ok) throw new Error(JSON.stringify([x, y]));
    expect(x.bookingId).toBe(y.bookingId);
    expect(x.designerId).toBe(y.designerId);
    expect(t.notifier.handoffs).toHaveLength(1);
    expect((await t.repo.handoffsForBooking(x.bookingId))).toHaveLength(1);
  });
  it("never touches a calendar (the Google adapter is parked)", async () => {
    const t = mk();
    await book(t);
    expect(t.calendar.events).toHaveLength(0);
  });
  it("rotation: the next booking goes to a different designer", async () => {
    const t = mk();
    const a = await book(t, { uid: "u1" });
    const b = await book(t, { uid: "u2", start: ist("2026-10-09T11:00:00"), enq: enquiry({ id: "enq-2" }) });
    if (!a.ok || !b.ok) throw new Error();
    expect(a.designerId).not.toBe(b.designerId);
  });
  it("a designer already booked at that time (in our own table) is skipped", async () => {
    const t = mk([nocal("A", "A"), nocal("B", "B")]);
    const a = await book(t, { uid: "u1" });
    const b = await book(t, { uid: "u2", enq: enquiry({ id: "enq-2" }) });
    if (!a.ok || !b.ok) throw new Error();
    expect(a.designerId).not.toBe(b.designerId);
    const c = await book(t, { uid: "u3", enq: enquiry({ id: "enq-3" }) });
    expect(c).toEqual({ ok: false, error: "no_designer" });
  });
  it("only designers who cover the area and project type are used", async () => {
    const t = mk([nocal("A", "A", { areas: ["baner"] }), nocal("B", "B", { areas: ["kothrud"] })]);
    const r = await book(t);
    if (!r.ok) throw new Error();
    expect(r.designerId).toBe("B");
  });
  it("replaying the same Cal.com booking does not book twice", async () => {
    const t = mk();
    const a = await book(t);
    const b = await book(t);
    if (!a.ok || !b.ok) throw new Error();
    expect(b.bookingId).toBe(a.bookingId);
    expect(t.notifier.handoffs).toHaveLength(1);
  });
  it("a failed Telegram send leaves the booking standing with the note pending for the retry job", async () => {
    const t = mk();
    t.notifier.failNext();
    const r = await book(t);
    expect(r).toMatchObject({ ok: true, handoffSent: false });
    if (!r.ok) throw new Error();
    expect((await t.repo.handoffsForBooking(r.bookingId))[0]!.status).toBe("pending");
  });
  it("only a fit enquiry can be recorded: the rules engine decides (hard rule 2)", async () => {
    const t = mk();
    expect(await book(t, { enq: enquiry({ fit: "unclear" }) })).toEqual({ ok: false, error: "not_bookable" });
  });
});
