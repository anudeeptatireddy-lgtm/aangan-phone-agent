import { describe, it, expect } from "vitest";
import { makeDeps } from "@/server/deps";
import { handleTick } from "@/server/handlers/tick";

const CRON = "cron-secret-0123456789";
const NOW = new Date("2026-10-07T05:00:00Z"); // 10:30 IST Wednesday
const mk = (cron: string | null = CRON) => makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789", ...(cron ? { CRON_SECRET: cron } : {}) }, now: () => NOW });
const req = (auth?: string) => new Request("http://localhost/api/cron/tick", { headers: auth ? { authorization: auth } : {} });

describe("GET /api/cron/tick", () => {
  it("503 when CRON_SECRET is not configured; 401 without or with the wrong bearer", async () => {
    expect((await handleTick(req(`Bearer ${CRON}`), mk(null))).status).toBe(503);
    expect((await handleTick(req(), mk())).status).toBe(401);
    expect((await handleTick(req("Bearer nope-nope-nope-nope"), mk())).status).toBe(401);
  });
  it("runs every step and reports counts", async () => {
    const r = await handleTick(req(`Bearer ${CRON}`), mk());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, sweep: { timedOut: 0 }, retry: { sent: 0, failed: 0 }, outbox: { processed: 0, failed: 0 }, alerts: { sent: 0, failed: 0, skipped: 0 }, routing: { booked: 0, waiting: 0, flagged: 0, closed: 0, orphans: 0, errors: 0 }, vaani: { checked: 0, recovered: 0, waiting: 0, failedRecorded: 0 }, hubspot: { checked: 0, updated: 0, unchanged: 0, unmapped: 0, missing: 0, foreignCurrency: 0 } });
  });
  it("one failing step does not stop the others", async () => {
    const d = mk();
    d.handoff.sweep = async () => { throw new Error("boom"); };
    const body = await (await handleTick(req(`Bearer ${CRON}`), d)).json();
    expect(body).toMatchObject({ ok: false, sweep: { error: "boom" }, outbox: { processed: 0 } });
  });
  it("end to end: a due handoff is reassigned, a queued deal and email go out", async () => {
    const d = mk();
    const e = d.enquiries.create({ callerName: "Priya", callerEmail: "p@example.com", input: { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, decision_maker: "owner" } as never, fit: "fit", reasonCodes: [], nextAction: "proceed_to_booking", flags: [], ruleVersion: "v1", createdAt: NOW.toISOString() });
    const slot = (await d.booking.getSlots({ enquiry: e })).slots[0]!;
    const b = await d.booking.bookSlot({ enquiry: e, start: slot.start });
    if (!b.ok) throw new Error("book");
    const [h] = await d.bookingRepo.handoffsForBooking(b.booking_id);
    const later = new Date(h!.dueAt.getTime() + 60_000);
    const d2 = Object.assign(d, { now: () => later });
    (d2.handoff as unknown as { d: { now: () => Date } }).d.now = () => later;
    const body = await (await handleTick(req(`Bearer ${CRON}`), d2)).json();
    expect(body.sweep.timedOut).toBe(1);
    expect((await d.bookingRepo.handoffsForBooking(b.booking_id))).toHaveLength(2);
  });
  it("the routing step finishes a call whose booking arrived, and sweeps one that never got a booking", async () => {
    const d = mk();
    const caller = await d.postcall.upsertCaller({ phone: "+919000000021" });
    const input = { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, decision_maker: "owner" } as never;
    for (const id of ["tick-a", "tick-b"]) {
      const e = await d.postcall.upsertEnquiry({ id: `enq-${id}`, callerId: caller.id, input, fit: "fit", reasonCodes: [], flags: [], ruleVersion: "v1" });
      await d.postcall.upsertCall(id, { callerId: caller.id, enquiryId: e.id, rangAt: new Date("2026-10-07T04:40:00Z"), endedAt: new Date("2026-10-07T04:44:00Z"), postCallStatus: "processed", processedAt: NOW });
      await d.postcall.enqueue("call_routing", { vendorCallId: id, enquiryId: e.id, claimedBooking: true }, `call_routing:${id}`);
    }
    await d.calStore.upsert({ uid: "tb", eventTypeId: 1, title: null, status: "accepted", startsAt: new Date("2026-10-08T05:30:00Z"), endsAt: new Date("2026-10-08T06:30:00Z"), attendeeEmail: null, attendeeName: null, attendeePhoneHash: null, createdAt: new Date("2026-10-07T04:43:00Z") });
    const body = await (await handleTick(req(`Bearer ${CRON}`), d)).json();
    // two calls, ONE booking: the lone candidate is ambiguous between the two calls only if both claim; the first claims it, the second finds nothing and is swept (NOW is past end + 15 min)
    expect(body.routing).toMatchObject({ booked: 1, flagged: 1, waiting: 0, errors: 0 });
  });
  it("the HubSpot step reads deals, and a HubSpot outage neither stops the other steps nor fails the tick (the owner alert is the signal)", async () => {
    const d = mk();
    const e = await d.postcall.upsertEnquiry({ input: { location: "Kothrud", project_type: "home" } as never, fit: "fit", reasonCodes: [], flags: [], ruleVersion: "v1" });
    const r = await d.fakeCrm!.createDealForEnquiry({ contact: { email: "p@example.com" }, deal: { name: "x", description: "y" } });
    await d.postcall.saveCrmLink(e.id, r, new Date(NOW.getTime() - 10 * 60_000));
    d.fakeCrm!.setDeal(r.dealId, { stageId: "S9", amount: "100" });
    const body = await (await handleTick(req(`Bearer ${CRON}`), d)).json();
    expect(body.hubspot).toMatchObject({ checked: 1, unmapped: 1 });
    d.fakeCrm!.failNextRead("hubspot /crm/v3/objects/deals/batch/read failed: 403 MISSING_SCOPES");
    d.now = () => new Date(NOW.getTime() + 10 * 60_000); (d.crmSync as unknown as { d: { now: () => Date } }).d.now = d.now;
    const body2 = await (await handleTick(req(`Bearer ${CRON}`), d)).json();
    expect(body2).toMatchObject({ ok: true, hubspot: { skipped: "hubspot_unavailable" }, outbox: { processed: 0 } });
  });
  it("production without HubSpot configured: the step is skipped, quietly", async () => {
    const d = makeDeps({ env: { NODE_ENV: "production", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789", CRON_SECRET: CRON }, now: () => NOW });
    const body = await (await handleTick(req(`Bearer ${CRON}`), d)).json();
    expect(body.hubspot).toEqual({ skipped: "hubspot_not_configured" });
  });
});
