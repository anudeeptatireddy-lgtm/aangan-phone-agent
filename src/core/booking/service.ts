import { log } from "@/lib/log";
import { DEFAULT_HOURS, HoursConfig } from "../hours";
import type { EnquiryRecord } from "../enquiry";
import type { CalendarPort, NotifierPort } from "../ports";
import { isEligible } from "./eligibility";
import { buildHandoffNote, noteLines } from "./note";
import type { BookingRepo } from "./repo";
import { pickInOrder } from "./rotation";
import { candidateStarts, formatSlot, isCandidateStart, istYmd, overlapsWithBuffer, pickOffered, SlotPrefs } from "./slots";
import type { BookingConfig, Designer, Interval } from "./types";
import { addWorkingMinutes } from "./working-minutes";

export interface SlotOffer { start: string; end: string; label: string }

export type GetSlotsResult =
  | { ok: true; slots: SlotOffer[]; next_action: "offer_slots" | "ask_other_days" | "request_human_review"; reason?: string }
  | { ok: false; error: "not_bookable"; slots: []; next_action: string };

export type BookSlotResult =
  | { ok: true; booking_id: string; start: string; end: string; label: string; designer_role: "principal" | "designer"; handoff_sent?: boolean; replayed: boolean }
  | { ok: false; error: "not_bookable" | "invalid_slot" | "slot_taken" | "calendar_unavailable"; alternatives?: SlotOffer[]; next_action?: string };

export interface BookingDeps {
  repo: BookingRepo;
  calendar: CalendarPort;
  notifier: NotifierPort;
  now: () => Date;
  config: BookingConfig;
  hours?: HoursConfig;
  /** false when a voice platform's own calendar (Cal.com) makes the booking: designers need no calendar of ours and none is called. */
  requireCalendar?: boolean;
}

const MODE = "site_visit";
const DAY = 86_400_000;
const IST = 330 * 60_000;
const dayWindow = (d: Date): [Date, Date] => {
  const ymd = istYmd(d);
  const start = new Date(Date.parse(`${ymd}T00:00:00Z`) - IST);
  return [start, new Date(start.getTime() + DAY)];
};

export class BookingService {
  constructor(private d: BookingDeps) {}

  private offer(s: Date): SlotOffer {
    return { start: s.toISOString(), end: new Date(s.getTime() + this.d.config.slotMinutes * 60_000).toISOString(), label: formatSlot(s) };
  }

  private async eligibleDesigners(e: EnquiryRecord, wantsPrincipal?: boolean): Promise<Designer[]> {
    const all = await this.d.repo.listActiveDesigners();
    return all.filter((x) => isEligible(x, { location: e.input.location, project_type: e.input.project_type }, { principalOnly: wantsPrincipal, requireCalendar: this.d.requireCalendar }));
  }

  /** Free/busy for the designers over [from, to): the calendar's events plus our own held/confirmed bookings. */
  private async busyMap(designers: Designer[], from: Date, to: Date): Promise<Map<string, Interval[]>> {
    const cal = await this.d.calendar.freeBusy(designers.map((x) => x.calendarId!), from, to);
    const mine = await this.d.repo.busyForDesigners(designers.map((x) => x.id), from, to);
    const out = new Map<string, Interval[]>();
    for (const x of designers) out.set(x.id, [...(cal.get(x.calendarId!) ?? []), ...(mine.get(x.id) ?? [])]);
    return out;
  }

  private isFree(x: Designer, start: Date, busy: Map<string, Interval[]>, ownBookings: Map<string, Interval[]>): boolean {
    const slot = { start, end: new Date(start.getTime() + this.d.config.slotMinutes * 60_000) };
    if (overlapsWithBuffer(slot, busy.get(x.id) ?? [], this.d.config.bufferMinutes)) return false;
    if (x.maxPerDay != null) {
      const day = istYmd(start);
      const used = (ownBookings.get(x.id) ?? []).filter((i) => istYmd(i.start) === day).length;
      if (used >= x.maxPerDay) return false;
    }
    return true;
  }

  async getSlots(i: { enquiry: EnquiryRecord; prefs?: SlotPrefs; wantsPrincipal?: boolean; count?: number }): Promise<GetSlotsResult> {
    if (i.enquiry.fit !== "fit") return { ok: false, error: "not_bookable", slots: [], next_action: i.enquiry.nextAction ?? "human_review" };
    const { config } = this.d;
    const eligible = await this.eligibleDesigners(i.enquiry, i.wantsPrincipal);
    if (!eligible.length) return { ok: true, slots: [], next_action: "request_human_review", reason: "no_eligible_designer" };

    const now = this.d.now();
    const cands = candidateStarts(now, config, i.prefs);
    if (!cands.length) return { ok: true, slots: [], next_action: "ask_other_days" };

    const from = new Date(cands[0]!.getTime() - config.bufferMinutes * 60_000);
    const to = new Date(cands[cands.length - 1]!.getTime() + (config.slotMinutes + config.bufferMinutes) * 60_000);
    let busy: Map<string, Interval[]>, own: Map<string, Interval[]>;
    try {
      busy = await this.busyMap(eligible, from, to);
      own = await this.d.repo.busyForDesigners(eligible.map((x) => x.id), from, to);
    } catch (err) {
      log("error", "booking: free/busy failed", { error: String(err) });
      return { ok: true, slots: [], next_action: "request_human_review", reason: "calendar_unavailable" };
    }
    const free = cands.filter((s) => eligible.some((x) => this.isFree(x, s, busy, own)));
    const offered = pickOffered(free, i.count ?? config.maxOffer).map((s) => this.offer(s));
    return { ok: true, slots: offered, next_action: offered.length ? "offer_slots" : "ask_other_days" };
  }

  async bookSlot(i: { enquiry: EnquiryRecord; start: string; callerEmail?: string; callerName?: string; wantsPrincipal?: boolean; idempotencyKey?: string }): Promise<BookSlotResult> {
    const e = i.enquiry;
    // Hard rule 2: only the rules engine can make an enquiry bookable. We pass its own next_action through (decline / human review),
    // so the agent never tells an 'unclear' caller they are "not a fit".
    if (e.fit !== "fit") return { ok: false, error: "not_bookable", next_action: e.nextAction ?? "human_review" };

    const startDate = new Date(i.start);
    if (!isCandidateStart(startDate, this.d.now(), this.d.config)) return { ok: false, error: "invalid_slot" };
    const start = startDate;
    const end = new Date(start.getTime() + this.d.config.slotMinutes * 60_000);
    const key = i.idempotencyKey ?? `${e.id}|${start.toISOString()}`;

    const existing = await this.d.repo.findByIdempotencyKey(key);
    if (existing) {
      const designers = await this.d.repo.listActiveDesigners();
      const dz = designers.find((x) => x.id === existing.designerId);
      return { ok: true, booking_id: existing.id, start: existing.startsAt.toISOString(), end: existing.endsAt.toISOString(), label: formatSlot(existing.startsAt),
        designer_role: i.wantsPrincipal && dz?.isPrincipal ? "principal" : "designer", replayed: true };
    }

    const eligible = await this.eligibleDesigners(e, i.wantsPrincipal);
    const [dayStart, dayEnd] = dayWindow(start);
    let free: Designer[];
    try {
      const from = new Date(Math.min(dayStart.getTime(), start.getTime() - this.d.config.bufferMinutes * 60_000));
      const to = new Date(Math.max(dayEnd.getTime(), end.getTime() + this.d.config.bufferMinutes * 60_000));
      const busy = await this.busyMap(eligible, from, to);
      const own = await this.d.repo.busyForDesigners(eligible.map((x) => x.id), dayStart, dayEnd);
      free = eligible.filter((x) => this.isFree(x, start, busy, own));
    } catch (err) {
      log("error", "booking: free/busy failed", { error: String(err) });
      return { ok: false, error: "calendar_unavailable", next_action: "request_human_review" };
    }
    if (!free.length) return this.slotTaken(e, i.wantsPrincipal);

    // Rotation picks the order; the database constraint decides who actually gets the slot if two callers race.
    let chosen: Designer | undefined, bookingId = "";
    for (const x of pickInOrder(free)) {
      const r = await this.d.repo.createHold({ enquiryId: e.id, designerId: x.id, startsAt: start, endsAt: end, idempotencyKey: key,
        callerEmail: i.callerEmail ?? e.callerEmail ?? null, mode: MODE, wantsPrincipal: !!i.wantsPrincipal });
      if (r.ok) { chosen = x; bookingId = r.booking.id; break; }
    }
    if (!chosen) return this.slotTaken(e, i.wantsPrincipal);

    const name = i.callerName ?? e.callerName;
    const email = i.callerEmail ?? e.callerEmail;
    let eventId: string;
    try {
      ({ eventId } = await this.d.calendar.createEvent({
        calendarId: chosen.calendarId!, start, end,
        summary: `Aangan consultation${name ? ` · ${name}` : ""}`,
        description: noteLines({ enquiry: e, start, mode: MODE, principalRequested: !!i.wantsPrincipal }).join("\n"),
        attendeeEmails: email ? [email] : [],
      }));
    } catch (err) {
      await this.d.repo.cancel(bookingId); // never leave a half-made booking holding the slot
      log("error", "booking: calendar event failed; hold released", { error: String(err), booking_id: bookingId });
      return { ok: false, error: "calendar_unavailable", next_action: "request_human_review" };
    }
    await this.d.repo.confirm(bookingId, eventId);
    const now = this.d.now();
    await this.d.repo.touchLastAssigned(chosen.id, now);

    const sent = await this.sendHandoff(bookingId, chosen, e, start, !!i.wantsPrincipal, now);
    return { ok: true, booking_id: bookingId, start: start.toISOString(), end: end.toISOString(), label: formatSlot(start),
      designer_role: i.wantsPrincipal && chosen.isPrincipal ? "principal" : "designer", handoff_sent: sent, replayed: false };
  }


  /** The booking already stands. A failed Telegram send leaves the handoff 'pending' for the retry job; it never undoes the booking. */
  private async sendHandoff(bookingId: string, chosen: Designer, e: EnquiryRecord, start: Date, principalRequested: boolean, now: Date): Promise<boolean> {
    const dueAt = addWorkingMinutes(now, this.d.config.handoffAcceptWorkingMinutes, this.d.hours ?? DEFAULT_HOURS);
    const handoff = await this.d.repo.createHandoff({ bookingId, designerId: chosen.id, dueAt });
    if (chosen.telegramChatId == null) return false;
    try {
      const note = buildHandoffNote({ handoffId: handoff.id, enquiry: e, start, mode: MODE, principalRequested });
      const m = await this.d.notifier.sendHandoff(chatId(chosen), note);
      await this.d.repo.markHandoffSent(handoff.id, m.messageId, now);
      return true;
    } catch (err) {
      log("error", "booking: handoff send failed; left pending", { error: String(err), handoff_id: handoff.id });
      return false;
    }
  }

  /**
   * A consultation the voice platform has already booked in ITS calendar (Cal.com). Our job is only to give it an owner: rotation among
   * eligible designers who are free in our own table, then the handoff note. No calendar is read or written.
   */
  async recordExternalBooking(i: { enquiry: EnquiryRecord; start: Date; end: Date; externalId: string; callerEmail?: string }):
    Promise<{ ok: true; bookingId: string; designerId: string; handoffSent: boolean } | { ok: false; error: "no_designer" | "not_bookable" }> {
    const e = i.enquiry;
    if (e.fit !== "fit") return { ok: false, error: "not_bookable" }; // hard rule 2: only the rules engine makes an enquiry bookable
    const key = `cal:${i.externalId}`;
    const existing = await this.d.repo.findByIdempotencyKey(key);
    if (existing) return { ok: true, bookingId: existing.id, designerId: existing.designerId, handoffSent: true };

    const eligible = await this.eligibleDesigners(e);
    const buf = this.d.config.bufferMinutes;
    const from = new Date(i.start.getTime() - buf * 60_000), to = new Date(i.end.getTime() + buf * 60_000);
    const [dayStart, dayEnd] = dayWindow(i.start);
    const busy = await this.d.repo.busyForDesigners(eligible.map((x) => x.id), new Date(Math.min(from.getTime(), dayStart.getTime())), new Date(Math.max(to.getTime(), dayEnd.getTime())));
    const free = eligible.filter((x) => this.isFree(x, i.start, busy, busy));
    for (const x of pickInOrder(free)) {
      const r = await this.d.repo.createHold({ enquiryId: e.id, designerId: x.id, startsAt: i.start, endsAt: i.end, idempotencyKey: key, callerEmail: i.callerEmail ?? e.callerEmail ?? null, mode: MODE });
      if (!r.ok) {
        // The same Cal.com booking arriving twice at once (call-side and webhook-side routing): the other attempt owns it. Never fall through to a second designer.
        const mine = await this.d.repo.findByIdempotencyKey(key);
        if (mine) return { ok: true, bookingId: mine.id, designerId: mine.designerId, handoffSent: true };
        continue; // lost a race for this designer: the database constraint decided; try the next
      }
      await this.d.repo.confirm(r.booking.id, i.externalId);
      const now = this.d.now();
      await this.d.repo.touchLastAssigned(x.id, now);
      const sent = await this.sendHandoff(r.booking.id, x, e, i.start, false, now);
      return { ok: true, bookingId: r.booking.id, designerId: x.id, handoffSent: sent };
    }
    return { ok: false, error: "no_designer" };
  }

  private async slotTaken(e: EnquiryRecord, wantsPrincipal?: boolean): Promise<BookSlotResult> {
    const alt = await this.getSlots({ enquiry: e, wantsPrincipal });
    return { ok: false, error: "slot_taken", alternatives: alt.slots };
  }
}

const chatId = (d: Designer) => d.telegramChatId as number;
