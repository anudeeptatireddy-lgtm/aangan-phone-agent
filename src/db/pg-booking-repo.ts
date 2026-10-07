import type { BookingRepo, HoldResult, NewHold } from "@/core/booking/repo";
import { SCOPE } from "./scope";
import type { Booking, BookingStatus, Designer, HandoffRecord, HandoffStatus, Interval } from "@/core/booking/types";

/** Anything with a node-postgres-shaped `query` (pg.Client, pg.Pool, PGlite). */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

const iso = (d: Date) => d.toISOString();
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

const bookingOf = (r: Record<string, unknown>): Booking => ({
  id: r.id as string, enquiryId: r.enquiry_id as string, designerId: r.designer_id as string,
  startsAt: date(r.starts_at)!, endsAt: date(r.ends_at)!, status: r.status as BookingStatus,
  calendarEventId: (r.calendar_event_id as string | null) ?? null, idempotencyKey: (r.idempotency_key as string | null) ?? null,
  callerEmail: (r.caller_email as string | null) ?? null, mode: (r.mode as string | null) ?? "site_visit", wantsPrincipal: !!r.wants_principal,
});
const handoffOf = (r: Record<string, unknown>): HandoffRecord => ({
  id: r.id as string, bookingId: r.booking_id as string, designerId: r.designer_id as string, attemptNo: Number(r.attempt_no),
  telegramMessageId: num(r.telegram_message_id), sentAt: date(r.sent_at), dueAt: date(r.due_at)!, status: r.status as HandoffStatus,
  acceptedAt: date(r.accepted_at), declinedAt: date(r.declined_at), declineReason: (r.decline_reason as string | null) ?? null,
  reassignedToHandoffId: (r.reassigned_to_handoff_id as string | null) ?? null, designLeadAlertedAt: date(r.design_lead_alerted_at),
});

const DESIGNER_COLS = "select id, name, areas, project_types, calendar_id, telegram_chat_id, is_principal, is_design_lead, active, last_assigned_at, max_per_day from designers";
const designerOf = (r: Record<string, unknown>): Designer => ({
  id: r.id as string, name: r.name as string, areas: (r.areas as string[]) ?? [], projectTypes: (r.project_types as string[]) ?? [],
  calendarId: (r.calendar_id as string | null) ?? null, telegramChatId: num(r.telegram_chat_id), isPrincipal: r.is_principal as boolean,
  isDesignLead: r.is_design_lead as boolean, active: r.active as boolean, lastAssignedAt: date(r.last_assigned_at), maxPerDay: num(r.max_per_day),
});

const isConflict = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return x?.code === "23P01" || x?.code === "23505" || /exclusion constraint|duplicate key/i.test(x?.message ?? "");
};

/** Postgres implementation. `createHold` relies on the `no_double_booking` exclusion constraint, the real guard against races. */
export class PgBookingRepo implements BookingRepo {
  constructor(private db: SqlClient) {}

  async listActiveDesigners(): Promise<Designer[]> {
    const { rows } = await this.db.query(`${DESIGNER_COLS} where active = true and is_demo = ${SCOPE} order by name`);
    return rows.map(designerOf);
  }
  async getDesigner(id: string): Promise<Designer | null> {
    const { rows } = await this.db.query(`${DESIGNER_COLS} where id = $1`, [id]);
    return rows[0] ? designerOf(rows[0]) : null;
  }

  async busyForDesigners(ids: string[], from: Date, to: Date) {
    const out = new Map<string, Interval[]>(ids.map((i) => [i, []]));
    if (!ids.length) return out;
    const { rows } = await this.db.query(
      "select designer_id, starts_at, ends_at from bookings where designer_id = any($1::uuid[]) and status in ('held','confirmed') and starts_at < $3::timestamptz and ends_at > $2::timestamptz order by starts_at",
      [ids, iso(from), iso(to)]);
    for (const r of rows) out.get(r.designer_id as string)!.push({ start: date(r.starts_at)!, end: date(r.ends_at)! });
    return out;
  }

  async countOnDay(designerId: string, dayStart: Date, dayEnd: Date) {
    const { rows } = await this.db.query(
      "select count(*)::int as n from bookings where designer_id = $1 and status in ('held','confirmed') and starts_at >= $2::timestamptz and starts_at < $3::timestamptz",
      [designerId, iso(dayStart), iso(dayEnd)]);
    return Number(rows[0]!.n);
  }

  async createHold(h: NewHold): Promise<HoldResult> {
    try {
      const { rows } = await this.db.query(
        "insert into bookings(enquiry_id, designer_id, starts_at, ends_at, status, booked_on_call, caller_email, mode, idempotency_key, wants_principal) values ($1,$2,$3::timestamptz,$4::timestamptz,'held',true,$5,$6,$7,$8) returning *",
        [h.enquiryId, h.designerId, iso(h.startsAt), iso(h.endsAt), h.callerEmail ?? null, h.mode, h.idempotencyKey, h.wantsPrincipal ?? false]);
      return { ok: true, booking: bookingOf(rows[0]!) };
    } catch (e) {
      if (isConflict(e)) return { ok: false, reason: "conflict" };
      throw e;
    }
  }

  async confirm(id: string, calendarEventId: string) {
    const { rows } = await this.db.query("update bookings set status='confirmed', calendar_event_id=$2 where id=$1 returning *", [id, calendarEventId]);
    if (!rows[0]) throw new Error(`booking ${id} not found`);
    return bookingOf(rows[0]);
  }
  async cancel(id: string) { await this.db.query("update bookings set status='cancelled', idempotency_key=null where id=$1", [id]); }
  async getBooking(id: string) { const { rows } = await this.db.query("select * from bookings where id=$1", [id]); return rows[0] ? bookingOf(rows[0]) : null; }
  async bookingForEnquiry(enquiryId: string) {
    const { rows } = await this.db.query("select * from bookings where enquiry_id=$1 and status in ('held','confirmed') order by starts_at limit 1", [enquiryId]);
    return rows[0] ? bookingOf(rows[0]) : null;
  }
  async findByIdempotencyKey(key: string) {
    const { rows } = await this.db.query("select * from bookings where idempotency_key=$1 and status in ('held','confirmed')", [key]);
    return rows[0] ? bookingOf(rows[0]) : null;
  }
  async touchLastAssigned(designerId: string, at: Date) { await this.db.query("update designers set last_assigned_at=$2::timestamptz where id=$1", [designerId, iso(at)]); }

  async createHandoff(h: { bookingId: string; designerId: string; dueAt: Date; attemptNo?: number }) {
    const { rows } = await this.db.query("insert into handoffs(booking_id, designer_id, attempt_no, due_at, status) values ($1,$2,$3,$4::timestamptz,'pending') returning *", [h.bookingId, h.designerId, h.attemptNo ?? 1, iso(h.dueAt)]);
    return handoffOf(rows[0]!);
  }
  async markHandoffSent(id: string, telegramMessageId: number, sentAt: Date) {
    await this.db.query("update handoffs set telegram_message_id=$2, sent_at=$3::timestamptz, status='sent' where id=$1", [id, telegramMessageId, iso(sentAt)]);
  }
  async getHandoff(id: string) { const { rows } = await this.db.query("select * from handoffs where id=$1", [id]); return rows[0] ? handoffOf(rows[0]) : null; }
  async handoffsForBooking(bookingId: string) {
    const { rows } = await this.db.query("select * from handoffs where booking_id=$1 order by attempt_no", [bookingId]);
    return rows.map(handoffOf);
  }
  async listHandoffsByStatus(statuses: HandoffStatus[]) {
    const { rows } = await this.db.query("select * from handoffs where status = any($1::text[]) order by due_at", [statuses]);
    return rows.map(handoffOf);
  }
  async transitionHandoff(id: string, from: HandoffStatus[], to: HandoffStatus, at: Date, declineReason?: string) {
    const { rows } = await this.db.query(
      `update handoffs set status=$3,
         accepted_at = case when $3 = 'accepted' then $4::timestamptz else accepted_at end,
         declined_at = case when $3 = 'declined' then $4::timestamptz else declined_at end,
         decline_reason = case when $3 = 'declined' then $5 else decline_reason end
       where id=$1 and status = any($2::text[]) returning id`,
      [id, from, to, iso(at), declineReason ?? null]);
    return rows.length === 1;
  }
  async linkReassignedHandoff(oldId: string, newId: string) { await this.db.query("update handoffs set reassigned_to_handoff_id=$2 where id=$1", [oldId, newId]); }
  async markDesignLeadAlerted(id: string, at: Date) { await this.db.query("update handoffs set design_lead_alerted_at=$2::timestamptz where id=$1", [id, iso(at)]); }
  async reassignBooking(bookingId: string, newDesignerId: string, calendarEventId: string) {
    try {
      const { rows } = await this.db.query("update bookings set designer_id=$2, calendar_event_id=$3 where id=$1 and status in ('held','confirmed') returning *", [bookingId, newDesignerId, calendarEventId]);
      if (!rows[0]) throw new Error(`booking ${bookingId} not found or not live`);
      return { ok: true as const, booking: bookingOf(rows[0]) };
    } catch (e) {
      if (isConflict(e)) return { ok: false as const, reason: "conflict" as const };
      throw e;
    }
  }
}
