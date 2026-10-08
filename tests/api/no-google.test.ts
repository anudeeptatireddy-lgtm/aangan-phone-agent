import { describe, it, expect, beforeAll } from "vitest";
import { makeDeps, googleCalendarInUse } from "@/server/deps";
import type { Deps } from "@/server/deps";
import { september, ENC_KEY, World } from "../dashboard/fixture";
import { enquiry as enquiryRecord } from "../booking/helpers";

// Production, Google NOT configured, a real (PGlite) database, designers with no calendar id: the situation on the first real day.
const BASE = { PHONE_HASH_PEPPER: "pepper-0123456789ab", PHONE_ENC_KEY: ENC_KEY, TOOL_SHARED_SECRET: "tool-secret-0123456789" };
const START = new Date("2026-10-08T05:30:00Z"), END = new Date("2026-10-08T06:30:00Z");

describe("when Google is configured", () => {
  it("only a real key (or a non-production run, which uses the in-memory fake) counts as 'calendar in use'", () => {
    expect(googleCalendarInUse({ NODE_ENV: "production" })).toBe(false);
    expect(googleCalendarInUse({ NODE_ENV: "production", GOOGLE_SERVICE_ACCOUNT_JSON: "{}" })).toBe(true);
    expect(googleCalendarInUse({ NODE_ENV: "development" })).toBe(true);
    expect(googleCalendarInUse({ NODE_ENV: "test" })).toBe(true);
  });
});

describe("production without Google", () => {
  let w: World; let d: Deps; let enquiryId: string; let designers: string[];
  beforeAll(async () => {
    ({ w } = await september());
    await w.db.query("update designers set active=false where is_test");
    designers = [];
    for (const [n, chat] of [["Asha", 5001], ["Bela", 5002], ["Chitra", 5003]] as const)
      designers.push(((await w.db.query("insert into designers(name, areas, project_types, calendar_id, telegram_chat_id, active, is_test) values ($1,'{}',array['home','office'],null,$2,true,false) returning id", [n, chat])).rows[0] as { id: string }).id);
    d = makeDeps({ env: { ...BASE, NODE_ENV: "production" }, now: () => new Date("2026-10-07T05:00:00Z"), db: w.db });
    enquiryId = await w.enquiry({ fit: "fit", location: "Kothrud", projectType: "home" });
  }, 120_000);

  it("a booking gets a designer even though no designer has a calendar id", async () => {
    const e = { ...enquiryRecord({ id: enquiryId }), input: { ...enquiryRecord().input } };
    const r = await d.booking.recordExternalBooking({ enquiry: e, start: START, end: END, externalId: "cal-prod-1" });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(designers).toContain(r.designerId);
    const b = (await d.bookingRepo.findByIdempotencyKey("cal:cal-prod-1"))!;
    expect(b).toMatchObject({ status: "confirmed", calendarEventId: "cal-prod-1" });
  });

  it("a designer who does not accept is replaced by the next designer (no Google), and the booking keeps its Cal.com id", async () => {
    const b = (await d.bookingRepo.findByIdempotencyKey("cal:cal-prod-1"))!;
    const [h] = await d.bookingRepo.handoffsForBooking(b.id);
    const r = await d.handoff.reassign(h!.id, "timed_out");
    expect(r.ok).toBe(true);
    const hs = await d.bookingRepo.handoffsForBooking(b.id);
    expect(hs.map((x) => x.attemptNo)).toEqual([1, 2]);
    expect(hs[1]!.designerId).not.toBe(hs[0]!.designerId);
    const after = (await d.bookingRepo.getBooking(b.id))!;
    expect(after.designerId).toBe(hs[1]!.designerId);
    expect(after.calendarEventId).toBe("cal-prod-1");
  });

  it("dev and test runs are unchanged: a designer with no calendar is still not offered a booking there (the fake calendar is in use)", async () => {
    const dev = makeDeps({ env: { ...BASE, NODE_ENV: "development" }, now: () => new Date("2026-10-07T05:00:00Z"), db: w.db });
    const e2 = await w.enquiry({ fit: "fit", location: "Kothrud", projectType: "home" });
    const r = await dev.booking.recordExternalBooking({ enquiry: { ...enquiryRecord({ id: e2 }) }, start: new Date("2026-10-09T05:30:00Z"), end: new Date("2026-10-09T06:30:00Z"), externalId: "cal-dev-1" });
    expect(r).toEqual({ ok: false, error: "no_designer" });
  });
});
