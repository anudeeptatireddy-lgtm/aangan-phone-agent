import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { makeDeps, Deps } from "@/server/deps";
import { hashPhone } from "@/lib/phone";
import { handleCalcomWebhook } from "@/server/handlers/calcom-webhook";

const SECRET = "cal-signing-secret-0123456789";
const NOW = new Date("2026-10-07T05:10:00Z");
let d: Deps;
beforeEach(() => { d = makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789", CALCOM_SIGNING_SECRET: SECRET }, now: () => NOW }); });

const created = (o: Record<string, unknown> = {}) => ({ triggerEvent: "BOOKING_CREATED", createdAt: "2026-10-07T05:03:00.000Z", payload: {
  uid: "bk-1", startTime: "2026-10-08T05:30:00Z", endTime: "2026-10-08T06:30:00Z", title: "Aangan consultation between Aangan and Priya", eventTypeId: 7, status: "ACCEPTED", bookingId: 100,
  attendees: [{ email: "Priya@Example.com", name: "Priya Shah", phoneNumber: "+919876543210" }], ...o } });
const send = (body: unknown, o: { sig?: string | null; raw?: string } = {}) => {
  const raw = o.raw ?? JSON.stringify(body);
  const sig = o.sig === undefined ? createHmac("sha256", SECRET).update(raw).digest("hex") : o.sig;
  return handleCalcomWebhook(new Request("http://localhost/api/calcom/webhook", { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-cal-signature-256": sig } : {}) }, body: raw }), d);
};

describe("POST /api/calcom/webhook", () => {
  it("503 with no signing secret configured; 401 for a missing or wrong signature (nothing is stored)", async () => {
    const d2 = makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789" }, now: () => NOW });
    expect((await handleCalcomWebhook(new Request("http://x", { method: "POST", body: "{}" }), d2)).status).toBe(503);
    expect((await send(created(), { sig: null })).status).toBe(401);
    expect((await send(created(), { sig: "deadbeef" })).status).toBe(401);
    expect(await d.calStore.get("bk-1")).toBeNull();
  });
  it("the signature covers the exact body: a tampered body is rejected", async () => {
    const good = JSON.stringify(created());
    const sig = createHmac("sha256", SECRET).update(good).digest("hex");
    expect((await send(null, { raw: good.replace("bk-1", "bk-2"), sig })).status).toBe(401);
  });
  it("stores a created booking (email lower-cased, phone only as a hash)", async () => {
    expect((await send(created())).status).toBe(200);
    const b = (await d.calStore.get("bk-1"))!;
    expect(b).toMatchObject({ status: "accepted", attendeeEmail: "priya@example.com", attendeeName: "Priya Shah", eventTypeId: 7, claimedByCall: null });
    expect(b.startsAt.toISOString()).toBe("2026-10-08T05:30:00.000Z");
    expect(b.createdAt.toISOString()).toBe("2026-10-07T05:03:00.000Z");
    expect(b.attendeePhoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(b)).not.toContain("9876543210");
  });
  it("a repeated delivery is harmless", async () => {
    await send(created()); await send(created());
    expect((await d.calStore.findUnclaimed(new Date("2026-10-07T05:00:00Z"), new Date("2026-10-07T06:00:00Z")))).toHaveLength(1);
  });
  it("a cancellation updates the status", async () => {
    await send(created());
    await send({ ...created(), triggerEvent: "BOOKING_CANCELLED", payload: { ...created().payload, status: "CANCELLED" } });
    expect((await d.calStore.get("bk-1"))!.status).toBe("cancelled");
  });
  it("a cancellation of a booking already tied to a call alerts the design lead (queued, not lost)", async () => {
    await send(created());
    await d.calStore.claim("bk-1", "call-1");
    await send({ ...created(), triggerEvent: "BOOKING_CANCELLED", payload: { ...created().payload, status: "CANCELLED" } });
    const alerts = await d.postcall.pendingOutbox(["design_lead_alert"], 10);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({ kind: "booking_cancelled", vendorCallId: "call-1" });
  });
  it("other triggers and junk are acknowledged and ignored; invalid JSON is a 400", async () => {
    expect((await send({ triggerEvent: "MEETING_ENDED", payload: {} })).status).toBe(200);
    expect((await send({ triggerEvent: "BOOKING_CREATED", payload: { uid: "x" } })).status).toBe(200); // incomplete: ignored
    expect(await d.calStore.get("x")).toBeNull();
    const raw = "{not json";
    expect((await send(null, { raw, sig: createHmac("sha256", SECRET).update(raw).digest("hex") })).status).toBe(400);
  });

  describe("routing is also triggered from this side", () => {
    const seedCall = async (id = "call-w") => {
      const caller = await d.postcall.upsertCaller({ phone: "+919876543210", email: "priya@example.com" });
      const e = await d.postcall.upsertEnquiry({ id: `enq-${id}`, callerId: caller.id, fit: "fit", reasonCodes: [], flags: [], ruleVersion: "v1",
        input: { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, decision_maker: "owner" } as never });
      await d.postcall.upsertCall(id, { callerId: caller.id, enquiryId: e.id, rangAt: new Date("2026-10-07T05:00:00Z"), endedAt: new Date("2026-10-07T05:06:00Z"), postCallStatus: "processed", processedAt: NOW });
      await d.postcall.enqueue("call_routing", { vendorCallId: id, enquiryId: e.id, claimedBooking: true }, `call_routing:${id}`);
    };
    it("a booking that arrives after the call was processed is matched at once", async () => {
      await seedCall();
      expect((await send(created())).status).toBe(200); // createdAt 05:03, attendee phone +919876543210
      expect((await d.calStore.get("bk-1"))!.claimedByCall).toBe("call-w");
      expect((await d.postcall.getCall("call-w"))!.outcome).toBe("booked");
    });
    it("phone numbers are normalised to E.164 before hashing: '98765 43210' meets +919876543210", async () => {
      await seedCall();
      await send(created({ attendees: [{ email: "someone@else.com", name: "X", phoneNumber: "98765 43210" }] }));
      const b = (await d.calStore.get("bk-1"))!;
      expect(b.attendeePhoneHash).toBe(hashPhone("+919876543210", "pepper-0123456789ab"));
      expect(b.claimedByCall).toBe("call-w");
    });
    it("the matched booking's handoff can be reassigned after 30 working minutes (the enquiry comes from post-call storage)", async () => {
      await seedCall();
      await send(created());
      const bookingId = (await d.bookingRepo.findByIdempotencyKey("cal:bk-1"))!.id;
      const [h] = await d.bookingRepo.handoffsForBooking(bookingId);
      const later = new Date(h!.dueAt.getTime() + 60_000);
      (d.handoff as unknown as { d: { now: () => Date } }).d.now = () => later;
      expect((await d.handoff.sweep()).timedOut).toBe(1);
      const all = await d.bookingRepo.handoffsForBooking(bookingId);
      expect(all).toHaveLength(2);
      expect(all[1]!.designerId).not.toBe(all[0]!.designerId);
    });
    it("a router failure never fails the webhook (Cal.com would retry and the booking is already stored)", async () => {
      d.router.routePending = async () => { throw new Error("db down"); };
      expect((await send(created())).status).toBe(200);
      expect(await d.calStore.get("bk-1")).not.toBeNull();
    });
    it("a cancellation does not trigger routing", async () => {
      let n = 0; d.router.routePending = async () => { n++; return { booked: 0, waiting: 0, flagged: 0, closed: 0, orphans: 0, errors: 0 }; };
      await send({ ...created(), triggerEvent: "BOOKING_CANCELLED", payload: { ...created().payload, status: "CANCELLED" } });
      expect(n).toBe(0);
    });
  });
});
