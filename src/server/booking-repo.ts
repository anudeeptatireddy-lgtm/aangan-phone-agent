import { randomUUID } from "node:crypto";
import type { BookingRepo, HoldResult, NewHold } from "@/core/booking/repo";
import type { Booking, Designer, HandoffRecord, HandoffStatus, Interval } from "@/core/booking/types";

const live = (b: Booking) => b.status === "held" || b.status === "confirmed";

/** Local-dev / test store with the same conflict semantics as the Postgres exclusion constraint. */
export class InMemoryBookingRepo implements BookingRepo {
  bookings: Booking[] = [];
  handoffs: HandoffRecord[] = [];
  private designers: Designer[];

  constructor(designers: Designer[]) { this.designers = designers.map((d) => ({ ...d })); }

  async getDesigner(id: string) { const d = this.designers.find((x) => x.id === id); return d ? { ...d } : null; }

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
      calendarEventId: null, idempotencyKey: h.idempotencyKey, callerEmail: h.callerEmail ?? null, mode: h.mode, wantsPrincipal: h.wantsPrincipal ?? false };
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
  async markConsultationHeld(enquiryId: string) { let n = 0; for (const b of this.bookings) if (b.enquiryId === enquiryId && b.status === "confirmed") { b.status = "attended"; n++; } return n; }
  async cancel(id: string) { const b = this.must(id); b.status = "cancelled"; b.idempotencyKey = null; }
  async getBooking(id: string) { const b = this.bookings.find((x) => x.id === id); return b ? { ...b } : null; }
  async bookingForEnquiry(enquiryId: string) { const b = this.bookings.find((x) => x.enquiryId === enquiryId && live(x)); return b ? { ...b } : null; }
  async findByIdempotencyKey(key: string) { const b = this.bookings.find((x) => x.idempotencyKey === key && live(x)); return b ? { ...b } : null; }

  async touchLastAssigned(designerId: string, at: Date) {
    const d = this.designers.find((x) => x.id === designerId);
    if (d) d.lastAssignedAt = at;
  }

  async createHandoff(h: { bookingId: string; designerId: string; dueAt: Date; attemptNo?: number }) {
    const rec: HandoffRecord = { id: randomUUID(), bookingId: h.bookingId, designerId: h.designerId, attemptNo: h.attemptNo ?? 1, telegramMessageId: null, sentAt: null, dueAt: h.dueAt, status: "pending",
      acceptedAt: null, declinedAt: null, declineReason: null, reassignedToHandoffId: null, designLeadAlertedAt: null };
    this.handoffs.push(rec);
    return { ...rec };
  }
  async markHandoffSent(id: string, telegramMessageId: number, sentAt: Date) {
    const h = this.handoffs.find((x) => x.id === id);
    if (h) Object.assign(h, { telegramMessageId, sentAt, status: "sent" });
  }
  async getHandoff(id: string) { const h = this.handoffs.find((x) => x.id === id); return h ? { ...h } : null; }
  async handoffsForBooking(bookingId: string) {
    return this.handoffs.filter((x) => x.bookingId === bookingId).sort((a, b) => a.attemptNo - b.attemptNo).map((x) => ({ ...x }));
  }
  async listHandoffsByStatus(statuses: HandoffStatus[]) { return this.handoffs.filter((x) => statuses.includes(x.status)).map((x) => ({ ...x })); }
  async transitionHandoff(id: string, from: HandoffStatus[], to: HandoffStatus, at: Date, declineReason?: string) {
    // Synchronous check-and-set: no await between them, so only one racer wins.
    const h = this.handoffs.find((x) => x.id === id);
    if (!h || !from.includes(h.status)) return false;
    h.status = to;
    if (to === "accepted") h.acceptedAt = at;
    if (to === "declined") { h.declinedAt = at; h.declineReason = declineReason ?? null; }
    return true;
  }
  async linkReassignedHandoff(oldId: string, newId: string) { const h = this.handoffs.find((x) => x.id === oldId); if (h) h.reassignedToHandoffId = newId; }
  async markDesignLeadAlerted(id: string, at: Date) { const h = this.handoffs.find((x) => x.id === id); if (h) h.designLeadAlertedAt = at; }
  async reassignBooking(bookingId: string, newDesignerId: string, calendarEventId: string) {
    const b = this.must(bookingId);
    if (this.bookings.some((x) => x.id !== b.id && x.designerId === newDesignerId && live(x) && x.startsAt < b.endsAt && x.endsAt > b.startsAt)) return { ok: false as const, reason: "conflict" as const };
    b.designerId = newDesignerId; b.calendarEventId = calendarEventId;
    return { ok: true as const, booking: { ...b } };
  }
}
