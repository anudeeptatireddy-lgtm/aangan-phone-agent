import type { Booking, Designer, HandoffRecord, Interval } from "./types";

export interface NewHold {
  enquiryId: string;
  designerId: string;
  startsAt: Date;
  endsAt: Date;
  idempotencyKey: string;
  callerEmail?: string | null;
  mode: string;
}
export type HoldResult = { ok: true; booking: Booking } | { ok: false; reason: "conflict" };

/**
 * Persistence for designers, bookings and handoffs. `createHold` is the double-booking guard: in Postgres it is an exclusion
 * constraint, so two simultaneous holds for the same designer and time cannot both succeed.
 */
export interface BookingRepo {
  listActiveDesigners(): Promise<Designer[]>;
  /** Held + confirmed bookings overlapping [from, to), per designer, sorted by start. */
  busyForDesigners(designerIds: string[], from: Date, to: Date): Promise<Map<string, Interval[]>>;
  /** Held + confirmed bookings STARTING inside [dayStart, dayEnd). */
  countOnDay(designerId: string, dayStart: Date, dayEnd: Date): Promise<number>;
  createHold(h: NewHold): Promise<HoldResult>;
  confirm(bookingId: string, calendarEventId: string): Promise<Booking>;
  /** Frees the slot and releases the idempotency key. */
  cancel(bookingId: string): Promise<void>;
  getBooking(id: string): Promise<Booking | null>;
  /** The live (held or confirmed) booking for an enquiry, if any. */
  bookingForEnquiry(enquiryId: string): Promise<Booking | null>;
  findByIdempotencyKey(key: string): Promise<Booking | null>;
  touchLastAssigned(designerId: string, at: Date): Promise<void>;
  createHandoff(h: { bookingId: string; designerId: string; dueAt: Date }): Promise<HandoffRecord>;
  markHandoffSent(handoffId: string, telegramMessageId: number, sentAt: Date): Promise<void>;
  getHandoff(id: string): Promise<HandoffRecord | null>;
}
