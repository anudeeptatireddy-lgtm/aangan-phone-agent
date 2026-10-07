import { describe, it, expect, beforeEach } from "vitest";
import type { BookingRepo } from "@/core/booking/repo";

export interface RepoFixture {
  repo: BookingRepo;
  designerIds: [string, string];   // an active designer pair
  inactiveDesignerId?: string;
  enquiryIds: [string, string, string];
}

const t = (hhmm: string, day = "12") => new Date(`2026-10-${day}T${hhmm}:00+05:30`);
const hold = (f: RepoFixture, o: Partial<Parameters<BookingRepo["createHold"]>[0]> = {}) => ({
  enquiryId: f.enquiryIds[0], designerId: f.designerIds[0], startsAt: t("10:00"), endsAt: t("11:00"), idempotencyKey: `k-${Math.random()}`, mode: "site_visit", ...o });

/** The same behavioural contract runs against the in-memory repo, a real Postgres (PGlite) and the local Supabase. */
export function repoContract(name: string, make: () => Promise<RepoFixture>) {
  describe(`BookingRepo contract: ${name}`, () => {
    let f: RepoFixture;
    beforeEach(async () => { f = await make(); }, 60_000);

    it("lists active designers only, with mapped fields", async () => {
      const ds = await f.repo.listActiveDesigners();
      expect(ds.map((d) => d.id)).toEqual(expect.arrayContaining(f.designerIds));
      if (f.inactiveDesignerId) expect(ds.map((d) => d.id)).not.toContain(f.inactiveDesignerId);
      expect(ds[0]).toMatchObject({ active: true });
      expect(ds[0]!.areas).toBeInstanceOf(Array);
      expect(ds[0]!.projectTypes).toBeInstanceOf(Array);
    });
    it("creates a hold, then confirms it with a calendar event id", async () => {
      const r = await f.repo.createHold(hold(f));
      if (!r.ok) throw new Error("conflict");
      expect(r.booking).toMatchObject({ status: "held", designerId: f.designerIds[0] });
      const c = await f.repo.confirm(r.booking.id, "evt-1");
      expect(c).toMatchObject({ status: "confirmed", calendarEventId: "evt-1" });
      expect((await f.repo.getBooking(r.booking.id))!.status).toBe("confirmed");
    });
    it("an overlapping hold for the same designer conflicts (the double-booking guard)", async () => {
      expect((await f.repo.createHold(hold(f))).ok).toBe(true);
      expect(await f.repo.createHold(hold(f, { enquiryId: f.enquiryIds[1], startsAt: t("10:30"), endsAt: t("11:30") }))).toEqual({ ok: false, reason: "conflict" });
    });
    it("back-to-back slots and other designers do not conflict", async () => {
      expect((await f.repo.createHold(hold(f))).ok).toBe(true);
      expect((await f.repo.createHold(hold(f, { enquiryId: f.enquiryIds[1], startsAt: t("11:00"), endsAt: t("12:00") }))).ok).toBe(true);
      expect((await f.repo.createHold(hold(f, { enquiryId: f.enquiryIds[2], designerId: f.designerIds[1], startsAt: t("10:30"), endsAt: t("11:30") }))).ok).toBe(true);
    });
    it("a cancelled hold frees the slot", async () => {
      const r = await f.repo.createHold(hold(f));
      if (!r.ok) throw new Error();
      await f.repo.cancel(r.booking.id);
      expect((await f.repo.getBooking(r.booking.id))!.status).toBe("cancelled");
      expect((await f.repo.createHold(hold(f, { enquiryId: f.enquiryIds[1] }))).ok).toBe(true);
    });
    it("two truly simultaneous holds for the same slot: exactly one wins", async () => {
      const [a, b] = await Promise.all([f.repo.createHold(hold(f)), f.repo.createHold(hold(f, { enquiryId: f.enquiryIds[1] }))]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    });
    it("finds a booking by idempotency key, and the key is unique", async () => {
      const r = await f.repo.createHold(hold(f, { idempotencyKey: "same-key" }));
      if (!r.ok) throw new Error();
      expect((await f.repo.findByIdempotencyKey("same-key"))!.id).toBe(r.booking.id);
      expect(await f.repo.findByIdempotencyKey("nope")).toBeNull();
    });
    it("cancelling releases the idempotency key so a retry can book the same slot again", async () => {
      const r = await f.repo.createHold(hold(f, { idempotencyKey: "retry-key" }));
      if (!r.ok) throw new Error();
      await f.repo.cancel(r.booking.id);
      expect(await f.repo.findByIdempotencyKey("retry-key")).toBeNull();
      expect((await f.repo.createHold(hold(f, { idempotencyKey: "retry-key" }))).ok).toBe(true);
    });
    it("busyForDesigners returns held and confirmed bookings only, inside the range", async () => {
      const a = await f.repo.createHold(hold(f));
      const b = await f.repo.createHold(hold(f, { enquiryId: f.enquiryIds[1], startsAt: t("12:00"), endsAt: t("13:00") }));
      const c = await f.repo.createHold(hold(f, { enquiryId: f.enquiryIds[2], startsAt: t("15:00"), endsAt: t("16:00") }));
      if (!a.ok || !b.ok || !c.ok) throw new Error();
      await f.repo.cancel(b.booking.id);
      const busy = await f.repo.busyForDesigners(f.designerIds, t("00:00"), t("23:59"));
      expect((busy.get(f.designerIds[0]) ?? []).map((i) => i.start.toISOString())).toEqual([t("10:00"), t("15:00")].map((d) => d.toISOString()));
      expect(busy.get(f.designerIds[1]) ?? []).toEqual([]);
      expect((await f.repo.busyForDesigners(f.designerIds, t("00:00", "13"), t("23:59", "13"))).get(f.designerIds[0]) ?? []).toEqual([]);
    });
    it("countOnDay counts held and confirmed bookings starting inside the day window", async () => {
      await f.repo.createHold(hold(f));
      const x = await f.repo.createHold(hold(f, { enquiryId: f.enquiryIds[1], startsAt: t("12:00"), endsAt: t("13:00") }));
      if (!x.ok) throw new Error();
      await f.repo.cancel(x.booking.id);
      await f.repo.createHold(hold(f, { enquiryId: f.enquiryIds[2], startsAt: t("10:00", "13"), endsAt: t("11:00", "13") }));
      expect(await f.repo.countOnDay(f.designerIds[0], t("00:00"), t("23:59"))).toBe(1);
    });
    it("touchLastAssigned updates the rotation clock", async () => {
      await f.repo.touchLastAssigned(f.designerIds[0], t("09:00"));
      expect((await f.repo.listActiveDesigners()).find((d) => d.id === f.designerIds[0])!.lastAssignedAt!.toISOString()).toBe(t("09:00").toISOString());
    });
    it("records a handoff as pending, then marks it sent with the Telegram message id", async () => {
      const r = await f.repo.createHold(hold(f));
      if (!r.ok) throw new Error();
      const h = await f.repo.createHandoff({ bookingId: r.booking.id, designerId: f.designerIds[0], dueAt: t("11:00") });
      expect(h).toMatchObject({ status: "pending", telegramMessageId: null, sentAt: null, attemptNo: 1 });
      await f.repo.markHandoffSent(h.id, 4242, t("10:30"));
      const after = (await f.repo.getHandoff(h.id))!;
      expect(after).toMatchObject({ status: "sent", telegramMessageId: 4242 });
      expect(after.sentAt!.toISOString()).toBe(t("10:30").toISOString());
      expect(after.dueAt.toISOString()).toBe(t("11:00").toISOString());
    });
  });
}
