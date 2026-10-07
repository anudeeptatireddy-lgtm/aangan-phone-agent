import { describe, it, expect } from "vitest";
import { bookedEnv, ist, NIKHIL_CHAT, OWNER_CHAT } from "./helpers";

const press = (env: Awaited<ReturnType<typeof bookedEnv>>, data: string, from?: number) =>
  env.svc.handleCallback({ callbackQueryId: "cq1", fromChatId: from ?? env.designerChat, data });

describe("Accept", () => {
  it("marks the handoff accepted, removes the buttons, and answers the press", async () => {
    const env = await bookedEnv();
    const r = await press(env, env.h.id ? `h:${env.h.id}:a` : "");
    expect(r.outcome).toBe("accepted");
    expect((await env.repo.getHandoff(env.h.id))!.status).toBe("accepted");
    const edit = env.notifier.edits.at(-1)!;
    expect(edit.text).toMatch(/^✅ Accepted/);
    expect(edit.buttons).toBeUndefined();
    expect(env.notifier.callbackAnswers).toHaveLength(1);
  });
  it("a press from someone else's chat changes nothing", async () => {
    const env = await bookedEnv();
    const r = await press(env, `h:${env.h.id}:a`, 999999);
    expect(r.outcome).toBe("not_your_handoff");
    expect((await env.repo.getHandoff(env.h.id))!.status).toBe("sent");
    expect(env.notifier.callbackAnswers).toHaveLength(1);
  });
  it("a second press is harmless", async () => {
    const env = await bookedEnv();
    await press(env, `h:${env.h.id}:a`);
    expect((await press(env, `h:${env.h.id}:a`)).outcome).toBe("already_handled");
  });
  it("garbage or unknown callback data is answered and ignored", async () => {
    const env = await bookedEnv();
    expect((await press(env, "nonsense")).outcome).toBe("unknown");
    expect((await press(env, "h:00000000-0000-0000-0000-000000000000:a")).outcome).toBe("unknown");
    expect(env.notifier.callbackAnswers).toHaveLength(2);
  });
  it("a late Accept after the timeout reassigned the booking is refused", async () => {
    const env = await bookedEnv();
    env.clock.t = ist("2026-10-07T11:10:00");
    await env.svc.sweep();
    expect((await press(env, `h:${env.h.id}:a`)).outcome).toBe("already_handled");
  });
});

describe("Decline and reassign", () => {
  it("moves the booking, calendar event and note to another designer", async () => {
    const env = await bookedEnv();
    const oldEvents = env.calendar.events.map((e) => e.eventId);
    const r = await press(env, `h:${env.h.id}:d`);
    expect(r.outcome).toBe("declined");
    const hs = await env.repo.handoffsForBooking(env.bookingId);
    expect(hs).toHaveLength(2);
    expect(hs[0]).toMatchObject({ status: "reassigned", reassignedToHandoffId: hs[1]!.id });
    expect(hs[1]).toMatchObject({ attemptNo: 2, status: "sent" });
    expect(hs[1]!.designerId).not.toBe(env.h.designerId);
    const b = (await env.repo.getBooking(env.bookingId))!;
    expect(b.designerId).toBe(hs[1]!.designerId);
    expect(env.calendar.events).toHaveLength(1);                           // old event deleted, new one created
    expect(env.calendar.events[0]!.eventId).not.toBe(oldEvents[0]);
    expect(b.calendarEventId).toBe(env.calendar.events[0]!.eventId);
    const note = env.notifier.handoffs.at(-1)!;
    expect(note.note.text).toMatch(/Reassigned/i);
    expect(env.notifier.edits.at(-1)!.text).toMatch(/Declined/);
  });
  it("never goes back to a designer who already had it", async () => {
    const env = await bookedEnv();
    await press(env, `h:${env.h.id}:d`);
    const h2 = (await env.repo.handoffsForBooking(env.bookingId))[1]!;
    const d2 = (await env.repo.getDesigner(h2.designerId))!;
    await env.svc.handleCallback({ callbackQueryId: "x", fromChatId: d2.telegramChatId!, data: `h:${h2.id}:d` });
    const all = await env.repo.handoffsForBooking(env.bookingId);
    expect(new Set(all.map((x) => x.designerId)).size).toBe(all.length);
  });
  it("skips a designer who is busy at that time", async () => {
    const env = await bookedEnv();
    for (const id of ["A", "B", "C"]) env.calendar.addBusy(`cal-${id}`, ist("2026-10-08T11:00:00"), ist("2026-10-08T12:00:00"));
    // only designers other than the current one are checked; the current event is deleted from its calendar after the move
    await press(env, `h:${env.h.id}:d`);
    const alerts = env.notifier.alerts.map((a) => a.chatId);
    expect(alerts).toEqual(expect.arrayContaining([OWNER_CHAT, NIKHIL_CHAT]));
    expect((await env.repo.getHandoff(env.h.id))!.status).toBe("declined");
    expect((await env.repo.getBooking(env.bookingId))!.designerId).toBe(env.h.designerId); // untouched
  });
  it("principal-requested bookings only go to a principal", async () => {
    const env = await bookedEnv(true);
    await press(env, `h:${env.h.id}:d`);
    // A is the only principal and just declined: nobody else qualifies -> escalated, not given to a non-principal
    expect((await env.repo.getBooking(env.bookingId))!.designerId).toBe(env.h.designerId);
    expect(env.notifier.alerts.length).toBeGreaterThan(0);
  });
  it("a calendar failure for one candidate falls through to the next one", async () => {
    const env = await bookedEnv();
    env.calendar.failNext("createEvent");
    await press(env, `h:${env.h.id}:d`);
    const b = (await env.repo.getBooking(env.bookingId))!;
    expect(b.designerId).not.toBe(env.h.designerId);
    expect(env.calendar.events).toHaveLength(1);
  });
  it("calendar down for everyone: booking stays, people are alerted", async () => {
    const env = await bookedEnv();
    for (let i = 0; i < 5; i++) env.calendar.failNext("freeBusy");
    await press(env, `h:${env.h.id}:d`);
    expect((await env.repo.getBooking(env.bookingId))!.designerId).toBe(env.h.designerId);
    expect(env.notifier.alerts.length).toBeGreaterThan(0);
  });
});

describe("30-working-minute timeout sweep", () => {
  it("does nothing before the deadline", async () => {
    const env = await bookedEnv();
    env.clock.t = ist("2026-10-07T10:59:00");
    expect(await env.svc.sweep()).toMatchObject({ timedOut: 0 });
  });
  it("alerts the design lead and reassigns after the deadline, once", async () => {
    const env = await bookedEnv();
    env.clock.t = ist("2026-10-07T11:05:00");
    expect(await env.svc.sweep()).toMatchObject({ timedOut: 1 });
    const lead = (await env.repo.listActiveDesigners()).find((d) => d.isDesignLead)!;
    expect(env.notifier.alerts.some((a) => a.chatId === lead.telegramChatId && /did not accept/i.test(a.text))).toBe(true);
    expect((await env.repo.handoffsForBooking(env.bookingId))).toHaveLength(2);
    expect(await env.svc.sweep()).toMatchObject({ timedOut: 0 });          // second sweep: nothing new
    expect((await env.repo.handoffsForBooking(env.bookingId))).toHaveLength(2);
  });
  it("the 30 minutes are WORKING minutes: a note sent at 6:50 pm is not overdue at 7:30 pm", async () => {
    const env = await bookedEnv();
    // new handoff created at 18:50 on Wednesday: due 10:20 next day
    const h = await env.repo.getHandoff(env.h.id);
    expect(h).toBeTruthy();
    const { addWorkingMinutes } = await import("@/core/booking/working-minutes");
    expect(addWorkingMinutes(ist("2026-10-07T18:50:00"), 30).toISOString()).toBe(ist("2026-10-08T10:20:00").toISOString());
  });
  it("an accepted handoff is never timed out", async () => {
    const env = await bookedEnv();
    await press(env, `h:${env.h.id}:a`);
    env.clock.t = ist("2026-10-07T12:00:00");
    expect(await env.svc.sweep()).toMatchObject({ timedOut: 0 });
  });
  it("with nobody left to take it, alerts the design lead, owner and Nikhil", async () => {
    const env = await bookedEnv();
    for (const id of ["A", "B", "C"]) env.calendar.addBusy(`cal-${id}`, ist("2026-10-08T11:00:00"), ist("2026-10-08T12:00:00"));
    env.clock.t = ist("2026-10-07T11:05:00");
    await env.svc.sweep();
    expect(env.notifier.alerts.map((a) => a.chatId)).toEqual(expect.arrayContaining([OWNER_CHAT, NIKHIL_CHAT]));
  });
});

describe("retryPending", () => {
  it("re-sends a note whose Telegram send failed", async () => {
    const env = await bookedEnv();
    // simulate a failed first send: make a fresh pending handoff
    const h = await env.repo.createHandoff({ bookingId: env.bookingId, designerId: env.h.designerId, dueAt: ist("2026-10-07T12:00:00"), attemptNo: 9 });
    expect(await env.svc.retryPending()).toMatchObject({ sent: 1 });
    expect((await env.repo.getHandoff(h.id))!.status).toBe("sent");
    expect(await env.svc.retryPending()).toMatchObject({ sent: 0 });
  });
  it("a still-failing send stays pending", async () => {
    const env = await bookedEnv();
    const h = await env.repo.createHandoff({ bookingId: env.bookingId, designerId: env.h.designerId, dueAt: ist("2026-10-07T12:00:00"), attemptNo: 9 });
    env.notifier.failNext();
    expect(await env.svc.retryPending()).toMatchObject({ sent: 0, failed: 1 });
    expect((await env.repo.getHandoff(h.id))!.status).toBe("pending");
  });
});
