import { describe, it, expect } from "vitest";
import { alertsOf, calBooking, d, makeWorld, outboxKinds, PHONE_HASH, runCall, SWEEP_AT, World } from "./router.helpers";
import { ext } from "../postcall/pipeline.helpers";
import { designer } from "../booking/helpers";

const nocal = (id: string, name: string, o = {}) => designer(id, name, { calendarId: null, ...o });
const at = (w: World, iso: string) => { w.clock.t = d(iso); };
const final = async (w: World, id: string) => {
  const c = (await w.repo.getCall(id))!;
  return { outcome: c.outcome, booking: await w.cal.forCall(id) };
};
const nonLeadAlerts = (w: World) => [...w.repo.outbox.values()].filter((x) => x.kind === "nikhil_alert" || x.kind === "owner_alert");

describe("order A: the booking is already in when post-call processing finishes", () => {
  it("matches at once (by phone), assigns by rotation, books, sends the designer note, queues deal + email + note update", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-1", { attendeePhoneHash: PHONE_HASH, attendeeEmail: "priya@example.com" }));
    const r = await runCall(w, "c1");
    expect(r.status).toBe("processed");
    const { outcome, booking } = await final(w, "c1");
    expect(booking?.uid).toBe("bk-1");
    expect(outcome).toBe("booked");
    expect(w.notifier.handoffs).toHaveLength(1);
    const b = (await w.bookings.findByIdempotencyKey("cal:bk-1"))!;
    expect(b).toMatchObject({ status: "confirmed", calendarEventId: "bk-1", enquiryId: r.enquiryId });
    expect(outboxKinds(w)).toEqual(["confirmation_email", "designer_email", "designer_note_update", "hubspot_deal"]);
    const enq = (await w.repo.getEnquiry(r.enquiryId!))!;
    expect(enq.designerNote).toContain("Summary: 3BHK full redesign in Kothrud");
    expect(enq.designerNote).toContain("Booked: Thursday 8 October, 11:00 am");
    expect([...w.repo.outbox.values()].find((x) => x.kind === "call_routing")!.status).toBe("processed"); // done: nothing is left waiting
  });
});

describe("order B: the Cal.com webhook arrives after the post-call pipeline has finished", () => {
  it("the call waits; when the booking arrives and routing is triggered from that side, it is matched and finished", async () => {
    const w = makeWorld();
    await runCall(w, "c2");
    expect((await final(w, "c2")).booking).toBeNull();
    expect(w.notifier.handoffs).toHaveLength(0);
    expect(alertsOf(w, "booking_missing")).toHaveLength(0); // not yet: the sweep is at call end + 15 min

    at(w, "2026-10-07T06:24:00Z");
    await w.cal.upsert(calBooking("bk-2", { attendeePhoneHash: PHONE_HASH, createdAt: d("2026-10-07T06:23:30Z") })); // webhook delay: after the call ended
    await w.router.routePending();
    expect((await final(w, "c2")).outcome).toBe("booked");
    expect(w.notifier.handoffs).toHaveLength(1);
    expect(outboxKinds(w)).toEqual(["confirmation_email", "designer_email", "designer_note_update", "hubspot_deal"]);
  });
  it("both orders end in the same state", async () => {
    const a = makeWorld(); await a.cal.upsert(calBooking("bk", { attendeePhoneHash: PHONE_HASH })); await runCall(a, "c");
    const b = makeWorld(); await runCall(b, "c"); await b.cal.upsert(calBooking("bk", { attendeePhoneHash: PHONE_HASH })); await b.router.routePending();
    const view = async (w: World) => ({ f: await final(w, "c").then((x) => ({ o: x.outcome, u: x.booking?.uid })), kinds: outboxKinds(w), handoffs: w.notifier.handoffs.length });
    expect(await view(b)).toEqual(await view(a));
  });
});

describe("whichever side runs first wins and the other does nothing", () => {
  it("routing again (tick, webhook, retry) after a match changes nothing", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-3", { attendeePhoneHash: PHONE_HASH }));
    await runCall(w, "c3");
    const before = { kinds: outboxKinds(w), handoffs: w.notifier.handoffs.length, rows: w.bookings.bookings.length };
    await w.router.routePending(); await w.router.routePending(); await w.router.routeCall("c3");
    expect({ kinds: outboxKinds(w), handoffs: w.notifier.handoffs.length, rows: w.bookings.bookings.length }).toEqual(before);
  });
  it("both triggers racing on the same call make one booking and one handoff", async () => {
    const w = makeWorld();
    await runCall(w, "c4");
    await w.cal.upsert(calBooking("bk-4", { attendeePhoneHash: PHONE_HASH }));
    await Promise.all([w.router.routeCall("c4"), w.router.routePending(), w.router.routePending()]);
    expect(w.bookings.bookings.filter((x) => x.status !== "cancelled")).toHaveLength(1);
    expect(w.notifier.handoffs).toHaveLength(1);
    expect((await w.repo.getCall("c4"))!.outcome).toBe("booked");
  });
  it("two calls and one booking: only the call it belongs to gets it", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-5", { attendeePhoneHash: PHONE_HASH }));
    await runCall(w, "other", { callerPhone: "+919000000099" }, ext({ caller_email: "other@example.com" })); // different caller, claimed a booking, but the phone conflicts
    await runCall(w, "c5");
    expect((await final(w, "c5")).booking?.uid).toBe("bk-5");
    expect((await final(w, "other")).booking).toBeNull();
  });
  it("a claim lost to another call is re-evaluated, not trusted", async () => {
    const w = makeWorld();
    await runCall(w, "late");
    await w.cal.upsert(calBooking("bk-6", { attendeePhoneHash: PHONE_HASH }));
    await w.cal.claim("bk-6", "someone-else"); // another process got there first
    await w.router.routePending();
    expect((await final(w, "late")).booking).toBeNull();
  });
});

describe("the match window", () => {
  it("a booking created more than 10 min after the call ended is not this call's", async () => {
    const w = makeWorld();
    await runCall(w, "c7");
    await w.cal.upsert(calBooking("bk-7", { attendeePhoneHash: PHONE_HASH, createdAt: d("2026-10-07T06:29:31Z") })); // end 06:19:30 + 10 min = 06:29:30
    at(w, "2026-10-07T06:30:00Z");
    await w.router.routePending();
    expect((await final(w, "c7")).booking).toBeNull();
  });
  it("a booking created up to 2 min before the call rang (clock skew) still matches", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-8", { attendeePhoneHash: PHONE_HASH, createdAt: d("2026-10-07T06:10:00Z") })); // rang 06:12:00
    await runCall(w, "c8");
    expect((await final(w, "c8")).booking?.uid).toBe("bk-8");
  });
});

describe("the only-candidate match", () => {
  it("matches a lone booking with no phone or email on it", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-9"));
    await runCall(w, "c9");
    expect((await final(w, "c9")).outcome).toBe("booked");
  });
  it("does not match when the booking's phone belongs to someone else: after the sweep it is urgent, and the booking is an orphan", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-10", { attendeePhoneHash: "some-other-hash" }));
    await runCall(w, "c10");
    at(w, "2026-10-07T06:35:00Z");
    await w.router.routePending();
    expect((await final(w, "c10")).booking).toBeNull();
    expect(alertsOf(w, "booking_missing")).toHaveLength(1);
  });
  it("a call that did not say it booked never takes a booking by elimination", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-11"));
    await runCall(w, "c11", { signals: { claimedBooking: false } });
    at(w, "2026-10-07T06:35:00Z");
    await w.router.routePending();
    expect((await final(w, "c11")).booking).toBeNull();
    expect(alertsOf(w, "booking_missing")).toHaveLength(0); // it never claimed one
  });
});

describe("the sweep at call end + 15 min", () => {
  it("raises nothing at 14 minutes", async () => {
    const w = makeWorld();
    await runCall(w, "s1");
    at(w, "2026-10-07T06:34:29Z");
    await w.router.routePending();
    expect(alertsOf(w, "booking_missing")).toHaveLength(0);
    expect([...w.repo.outbox.values()].some((x) => x.kind === "call_routing" && x.status === "pending")).toBe(true);
  });

  it("AMBIGUOUS (2+ candidates): the design lead links it by hand; nothing is claimed or booked; Nikhil and the owner hear nothing", async () => {
    const w = makeWorld();
    const later = { startsAt: d("2026-10-12T05:30:00Z"), endsAt: d("2026-10-12T06:30:00Z") }; // days away: normal priority
    await w.cal.upsert(calBooking("x1", later)); await w.cal.upsert(calBooking("x2", { ...later, createdAt: d("2026-10-07T06:16:00Z") }));
    await runCall(w, "s2");
    expect(w.notifier.handoffs).toHaveLength(0);
    expect(alertsOf(w, "booking_ambiguous")).toHaveLength(0); // waits for the sweep: a rival call might still claim one
    at(w, SWEEP_AT.toISOString());
    await w.router.routePending();
    const [al] = alertsOf(w, "booking_ambiguous");
    expect(al!.payload).toMatchObject({ vendorCallId: "s2", priority: "normal" });
    expect((al!.payload.bookingUids as string[]).sort()).toEqual(["x1", "x2"]);
    expect(await w.cal.get("x1")).toMatchObject({ claimedByCall: null });
    expect(w.bookings.bookings).toHaveLength(0);
    expect((await w.repo.getCall("s2"))!.outcome).toBe("review");
    expect(nonLeadAlerts(w)).toHaveLength(0);
    await w.router.routePending();
    expect(alertsOf(w, "booking_ambiguous")).toHaveLength(1); // the sweep is not repeated
  });

  it("AMBIGUOUS escalates to URGENT when the earliest candidate consultation starts within 24 hours (exactly 24 h counts)", async () => {
    const mk = async (starts: string[]) => {
      const w = makeWorld();
      for (const [i, st] of starts.entries()) await w.cal.upsert(calBooking(`y${i}`, { startsAt: d(st), endsAt: d(new Date(d(st).getTime() + 3_600_000).toISOString()), createdAt: d(`2026-10-07T06:1${i}:00Z`) }));
      await runCall(w, "u1");
      at(w, SWEEP_AT.toISOString()); // 06:34:30Z
      await w.router.routePending();
      return alertsOf(w, "booking_ambiguous")[0]!.payload.priority;
    };
    expect(await mk(["2026-10-08T05:30:00Z", "2026-10-12T05:30:00Z"])).toBe("urgent");     // one is ~23 h away: the earliest decides
    expect(await mk(["2026-10-08T06:34:30Z", "2026-10-12T05:30:00Z"])).toBe("urgent");     // exactly 24 h after the sweep
    expect(await mk(["2026-10-08T06:34:31Z", "2026-10-12T05:30:00Z"])).toBe("normal");     // 1 s over
  });

  it("AGENT CLAIMED A BOOKING BUT NONE MATCHED: URGENT to the design lead + a front-desk callback item; the lead is still created for follow-up", async () => {
    const w = makeWorld();
    await runCall(w, "s3");
    at(w, SWEEP_AT.toISOString()); // 06:34:30Z = 12:04 IST Wednesday: in working hours
    await w.router.routePending();
    const [al] = alertsOf(w, "booking_missing");
    expect(al!.payload).toMatchObject({ vendorCallId: "s3", priority: "urgent" });
    const esc = w.repo.escalations.filter((x) => x.vendorCallId === "s3");
    expect(esc).toHaveLength(1);
    expect(esc[0]).toMatchObject({ reason: "review" });
    expect(esc[0]!.callbackDueAt).toBeInstanceOf(Date);
    expect((await w.repo.getCall("s3"))!.outcome).toBe("review");
    expect(outboxKinds(w)).toContain("hubspot_deal");
    expect(nonLeadAlerts(w)).toHaveLength(0);
    await w.router.routePending();
    expect(alertsOf(w, "booking_missing")).toHaveLength(1);
    expect(w.repo.escalations.filter((x) => x.vendorCallId === "s3")).toHaveLength(1);
  });
  it("after hours the front-desk callback is due at the next opening", async () => {
    const w = makeWorld();
    await runCall(w, "s4");
    at(w, "2026-10-07T14:00:00Z"); // 19:30 IST, closed
    await w.router.routePending();
    const due = w.repo.escalations.find((x) => x.vendorCallId === "s4")!.callbackDueAt!;
    expect(due.toISOString()).toBe("2026-10-08T04:30:00.000Z"); // Thursday 10:00 IST
  });

  it("a call that claimed nothing and found nothing just closes: not_fit stays not_fit, no alert", async () => {
    const w = makeWorld();
    await runCall(w, "s5", { signals: { claimedBooking: false } }, ext({ location: "Nashik" })); // outside the service area
    at(w, "2026-10-07T06:40:00Z");
    await w.router.routePending();
    expect(alertsOf(w, "booking_missing")).toHaveLength(0);
    expect((await w.repo.getCall("s5"))!.outcome).toBe("not_fit");
  });

  it("a booking no call claimed 45 min after Cal.com created it: LOW priority to the design lead, once", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("orph", { createdAt: d("2026-10-07T07:00:00Z") }));
    at(w, "2026-10-07T07:44:00Z"); await w.router.routePending();
    expect(alertsOf(w, "booking_orphan")).toHaveLength(0);
    at(w, "2026-10-07T07:45:01Z"); await w.router.routePending(); await w.router.routePending();
    const al = alertsOf(w, "booking_orphan");
    expect(al).toHaveLength(1);
    expect(al[0]!.payload).toMatchObject({ bookingUid: "orph", priority: "low" });
    expect(nonLeadAlerts(w)).toHaveLength(0);
  });
  it("a claimed booking is never an orphan", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-z", { attendeePhoneHash: PHONE_HASH }));
    await runCall(w, "z");
    at(w, "2026-10-07T09:00:00Z"); await w.router.routePending();
    expect(alertsOf(w, "booking_orphan")).toHaveLength(0);
  });
});

describe("a matched booking that cannot be assigned", () => {
  it("every eligible designer busy at that time: URGENT to the design lead, the booking stays claimed by the call", async () => {
    const w = makeWorld({ designers: [nocal("A", "Asha"), nocal("L", "Lead", { isDesignLead: true, projectTypes: ["factory"] })] });
    await w.bookings.createHold({ enquiryId: "e0", designerId: "A", startsAt: d("2026-10-08T05:30:00Z"), endsAt: d("2026-10-08T06:30:00Z"), idempotencyKey: "k0", mode: "site_visit" });
    await w.cal.upsert(calBooking("bk-12", { attendeePhoneHash: PHONE_HASH }));
    await runCall(w, "n1");
    const [al] = alertsOf(w, "booking_no_designer");
    expect(al!.payload).toMatchObject({ vendorCallId: "n1", priority: "urgent", bookingUid: "bk-12" });
    expect((await w.cal.forCall("n1"))?.uid).toBe("bk-12");
    expect((await w.repo.getCall("n1"))!.outcome).toBe("review");
  });
  it("an enquiry the rules did not call 'fit' never becomes a booking (hard rule 2): the design lead decides", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-13", { attendeePhoneHash: PHONE_HASH }));
    await runCall(w, "n2", {}, ext({ location: "Nashik" }));
    expect(alertsOf(w, "booking_not_fit")).toHaveLength(1);
    expect(w.bookings.bookings).toHaveLength(0);
    expect(w.notifier.handoffs).toHaveLength(0);
    expect((await w.repo.getCall("n2"))!.outcome).toBe("review");
  });
});

describe("failures never lose the call", () => {
  it("a router error does not fail the post-call pipeline; the item stays queued and the next tick finishes it", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-14", { attendeePhoneHash: PHONE_HASH }));
    const real = w.booking.recordExternalBooking.bind(w.booking);
    let fail = true;
    w.booking.recordExternalBooking = async (i) => { if (fail) throw new Error("telegram down"); return real(i); };
    const r = await runCall(w, "f1");
    expect(r.status).toBe("processed");
    expect((await w.repo.getCall("f1"))!.outcome).toBe("review");
    fail = false;
    await w.router.routePending();
    expect((await w.repo.getCall("f1"))!.outcome).toBe("booked");
    expect(w.bookings.bookings).toHaveLength(1);
  });
  it("the fifth consecutive failure marks the item failed and tells the owner (not Nikhil)", async () => {
    const w = makeWorld();
    await w.cal.upsert(calBooking("bk-15", { attendeePhoneHash: PHONE_HASH }));
    w.booking.recordExternalBooking = async () => { throw new Error("boom"); };
    await runCall(w, "f2");
    for (let i = 0; i < 6; i++) await w.router.routePending();
    const item = [...w.repo.outbox.values()].find((x) => x.kind === "call_routing")!;
    expect(item.status).toBe("failed");
    expect([...w.repo.outbox.values()].filter((x) => x.kind === "owner_alert")).toHaveLength(1);
    expect([...w.repo.outbox.values()].filter((x) => x.kind === "nikhil_alert")).toHaveLength(0);
  });
});
