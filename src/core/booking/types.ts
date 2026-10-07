export interface Interval { start: Date; end: Date }

export interface Designer {
  id: string;
  name: string;
  areas: string[];            // lower-case localities served; empty = everywhere
  projectTypes: string[];     // 'home' | 'office'
  calendarId: string | null;  // Google Calendar id; without one we cannot check free/busy
  telegramChatId: number | null;
  isPrincipal: boolean;
  isDesignLead: boolean;
  active: boolean;
  lastAssignedAt: Date | null; // rotation clock
  maxPerDay: number | null;
}

export type BookingStatus = "held" | "confirmed" | "cancelled" | "rescheduled" | "attended" | "no_show";

export interface Booking {
  id: string;
  enquiryId: string;
  designerId: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  calendarEventId: string | null;
  idempotencyKey: string | null;
  callerEmail: string | null;
  mode: string;
  wantsPrincipal: boolean;
}

export type HandoffStatus = "pending" | "sent" | "accepted" | "declined" | "timed_out" | "reassigned";

export interface HandoffRecord {
  id: string;
  bookingId: string;
  designerId: string;
  attemptNo: number;
  telegramMessageId: number | null;
  sentAt: Date | null;
  dueAt: Date;                // sent + 30 working minutes
  status: HandoffStatus;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  declineReason: string | null;
  reassignedToHandoffId: string | null;
  designLeadAlertedAt: Date | null;
}

// Operational parameters. The owner did not specify these; they are ASSUMPTIONS to confirm (docs/decisions-v1.md, Session 3).
export interface BookingConfig {
  slotMinutes: number;        // length of a consultation
  stepMinutes: number;        // granularity of offered start times
  bufferMinutes: number;      // required gap before and after any other event (travel / overrun)
  minLeadMinutes: number;     // earliest bookable time from now
  horizonDays: number;       // how far ahead we offer
  window: { days: number[]; open: string; close: string }; // IST; 0=Sun..6=Sat. Saturday bookable if a calendar is free (owner decision)
  maxOffer: number;           // slots read out to the caller
  handoffAcceptWorkingMinutes: number; // designer must accept within this many WORKING minutes
}

export const DEFAULT_BOOKING_CONFIG: BookingConfig = {
  slotMinutes: 60,
  stepMinutes: 30,
  bufferMinutes: 30,
  minLeadMinutes: 120,
  horizonDays: 14,
  window: { days: [1, 2, 3, 4, 5, 6], open: "10:00", close: "19:00" },
  maxOffer: 3,
  handoffAcceptWorkingMinutes: 30,
};
