import { log } from "@/lib/log";
import { hashPhone, normalizeE164 } from "@/lib/phone";
import { DEFAULT_HOURS, type HoursConfig } from "../hours";
import { planEscalation } from "../escalation";
import type { EnquiryRecord } from "../enquiry";
import type { BookingService } from "../booking/service";
import type { BookingRepo } from "../booking/repo";
import { noteLines } from "../booking/note";
import type { CallRow, EnquiryRow, OutboxRow, PostCallRepo } from "../postcall/repo";
import { matchBooking, matchWindow, ORPHAN_AFTER_MS, SWEEP_AFTER_MS, type CallFacts } from "./match";
import type { CalBooking, CalBookingStore } from "./types";

const MAX_ATTEMPTS = 5;
const ORPHAN_LOOKBACK_MS = 24 * 3_600_000;
const URGENT_WITHIN_MS = 24 * 3_600_000;

export type Priority = "urgent" | "normal" | "low";
export type RouteOutcome = "booked" | "waiting" | "flagged" | "closed" | "not_pending";

export interface RouterDeps {
  repo: PostCallRepo;
  cal: CalBookingStore;
  booking: Pick<BookingService, "recordExternalBooking">;
  bookings: Pick<BookingRepo, "getBooking">;
  pepper: string;
  now: () => Date;
  hours?: HoursConfig;
}

export interface RouteSummary { booked: number; waiting: number; flagged: number; closed: number; orphans: number; errors: number }

/** The enquiry as the booking and handoff steps know it. Shared with whatever loads enquiries for reassignment. */
export function toEnquiryRecord(row: EnquiryRow, contact: { name: string | null; email: string | null } | null, createdAt: Date): EnquiryRecord {
  return { id: row.id, callerId: row.callerId ?? undefined, callerName: contact?.name ?? undefined, callerEmail: contact?.email ?? undefined, language: row.language ?? undefined,
    input: row.input, fit: row.fit, reasonCodes: row.reasonCodes, nextAction: row.nextAction ?? undefined, flags: row.flags, ruleVersion: row.ruleVersion, createdAt: createdAt.toISOString() };
}

/**
 * Matches a finished call to the Cal.com booking the voice agent made during it, then gives that booking an owner.
 * Plain code decides (hard rule 2). Triggered from three sides: post-call processing finishing, a Cal.com booking arriving, and the
 * scheduled tick (which also runs the sweep). Claiming is atomic and every later step is idempotent, so whoever runs first wins.
 * Everything unusual goes to the design lead; Nikhil is never told from here.
 */
export class CallRouter {
  constructor(private d: RouterDeps) {}

  /** Try one call now (post-call processing just finished). */
  async routeCall(vendorCallId: string): Promise<RouteOutcome> {
    const s = await this.run(vendorCallId);
    return s.only ?? "not_pending";
  }

  /** Try every unrouted call, then report bookings nobody claimed. Called by the Cal.com webhook and the tick. */
  async routePending(): Promise<RouteSummary> {
    const s = await this.run(undefined);
    return s.summary;
  }

  private async run(only: string | undefined): Promise<{ summary: RouteSummary; only?: RouteOutcome }> {
    const summary: RouteSummary = { booked: 0, waiting: 0, flagged: 0, closed: 0, orphans: 0, errors: 0 };
    let outcome: RouteOutcome | undefined;
    for (const item of await this.d.repo.pendingOutbox(["call_routing"], 200)) {
      if (only && item.payload.vendorCallId !== only) continue;
      let r: RouteOutcome;
      try {
        r = await this.routeItem(item);
        if (r !== "waiting") await this.d.repo.markOutbox(item.id, "processed");
      } catch (err) {
        summary.errors++;
        r = "waiting";
        const final = item.attempts + 1 >= MAX_ATTEMPTS;
        log("error", "router: item failed", { vendor_call_id: String(item.payload.vendorCallId), attempts: item.attempts + 1, error: String(err).slice(0, 200) });
        await this.d.repo.markOutbox(item.id, final ? "failed" : "pending", String(err).slice(0, 200));
        if (final) await this.d.repo.enqueue("owner_alert", { flag: "other", vendorCallId: String(item.payload.vendorCallId), severity: "high",
          evidence: `Matching this call to its Cal.com booking failed ${MAX_ATTEMPTS} times (${String(err).slice(0, 120)}). The caller may believe they are booked. It needs a person.` },
          `owner_alert:routing_failed:${item.id}`);
      }
      if (r === "booked") summary.booked++; else if (r === "waiting") summary.waiting++; else if (r === "flagged") summary.flagged++; else summary.closed++;
      outcome = r;
    }
    if (!only) summary.orphans = await this.reportOrphans();
    return { summary, only: outcome };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------

  private async routeItem(item: OutboxRow): Promise<RouteOutcome> {
    const id = String(item.payload.vendorCallId);
    const call = await this.d.repo.getCall(id);
    if (!call || call.postCallStatus !== "processed" || !call.endedAt) return "waiting"; // post-call processing has not finished: it will call us when it does
    const now = this.d.now();

    let booking = await this.d.cal.forCall(id); // an earlier attempt already claimed one: carry on with it, never re-match
    if (!booking) {
      const facts = await this.facts(call, item);
      let verdict = matchBooking(facts, await this.candidates(facts));
      for (let attempt = 0; verdict.kind === "matched" && attempt < 3; attempt++) {
        if (await this.d.cal.claim(verdict.booking.uid, id)) { booking = verdict.booking; break; }
        verdict = matchBooking(facts, await this.candidates(facts)); // lost it to another call or process: look again, never trust the stale answer
      }
      if (!booking) {
        if (now.getTime() < call.endedAt.getTime() + SWEEP_AFTER_MS) return "waiting";
        return this.sweep(call, item, verdict.kind === "ambiguous" ? verdict.candidates : []);
      }
    }
    return this.complete(call, booking);
  }

  private async facts(call: CallRow, item: OutboxRow): Promise<CallFacts> {
    const endedAt = call.endedAt!;
    const startedAt = call.rangAt ?? call.answeredAt ?? new Date(endedAt.getTime() - (call.durationS ? call.durationS * 1000 : 30 * 60_000));
    const contact = call.callerId ? await this.d.repo.callerContact(call.callerId) : null;
    // Phones are normalised to E.164 before hashing, here and in the Cal.com webhook, or the hashes would never meet.
    const e164 = contact?.phone ? normalizeE164(contact.phone) : null;
    return { startedAt, endedAt, phoneHash: e164 ? hashPhone(e164, this.d.pepper) : null, email: contact?.email?.toLowerCase() ?? null, claimedBooking: item.payload.claimedBooking === true };
  }

  private candidates(f: CallFacts): Promise<CalBooking[]> {
    const { from, to } = matchWindow(f);
    return this.d.cal.findUnclaimed(from, to);
  }

  /** A booking is claimed by this call: give it an owner, write the note, queue the CRM deal and the confirmation. All of it idempotent. */
  private async complete(call: CallRow, b: CalBooking): Promise<RouteOutcome> {
    const id = call.vendorCallId;
    const row = call.enquiryId ? await this.d.repo.getEnquiry(call.enquiryId) : null;
    if (!row) {
      await this.alert("booking_no_enquiry", "normal", id, { bookingUid: b.uid, startsAt: b.startsAt }, `booking_no_enquiry:${id}`);
      await this.d.repo.upsertCall(id, { outcome: "review" });
      return "flagged";
    }
    const contact = call.callerId ? await this.d.repo.callerContact(call.callerId) : null;
    const record = toEnquiryRecord(row, contact, this.d.now());
    const email = b.attendeeEmail ?? contact?.email ?? undefined;
    const r = await this.d.booking.recordExternalBooking({ enquiry: record, start: b.startsAt, end: b.endsAt, externalId: b.uid, callerEmail: email });
    if (!r.ok) {
      const kind = r.error === "not_bookable" ? "booking_not_fit" : "booking_no_designer";
      await this.alert(kind, r.error === "not_bookable" ? "normal" : "urgent", id, { bookingUid: b.uid, startsAt: b.startsAt }, `${kind}:${id}`);
      await this.d.repo.upsertCall(id, { outcome: "review" });
      return "flagged";
    }
    const held = await this.d.bookings.getBooking(r.bookingId);
    const note = noteLines({ enquiry: record, start: b.startsAt, mode: held?.mode ?? "", principalRequested: false, callSeconds: call.durationS ?? undefined, summary: call.summary ?? undefined }).join("\n");
    await this.d.repo.upsertEnquiry({ id: row.id, callerId: row.callerId, input: row.input, fit: row.fit, reasonCodes: row.reasonCodes, missingFields: row.missingFields,
      nextAction: row.nextAction ?? undefined, flags: row.flags, ruleVersion: row.ruleVersion, language: row.language ?? undefined, currentState: row.currentState ?? undefined,
      sourceHeard: row.sourceHeard ?? undefined, timelineRaw: row.timelineRaw ?? undefined, designerNote: note });
    await this.d.repo.upsertCall(id, { outcome: "booked" });
    await this.d.repo.enqueue("hubspot_deal", { enquiryId: row.id, vendorCallId: id, bookingId: r.bookingId }, `hubspot_deal:${row.id}`);
    if (email) await this.d.repo.enqueue("confirmation_email", { bookingId: r.bookingId, enquiryId: row.id, email, name: contact?.name ?? null, startsAt: b.startsAt.toISOString() }, `confirmation_email:${r.bookingId}`);
    await this.d.repo.enqueue("designer_note_update", { enquiryId: row.id, bookingId: r.bookingId }, `designer_note_update:${r.bookingId}`);
    return "booked";
  }

  /** Call end + 15 min and still no booking: raise what the owner specified, once. */
  private async sweep(call: CallRow, item: OutboxRow, rivals: CalBooking[]): Promise<RouteOutcome> {
    const id = call.vendorCallId;
    const row = call.enquiryId ? await this.d.repo.getEnquiry(call.enquiryId) : null;
    const dealIfFit = async () => { if (row?.fit === "fit") await this.d.repo.enqueue("hubspot_deal", { enquiryId: row.id, vendorCallId: id, bookingId: null }, `hubspot_deal:${row.id}`); };

    if (rivals.length >= 2) {
      // Normal, unless the consultation is within 24 hours: then someone must link it today or no designer turns up (owner decision).
      const earliest = rivals.reduce((m, x) => (x.startsAt < m ? x.startsAt : m), rivals[0]!.startsAt);
      const soon = earliest.getTime() - this.d.now().getTime() <= URGENT_WITHIN_MS;
      await this.alert("booking_ambiguous", soon ? "urgent" : "normal", id, { bookingUids: rivals.map((x) => x.uid), startsAt: earliest }, `booking_ambiguous:${id}`);
      await this.d.repo.upsertCall(id, { outcome: "review" });
      await dealIfFit();
      return "flagged";
    }
    if (item.payload.claimedBooking === true) {
      // The caller was told they are booked and nothing exists: the most serious case.
      const plan = planEscalation("human_requested", this.d.now(), this.d.hours ?? DEFAULT_HOURS, { transferFailed: true });
      if (!(await this.d.repo.escalationsForCall(id)).some((e) => e.reason === "review"))
        await this.d.repo.recordEscalation(id, { reason: "review", mode: plan.mode, callbackDueAt: plan.callbackDueAt ? new Date(plan.callbackDueAt) : null, slaMinutes: plan.slaMinutes ?? null, queue: "front_desk", queueEscalatesTo: "design_lead" });
      await this.alert("booking_missing", "urgent", id, { callbackDueAt: plan.callbackDueAt, slaMinutes: plan.slaMinutes ?? null }, `booking_missing:${id}`);
      await this.d.repo.upsertCall(id, { outcome: "review" });
      await dealIfFit();
      return "flagged";
    }
    // Nothing claimed, nothing found: an ordinary call that ended without a booking.
    const outcome = row?.fit === "not_fit" ? "not_fit" : call.endedReason === "dropped" ? "dropped" : "review";
    await this.d.repo.upsertCall(id, { outcome });
    await dealIfFit();
    return "closed";
  }

  /** A Cal.com booking that no call has claimed 45 minutes after Cal.com created it: low priority, once. */
  private async reportOrphans(): Promise<number> {
    const now = this.d.now().getTime();
    let n = 0;
    for (const b of await this.d.cal.findUnclaimed(new Date(now - ORPHAN_LOOKBACK_MS), new Date(now - ORPHAN_AFTER_MS)))
      if (await this.alert("booking_orphan", "low", undefined, { bookingUid: b.uid, startsAt: b.startsAt, createdAt: b.createdAt }, `booking_orphan:${b.uid}`)) n++;
    return n;
  }

  private alert(kind: string, priority: Priority, vendorCallId: string | undefined, extra: Record<string, unknown>, key: string): Promise<boolean> {
    const payload: Record<string, unknown> = { kind, priority, ...(vendorCallId ? { vendorCallId } : {}) };
    for (const [k, v] of Object.entries(extra)) payload[k] = v instanceof Date ? v.toISOString() : v;
    return this.d.repo.enqueue("design_lead_alert", payload, `design_lead_alert:${key}`);
  }
}
