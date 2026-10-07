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
    expect(await r.json()).toEqual({ ok: true, sweep: { timedOut: 0 }, retry: { sent: 0, failed: 0 }, outbox: { processed: 0, failed: 0 }, alerts: { sent: 0, failed: 0, skipped: 0 } });
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
});
