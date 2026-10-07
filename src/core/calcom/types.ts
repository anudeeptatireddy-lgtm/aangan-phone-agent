export type CalStatus = "accepted" | "cancelled" | "pending" | "rejected" | "rescheduled";

/** A booking made through Vaani's Cal.com integration, as reported by Cal.com's own webhook (the only trusted evidence that one exists). */
export interface CalBooking {
  uid: string;
  eventTypeId: number | null;
  title: string | null;
  status: CalStatus;
  startsAt: Date;
  endsAt: Date;
  attendeeEmail: string | null;
  attendeeName: string | null;
  attendeePhoneHash: string | null; // HMAC of the E.164 number; the number itself is not stored here
  createdAt: Date;                  // when Cal.com created it: used to match it to the call that was in progress
  claimedByCall: string | null;     // vendor call id
}

export interface CalBookingStore {
  /** Insert or update by uid. Never touches claimedByCall. */
  upsert(b: Omit<CalBooking, "claimedByCall">): Promise<void>;
  get(uid: string): Promise<CalBooking | null>;
  /** Accepted, unclaimed bookings created in [from, to]. */
  findUnclaimed(from: Date, to: Date): Promise<CalBooking[]>;
  /** Atomically claim for a call; false if someone else already did. */
  claim(uid: string, vendorCallId: string): Promise<boolean>;
  forCall(vendorCallId: string): Promise<CalBooking | null>;
}
