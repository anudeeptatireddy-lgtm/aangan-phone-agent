import { randomUUID } from "node:crypto";
import type { BookingRepo, HoldResult, NewHold } from "@/core/booking/repo";
import type { Booking, Designer, HandoffRecord, Interval } from "@/core/booking/types";

const live = (b: Booking) => b.status === "held" || b.status === "confirmed";

/** Local-dev / test store with the same conflict semantics as the Postgres exclusion constraint. */
export class InMemoryBookingRepo implements BookingRepo {
  bookings: Booking[] = [];
  handoffs: HandoffRecord[] = [];
  private designers: Designer[];

  constructor(designers: Designer[]) { this.designers = designers.map((d) => ({ ...d })); }

  async listActiveDesigners() { return this.designers.filter((d) => d.active).map((d) => ({ ...d })); }

  async busyForDesigners(ids: string[], from: Date, to: Date) {
    const out = new Map<string, Interval[]>();
    for (const id of ids) {
      out.set(id, this.bookings
        .filter((b) => b.designerId === id && live(b) && b.startsAt < to && b.endsAt > from)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .map((b) => ({ start: b.startsAt, end: b.endsAt })));
    }
    return out;
  }

  async countOnDay(designerId: string, dayStart: Date, dayEnd: Date) {
    return this.bookings.filter((b) => b.designerId === designerId && live(b) && b.startsAt >= dayStart && b.startsAt < dayEnd).length;
  }

  async createHold(h: NewHold): Promise<HoldResult> {
    // Synchronous check-and-insert: no await between them, so concurrent callers cannot both pass.
    if (this.bookings.some((b) => b.designerId === h.designerId && live(b) && b.startsAt < h.endsAt && b.endsAt > h.startsAt)) return { ok: false, reason: "conflict" };
    if (this.bookings.some((b) => b.idempotencyKey === h.idempotencyKey)) return { ok: false, reason: "conflict" };
    const booking: Booking = { id: randomUUID(), enquiryId: h.enquiryId, designerId: h.designerId, startsAt: h.startsAt, endsAt: h.endsAt, status: "held",
      calendarEventId: null, idempotencyKey: h.idempotencyKey, callerEmail: h.callerEmail ?? null, mode: h.mode };
    this.bookings.push(booking);
    return { ok: true, booking: { ...booking } };
  }

  private must(id: string) {
    const b = this.bookings.find((x) => x.id === id);
    if (!b) throw new Error(`booking ${id} not found`);
    return b;
  }
  async confirm(id: string, calendarEventId: string) {
    const b = this.must(id); b.status = "confirmed"; b.calendarEventId = calendarEventId; return { ...b };
  }
  async cancel(id: string) { const b = this.must(id); b.status = "cancelled"; b.idempotencyKey = null; }
  async getBooking(id: string) { const b = this.bookings.find((x) => x.id === id); return b ? { ...b } : null; }
  async findByIdempotencyKey(key: string) { const b = this.bookings.find((x) => x.idempotencyKey === key && live(x)); return b ? { ...b } : null; }

  async touchLastAssigned(designerId: string, at: Date) {
    const d = this.designers.find((x) => x.id === designerId);
    if (d) d.lastAssignedAt = at;
  }

  async createHandoff(h: { bookingId: string; designerId: string; dueAt: Date }) {
    const rec: HandoffRecord = { id: randomUUID(), bookingId: h.bookingId, designerId: h.designerId, attemptNo: 1, telegramMessageId: null, sentAt: null, dueAt: h.dueAt, status: "pending" };
    this.handoffs.push(rec);
    return { ...rec };
  }
  async markHandoffSent(id: string, telegramMessageId: number, sentAt: Date) {
    const h = this.handoffs.find((x) => x.id === id);
    if (h) Object.assign(h, { telegramMessageId, sentAt, status: "sent" });
  }
  async getHandoff(id: string) { const h = this.handoffs.find((x) => x.id === id); return h ? { ...h } : null; }
}
