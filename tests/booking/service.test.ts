import { describe, it, expect } from "vitest";
import { designer, enquiry, ist, makeSvc, NOW } from "./helpers";

const THU_11 = ist("2026-10-08T11:00:00").toISOString();
const THU_14 = ist("2026-10-08T14:00:00").toISOString();
const FRI_11 = ist("2026-10-09T11:00:00").toISOString();
const FRI_14 = ist("2026-10-09T14:00:00").toISOString();

describe("getSlots", () => {
  it("offers the earliest free slot on up to three different days, with speakable labels", async () => {
    const { svc } = makeSvc();
    const r = await svc.getSlots({ enquiry: enquiry() });
    expect(r.next_action).toBe("offer_slots");
    expect(r.slots).toHaveLength(3);
    expect(r.slots[0]).toMatchObject({ start: ist("2026-10-07T12:30:00").toISOString(), label: "Wednesday 7 October, 12:30 pm" });
    expect(new Set(r.slots.map((s) => s.label.split(",")[0])).size).toBe(3);
  });
  it("a time is offered if ANY eligible designer is free, and not offered if all are busy", async () => {
    const { svc, calendar } = makeSvc();
    calendar.addBusy("cal-A", ist("2026-10-08T00:00:00"), ist("2026-10-09T00:00:00"));
    expect((await svc.getSlots({ enquiry: enquiry(), prefs: { onDate: "2026-10-08" } })).slots.length).toBeGreaterThan(0);
    calendar.addBusy("cal-B", ist("2026-10-08T00:00:00"), ist("2026-10-09T00:00:00"));
    calendar.addBusy("cal-C", ist("2026-10-08T00:00:00"), ist("2026-10-09T00:00:00"));
    const r = await svc.getSlots({ enquiry: enquiry(), prefs: { onDate: "2026-10-08" } });
    expect(r).toMatchObject({ slots: [], next_action: "ask_other_days" });
  });
  it("keeps a 30-minute buffer around existing events", async () => {
    const { svc, calendar } = makeSvc({ designers: [designer("A", "A")] });
    calendar.addBusy("cal-A", ist("2026-10-08T11:00:00"), ist("2026-10-08T12:00:00"));
    const starts = (await svc.getSlots({ enquiry: enquiry(), prefs: { onDate: "2026-10-08" }, count: 20 })).slots.map((s) => s.label);
    expect(starts).not.toContain("Thursday 8 October, 12:00 pm");
    expect(starts).toContain("Thursday 8 October, 12:30 pm");
    expect(starts).not.toContain("Thursday 8 October, 10:30 am");
    expect(starts).not.toContain("Thursday 8 October, 10:00 am"); // would end exactly when the 11:00 meeting starts: inside the buffer
    expect(starts[0]).toBe("Thursday 8 October, 12:30 pm");
  });
  it("counts bookings the calendar does not know about yet (held/confirmed in our own table)", async () => {
    const { svc, repo } = makeSvc({ designers: [designer("A", "A")] });
    await repo.createHold({ enquiryId: "other", designerId: "A", startsAt: ist("2026-10-08T11:00:00"), endsAt: ist("2026-10-08T12:00:00"), idempotencyKey: "k0", mode: "site_visit" });
    const labels = (await svc.getSlots({ enquiry: enquiry(), prefs: { onDate: "2026-10-08" }, count: 20 })).slots.map((s) => s.label);
    expect(labels).not.toContain("Thursday 8 October, 11:00 am");
  });
  it("principal requested: only the principal's availability counts", async () => {
    const { svc, calendar } = makeSvc();
    calendar.addBusy("cal-A", ist("2026-10-08T00:00:00"), ist("2026-10-09T00:00:00")); // principal A busy all Thursday
    expect((await svc.getSlots({ enquiry: enquiry(), wantsPrincipal: true, prefs: { onDate: "2026-10-08" } })).slots).toEqual([]);
    expect((await svc.getSlots({ enquiry: enquiry(), wantsPrincipal: false, prefs: { onDate: "2026-10-08" } })).slots.length).toBeGreaterThan(0);
  });
  it("nobody eligible (area/type/active/no calendar) -> human review, never an empty promise", async () => {
    const { svc } = makeSvc({ designers: [designer("A", "A", { areas: ["baner"] }), designer("B", "B", { calendarId: null }), designer("C", "C", { active: false })] });
    expect(await svc.getSlots({ enquiry: enquiry() })).toMatchObject({ slots: [], next_action: "request_human_review", reason: "no_eligible_designer" });
  });
  it("calendar outage -> human review, never a guess", async () => {
    const { svc, calendar } = makeSvc();
    calendar.failNext("freeBusy");
    expect(await svc.getSlots({ enquiry: enquiry() })).toMatchObject({ slots: [], next_action: "request_human_review", reason: "calendar_unavailable" });
  });
  it("respects the per-day cap", async () => {
    const { svc, repo } = makeSvc({ designers: [designer("A", "A", { maxPerDay: 1 })] });
    await repo.createHold({ enquiryId: "other", designerId: "A", startsAt: ist("2026-10-08T10:00:00"), endsAt: ist("2026-10-08T11:00:00"), idempotencyKey: "k1", mode: "site_visit" });
    expect((await svc.getSlots({ enquiry: enquiry(), prefs: { onDate: "2026-10-08" } })).slots).toEqual([]);
    expect((await svc.getSlots({ enquiry: enquiry(), prefs: { onDate: "2026-10-09" } })).slots.length).toBeGreaterThan(0);
  });
});

describe("bookSlot: happy path", () => {
  it("holds, creates the calendar event with the caller invited, confirms, notifies the designer, and records the handoff", async () => {
    const { svc, repo, calendar, notifier } = makeSvc();
    const r = await svc.bookSlot({ enquiry: enquiry(), start: THU_11 });
    expect(r).toMatchObject({ ok: true, label: "Thursday 8 October, 11:00 am", handoff_sent: true, replayed: false, designer_role: "designer" });
    if (!r.ok) throw new Error();
    const b = await repo.getBooking(r.booking_id);
    expect(b).toMatchObject({ status: "confirmed", designerId: "A" });
    expect(b!.calendarEventId).toBeTruthy();
    expect(calendar.events).toHaveLength(1);
    expect(calendar.events[0]).toMatchObject({ calendarId: "cal-A", attendeeEmails: ["priya@example.com"] });
    expect(calendar.events[0]!.summary).toMatch(/consultation/i);
    expect(JSON.stringify(calendar.events[0])).not.toMatch(/\+?\d{10}/);
    expect(notifier.handoffs).toHaveLength(1);
    expect(notifier.handoffs[0]).toMatchObject({ chatId: 100 + "A".charCodeAt(0) });
    expect(notifier.handoffs[0]!.note.text).toContain("Booked: Thursday 8 October, 11:00 am");
    const h = repo.handoffs[0]!;
    expect(h).toMatchObject({ bookingId: r.booking_id, designerId: "A", status: "sent" });
    expect(h.dueAt.toISOString()).toBe(ist("2026-10-07T11:00:00").toISOString()); // sent 10:30 + 30 working minutes
    expect((await repo.listActiveDesigners()).find((d) => d.id === "A")!.lastAssignedAt).toEqual(NOW);
  });
  it("never reveals a designer's name to the caller; says 'principal' only when asked for", async () => {
    const { svc } = makeSvc();
    const r = await svc.bookSlot({ enquiry: enquiry(), start: THU_11, wantsPrincipal: true });
    expect(r).toMatchObject({ ok: true, designer_role: "principal" });
    expect(JSON.stringify(r)).not.toMatch(/"name"|designer_name/);
  });
  it("rotation: least-recently-assigned first, cycling A, B, C, A", async () => {
    const { svc, repo, clock } = makeSvc();
    const who: string[] = [];
    for (const [i, start] of [THU_11, THU_14, FRI_11, FRI_14].entries()) {
      clock.t = new Date(clock.t.getTime() + 60_000);
      const r = await svc.bookSlot({ enquiry: enquiry({ id: `e${i}` }), start });
      if (!r.ok) throw new Error(JSON.stringify(r));
      who.push((await repo.getBooking(r.booking_id))!.designerId);
    }
    expect(who).toEqual(["A", "B", "C", "A"]);
  });
  it("principal asked for -> only a principal is assigned", async () => {
    const { svc, repo } = makeSvc();
    const r = await svc.bookSlot({ enquiry: enquiry(), start: THU_11, wantsPrincipal: true });
    if (!r.ok) throw new Error();
    expect((await repo.getBooking(r.booking_id))!.designerId).toBe("A");
  });
  it("idempotent: a retried book_slot returns the same booking and creates nothing new", async () => {
    const { svc, calendar, notifier } = makeSvc();
    const a = await svc.bookSlot({ enquiry: enquiry(), start: THU_11 });
    const b = await svc.bookSlot({ enquiry: enquiry(), start: THU_11 });
    expect(b).toMatchObject({ ok: true, replayed: true });
    expect(a.ok && b.ok && a.booking_id === b.booking_id).toBe(true);
    expect(calendar.events).toHaveLength(1);
    expect(notifier.handoffs).toHaveLength(1);
  });
});

describe("bookSlot: guards", () => {
  it("only an enquiry the rules engine called 'fit' can be booked (hard rule 2), and the engine's own next action is passed through", async () => {
    for (const [fit, nextAction] of [["unclear", "human_review"], ["not_fit", "decline_kindly"], [undefined, undefined]] as const) {
      const { svc, calendar, notifier } = makeSvc();
      expect(await svc.bookSlot({ enquiry: enquiry({ fit, nextAction }), start: THU_11 })).toMatchObject({ ok: false, error: "not_bookable", next_action: nextAction ?? "human_review" });
      expect(calendar.events).toHaveLength(0);
      expect(notifier.handoffs).toHaveLength(0);
    }
  });
  it("rejects slots we never offer: Sunday, past, off-step, outside hours, too far", async () => {
    const { svc } = makeSvc();
    for (const s of ["2026-10-11T11:00:00", "2026-10-07T09:00:00", "2026-10-08T11:15:00", "2026-10-08T21:00:00", "2026-12-01T11:00:00"])
      expect(await svc.bookSlot({ enquiry: enquiry(), start: ist(s).toISOString() }), s).toMatchObject({ ok: false, error: "invalid_slot" });
    expect(await svc.bookSlot({ enquiry: enquiry(), start: "not-a-date" })).toMatchObject({ ok: false, error: "invalid_slot" });
  });
  it("slot taken between offer and booking -> slot_taken with fresh alternatives", async () => {
    const { svc, calendar } = makeSvc();
    for (const c of ["cal-A", "cal-B", "cal-C"]) calendar.addBusy(c, ist("2026-10-08T10:30:00"), ist("2026-10-08T12:30:00"));
    const r = await svc.bookSlot({ enquiry: enquiry(), start: THU_11 });
    expect(r).toMatchObject({ ok: false, error: "slot_taken" });
    expect(!r.ok && r.alternatives!.length).toBeGreaterThan(0);
  });
  it("a competing hold appearing at the last moment moves the booking to the next designer", async () => {
    const { svc, repo } = makeSvc();
    const orig = repo.createHold.bind(repo);
    repo.createHold = async (h) => {
      if (h.designerId === "A") await orig({ ...h, enquiryId: "rival", idempotencyKey: "rival" });
      return orig(h);
    };
    const r = await svc.bookSlot({ enquiry: enquiry(), start: THU_11 });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect((await repo.getBooking(r.booking_id))!.designerId).toBe("B");
  });
  it("two callers racing for the same slot with one designer: exactly one wins", async () => {
    const { svc } = makeSvc({ designers: [designer("A", "A")] });
    const [x, y] = await Promise.all([svc.bookSlot({ enquiry: enquiry({ id: "e1" }), start: THU_11 }), svc.bookSlot({ enquiry: enquiry({ id: "e2" }), start: THU_11 })]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    const loser = x.ok ? y : x;
    expect(loser).toMatchObject({ ok: false, error: "slot_taken" });
  });
});

describe("bookSlot: failures never leave a half-made booking", () => {
  it("calendar failure -> the hold is cancelled, no handoff, designer rotation untouched, caller sent to a human", async () => {
    const { svc, repo, calendar, notifier } = makeSvc();
    calendar.failNext("createEvent");
    const r = await svc.bookSlot({ enquiry: enquiry(), start: THU_11 });
    expect(r).toMatchObject({ ok: false, error: "calendar_unavailable", next_action: "request_human_review" });
    expect(repo.bookings.every((b) => b.status === "cancelled")).toBe(true);
    expect(repo.handoffs).toHaveLength(0);
    expect(notifier.handoffs).toHaveLength(0);
    expect((await repo.listActiveDesigners()).every((d) => d.lastAssignedAt === null)).toBe(true);
    // the slot is free again
    expect((await svc.bookSlot({ enquiry: enquiry(), start: THU_11 })).ok).toBe(true);
  });
  it("calendar free/busy failure at booking time -> human review, no hold left behind", async () => {
    const { svc, repo, calendar } = makeSvc();
    calendar.failNext("freeBusy");
    expect(await svc.bookSlot({ enquiry: enquiry(), start: THU_11 })).toMatchObject({ ok: false, error: "calendar_unavailable" });
    expect(repo.bookings).toHaveLength(0);
  });
  it("Telegram failure -> the booking STANDS (the caller was promised it); handoff is recorded as pending for retry", async () => {
    const { svc, repo, notifier } = makeSvc();
    notifier.failNext();
    const r = await svc.bookSlot({ enquiry: enquiry(), start: THU_11 });
    expect(r).toMatchObject({ ok: true, handoff_sent: false });
    expect(repo.bookings[0]!.status).toBe("confirmed");
    expect(repo.handoffs[0]).toMatchObject({ status: "pending", telegramMessageId: null, sentAt: null });
  });
  it("designer with no Telegram chat id -> booking stands, handoff pending", async () => {
    const { svc, repo } = makeSvc({ designers: [designer("A", "A", { telegramChatId: null })] });
    expect(await svc.bookSlot({ enquiry: enquiry(), start: THU_11 })).toMatchObject({ ok: true, handoff_sent: false });
    expect(repo.handoffs[0]!.status).toBe("pending");
  });
});
