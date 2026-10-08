import { describe, it, expect } from "vitest";
import { InMemoryBookingRepo } from "@/server/booking-repo";
import { FakeNotifier } from "@/adapters/notify/fake";
import { BookingService } from "@/core/booking/service";
import { HandoffService } from "@/core/handoff/service";
import { DEFAULT_BOOKING_CONFIG } from "@/core/booking/types";
import type { CalendarPort } from "@/core/ports";
import { designer, enquiry, ist } from "../booking/helpers";

// Google is parked: bookings come from Cal.com, designers have no calendar, and NO Google call may ever be made.
const NOW = ist("2026-10-07T10:30:00");
const START = ist("2026-10-08T11:00:00"), END = ist("2026-10-08T12:00:00");
const nocal = (id: string, name: string, o = {}) => designer(id, name, { calendarId: null, ...o });

function world(designers = [nocal("A", "Asha"), nocal("B", "Bela"), nocal("C", "Chitra")]) {
  const clock = { t: NOW };
  const touched: string[] = [];
  const calendar: CalendarPort = { // any call is a failure of the "Google is off" promise
    freeBusy: async () => { touched.push("freeBusy"); throw new Error("Google is not configured"); },
    createEvent: async () => { touched.push("createEvent"); throw new Error("Google is not configured"); },
    deleteEvent: async () => { touched.push("deleteEvent"); throw new Error("Google is not configured"); },
  };
  const repo = new InMemoryBookingRepo(designers);
  const notifier = new FakeNotifier();
  const enq = enquiry();
  const booking = new BookingService({ repo, calendar, notifier, now: () => clock.t, config: DEFAULT_BOOKING_CONFIG, requireCalendar: false });
  const svc = new HandoffService({ repo, calendar, notifier, now: () => clock.t, config: DEFAULT_BOOKING_CONFIG, useCalendar: false,
    loadEnquiry: async (id) => (id === enq.id ? enq : null), ownerChatId: 111, nikhilChatId: 222 });
  return { repo, notifier, clock, enq, booking, svc, touched };
}
async function booked(w: ReturnType<typeof world>) {
  const r = await w.booking.recordExternalBooking({ enquiry: w.enq, start: START, end: END, externalId: "cal-uid-1" });
  if (!r.ok) throw new Error(JSON.stringify(r));
  const [h] = await w.repo.handoffsForBooking(r.bookingId);
  return { bookingId: r.bookingId, h: h!, first: r.designerId };
}

describe("a designer with no calendar can be given a booking and can be reassigned (Google parked)", () => {
  it("the first assignment works without any calendar id", async () => {
    const w = world();
    const { first } = await booked(w);
    expect(["A", "B", "C"]).toContain(first);
    expect(w.notifier.handoffs).toHaveLength(1);
    expect(w.touched).toEqual([]);
  });

  it("a designer who declines: the booking moves to the next designer, a new note goes to them, and no calendar is touched", async () => {
    const w = world();
    const { bookingId, h, first } = await booked(w);
    const before = (await w.repo.getBooking(bookingId))!;
    const chat = (await w.repo.getDesigner(first))!.telegramChatId!;
    await w.svc.handleCallback({ callbackQueryId: "q", fromChatId: chat, data: `h:${h.id}:d` });
    const hs = await w.repo.handoffsForBooking(bookingId);
    expect(hs.map((x) => x.status)).toEqual(["reassigned", "sent"]);
    expect(hs[1]!.designerId).not.toBe(first);
    const after = (await w.repo.getBooking(bookingId))!;
    expect(after.designerId).toBe(hs[1]!.designerId);
    expect(after.calendarEventId).toBe(before.calendarEventId);   // still the Cal.com booking's id
    expect(after.status).toBe("confirmed");
    expect(w.notifier.handoffs).toHaveLength(2);
    expect(w.notifier.handoffs[1]!.note.text).toMatch(/Reassigned to you/);
    expect(w.touched).toEqual([]);
  });

  it("30 working minutes without an answer: the sweep reassigns, the same way", async () => {
    const w = world();
    const { bookingId, h, first } = await booked(w);
    w.clock.t = new Date(h.dueAt.getTime() + 60_000);
    expect(await w.svc.sweep()).toEqual({ timedOut: 1 });
    const hs = await w.repo.handoffsForBooking(bookingId);
    expect(hs).toHaveLength(2);
    expect(hs[1]!.designerId).not.toBe(first);
    expect(w.touched).toEqual([]);
  });

  it("a designer who is already booked at that time (in our own table) is skipped, and one who already had it is never asked again", async () => {
    const w = world();
    const { bookingId, h, first } = await booked(w);
    const others = ["A", "B", "C"].filter((x) => x !== first);
    const busy = others[0]!;
    const hold = await w.repo.createHold({ enquiryId: "other-enquiry", designerId: busy, startsAt: START, endsAt: END, idempotencyKey: "busy", mode: "site_visit" });
    expect(hold.ok).toBe(true);
    await w.svc.reassign(h.id, "declined");
    const hs = await w.repo.handoffsForBooking(bookingId);
    expect(hs[1]!.designerId).toBe(others[1]);                      // not the busy one, not the first
    await w.svc.reassign(hs[1]!.id, "declined");                    // nobody left: first tried, busy one busy
    expect((await w.repo.handoffsForBooking(bookingId)).every((x) => x.designerId !== busy)).toBe(true);
    expect(w.touched).toEqual([]);
  });

  it("everyone has been tried: nobody is invented, the people who must know are told", async () => {
    const w = world();
    const { bookingId, h } = await booked(w);
    let cur = h;
    for (let i = 0; i < 3; i++) {
      const r = await w.svc.reassign(cur.id, "declined");
      const hs = await w.repo.handoffsForBooking(bookingId);
      if (!r.ok) { expect(i).toBe(2); expect(hs).toHaveLength(3); break; }
      cur = hs[hs.length - 1]!;
    }
    expect(w.notifier.alerts.length).toBeGreaterThan(0);
    expect(w.touched).toEqual([]);
  });

  it("the default is unchanged: with calendars in use, a designer with no calendar is still not eligible and reassignment still checks Google", async () => {
    const clock = { t: NOW };
    const repo = new InMemoryBookingRepo([nocal("A", "Asha"), nocal("B", "Bela")]);
    const notifier = new FakeNotifier();
    const calls: string[] = [];
    const calendar: CalendarPort = { freeBusy: async () => { calls.push("freeBusy"); return new Map(); }, createEvent: async () => ({ eventId: "e" }), deleteEvent: async () => undefined };
    const booking = new BookingService({ repo, calendar, notifier, now: () => clock.t, config: DEFAULT_BOOKING_CONFIG });
    const r = await booking.recordExternalBooking({ enquiry: enquiry(), start: START, end: END, externalId: "u" });
    expect(r).toEqual({ ok: false, error: "no_designer" });
  });
});
