import type { CalBooking, CalBookingStore, CalStatus } from "@/core/calcom/types";
import type { SqlClient } from "./pg-booking-repo";

const date = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const of = (r: Record<string, unknown>): CalBooking => ({
  uid: r.uid as string, eventTypeId: r.event_type_id == null ? null : Number(r.event_type_id), title: (r.title as string) ?? null, status: r.status as CalStatus,
  startsAt: date(r.starts_at), endsAt: date(r.ends_at), attendeeEmail: (r.attendee_email as string) ?? null, attendeeName: (r.attendee_name as string) ?? null,
  attendeePhoneHash: (r.attendee_contact_hash as string) ?? null, createdAt: date(r.created_at), claimedByCall: (r.claimed_by_call as string) ?? null,
});

export class PgCalBookingStore implements CalBookingStore {
  constructor(private db: SqlClient) {}
  async upsert(b: Omit<CalBooking, "claimedByCall">) {
    await this.db.query(
      `insert into calcom_bookings(uid, event_type_id, title, status, starts_at, ends_at, attendee_email, attendee_name, attendee_contact_hash, created_at)
       values ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8,$9,$10::timestamptz)
       on conflict (uid) do update set event_type_id=excluded.event_type_id, title=excluded.title, status=excluded.status, starts_at=excluded.starts_at, ends_at=excluded.ends_at,
         attendee_email=excluded.attendee_email, attendee_name=excluded.attendee_name, attendee_contact_hash=excluded.attendee_contact_hash`,
      [b.uid, b.eventTypeId, b.title, b.status, b.startsAt.toISOString(), b.endsAt.toISOString(), b.attendeeEmail, b.attendeeName, b.attendeePhoneHash, b.createdAt.toISOString()]);
  }
  async get(uid: string) { const { rows } = await this.db.query("select * from calcom_bookings where uid=$1", [uid]); return rows[0] ? of(rows[0]) : null; }
  async findUnclaimed(from: Date, to: Date) {
    const { rows } = await this.db.query("select * from calcom_bookings where status='accepted' and claimed_by_call is null and created_at >= $1::timestamptz and created_at <= $2::timestamptz order by created_at", [from.toISOString(), to.toISOString()]);
    return rows.map(of);
  }
  async claim(uid: string, vendorCallId: string) {
    const { rows } = await this.db.query("update calcom_bookings set claimed_by_call=$2 where uid=$1 and (claimed_by_call is null or claimed_by_call=$2) returning uid", [uid, vendorCallId]);
    return rows.length === 1;
  }
  async forCall(vendorCallId: string) { const { rows } = await this.db.query("select * from calcom_bookings where claimed_by_call=$1 limit 1", [vendorCallId]); return rows[0] ? of(rows[0]) : null; }
}
