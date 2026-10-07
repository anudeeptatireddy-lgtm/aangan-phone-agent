import { log } from "@/lib/log";
import { DEFAULT_HOURS, HoursConfig } from "../hours";
import type { EnquiryRecord } from "../enquiry";
import type { CalendarPort, HandoffNote, NotifierPort } from "../ports";
import { noteLines, buildHandoffNote } from "../booking/note";
import { isEligible } from "../booking/eligibility";
import type { BookingRepo } from "../booking/repo";
import { pickInOrder } from "../booking/rotation";
import { formatSlot, overlapsWithBuffer } from "../booking/slots";
import type { Booking, BookingConfig, Designer, HandoffRecord } from "../booking/types";
import { addWorkingMinutes } from "../booking/working-minutes";

export interface HandoffDeps {
  repo: BookingRepo;
  calendar: CalendarPort;
  notifier: NotifierPort;
  now: () => Date;
  config: BookingConfig;
  hours?: HoursConfig;
  loadEnquiry: (id: string) => Promise<EnquiryRecord | null>;
  /** Fallback alert targets when the design lead has no chat. Either may be null in local runs. */
  ownerChatId?: number | null;
  nikhilChatId?: number | null;
}

export type CallbackOutcome = "accepted" | "declined" | "already_handled" | "not_your_handoff" | "unknown";
export interface CallbackInput { callbackQueryId: string; fromChatId: number; data: string }

const CALLBACK = /^h:([0-9a-f-]{36}):(a|d)$/;
const MODE_LABEL = "site_visit";

/**
 * The designer's side of a booking: Accept / Can't take it, the 30-working-minute timeout, and reassignment.
 * Every state change is a compare-and-set in the repo, so a late Accept and the timeout sweep can never both win.
 */
export class HandoffService {
  constructor(private d: HandoffDeps) {}

  // ---- Telegram button presses ----------------------------------------------------------------------------------------
  async handleCallback(i: CallbackInput): Promise<{ outcome: CallbackOutcome }> {
    const answer = async (text?: string) => { try { await this.d.notifier.answerCallback(i.callbackQueryId, text); } catch (e) { log("error", "handoff: answerCallback failed", { error: String(e) }); } };
    const m = CALLBACK.exec(i.data);
    if (!m) { await answer(); return { outcome: "unknown" }; }
    const handoff = await this.d.repo.getHandoff(m[1]!);
    if (!handoff) { await answer(); return { outcome: "unknown" }; }
    const designer = await this.d.repo.getDesigner(handoff.designerId);
    if (!designer || designer.telegramChatId == null || designer.telegramChatId !== i.fromChatId) {
      await answer("This consultation is not assigned to you.");
      return { outcome: "not_your_handoff" };
    }
    const now = this.d.now();
    if (m[2] === "a") {
      if (!(await this.d.repo.transitionHandoff(handoff.id, ["sent", "pending"], "accepted", now))) { await answer("This one has already been handled."); return { outcome: "already_handled" }; }
      await answer("Accepted. Thank you.");
      await this.edit(handoff, designer, `✅ Accepted by ${designer.name}`);
      return { outcome: "accepted" };
    }
    if (!(await this.d.repo.transitionHandoff(handoff.id, ["sent", "pending"], "declined", now, "declined_by_designer"))) { await answer("This one has already been handled."); return { outcome: "already_handled" }; }
    await answer("Noted. We will find someone else.");
    await this.edit(handoff, designer, "❌ Declined. Being reassigned.");
    await this.reassign(handoff.id, "declined");
    return { outcome: "declined" };
  }

  // ---- 30-working-minute timeout ---------------------------------------------------------------------------------------
  async sweep(): Promise<{ timedOut: number }> {
    const now = this.d.now();
    const due = (await this.d.repo.listHandoffsByStatus(["pending", "sent"])).filter((h) => h.dueAt <= now);
    let timedOut = 0;
    for (const h of due) {
      try {
        if (!(await this.d.repo.transitionHandoff(h.id, ["pending", "sent"], "timed_out", now))) continue; // someone accepted first
        timedOut++;
        const designer = await this.d.repo.getDesigner(h.designerId);
        await this.alertLead(h, `${designer?.name ?? "A designer"} did not accept a consultation within ${this.d.config.handoffAcceptWorkingMinutes} working minutes. Reassigning it now.`);
        if (designer) await this.edit(h, designer, "⏰ Not accepted in time. Reassigned.");
        await this.reassign(h.id, "timed_out");
      } catch (e) {
        log("error", "handoff: sweep item failed", { error: String(e), handoff_id: h.id });
      }
    }
    return { timedOut };
  }

  // ---- notes whose first send failed ----------------------------------------------------------------------------------
  async retryPending(): Promise<{ sent: number; failed: number }> {
    let sent = 0, failed = 0;
    for (const h of await this.d.repo.listHandoffsByStatus(["pending"])) {
      const designer = await this.d.repo.getDesigner(h.designerId);
      if (!designer || designer.telegramChatId == null) continue;
      const booking = await this.d.repo.getBooking(h.bookingId);
      const enquiry = booking && (await this.d.loadEnquiry(booking.enquiryId));
      if (!booking || !enquiry) continue;
      try {
        const m = await this.d.notifier.sendHandoff(designer.telegramChatId, this.note(h, booking, enquiry, h.attemptNo > 1));
        await this.d.repo.markHandoffSent(h.id, m.messageId, this.d.now());
        sent++;
      } catch (e) {
        failed++;
        log("error", "handoff: retry send failed", { error: String(e), handoff_id: h.id });
      }
    }
    return { sent, failed };
  }

  // ---- reassignment ---------------------------------------------------------------------------------------------------
  async reassign(fromHandoffId: string, reason: "declined" | "timed_out"): Promise<{ ok: boolean }> {
    const old = await this.d.repo.getHandoff(fromHandoffId);
    if (!old) return { ok: false };
    const booking = await this.d.repo.getBooking(old.bookingId);
    const enquiry = booking && (await this.d.loadEnquiry(booking.enquiryId));
    if (!booking || !enquiry || (booking.status !== "confirmed" && booking.status !== "held")) return { ok: false };

    const tried = new Set((await this.d.repo.handoffsForBooking(booking.id)).map((h) => h.designerId));
    const oldDesigner = await this.d.repo.getDesigner(old.designerId);
    const candidates = (await this.d.repo.listActiveDesigners()).filter((x) =>
      !tried.has(x.id) && x.telegramChatId != null &&
      isEligible(x, { location: enquiry.input.location, project_type: enquiry.input.project_type }, { principalOnly: booking.wantsPrincipal }));

    const free = await this.freeAmong(candidates, booking).catch((e) => { log("error", "handoff: free/busy failed", { error: String(e) }); return [] as Designer[]; });
    for (const x of pickInOrder(free)) {
      let eventId: string;
      try {
        ({ eventId } = await this.d.calendar.createEvent({
          calendarId: x.calendarId!, start: booking.startsAt, end: booking.endsAt,
          summary: `Aangan consultation${enquiry.callerName ? ` · ${enquiry.callerName}` : ""}`,
          description: noteLines({ enquiry, start: booking.startsAt, mode: booking.mode || MODE_LABEL, principalRequested: booking.wantsPrincipal }).join("\n"),
          attendeeEmails: booking.callerEmail ? [booking.callerEmail] : [],
        }));
      } catch (e) {
        log("error", "handoff: calendar event for the new designer failed", { error: String(e), designer_id: x.id });
        continue;
      }
      const moved = await this.d.repo.reassignBooking(booking.id, x.id, eventId);
      if (!moved.ok) { await this.d.calendar.deleteEvent(x.calendarId!, eventId).catch(() => undefined); continue; }

      if (oldDesigner?.calendarId && booking.calendarEventId) {
        await this.d.calendar.deleteEvent(oldDesigner.calendarId, booking.calendarEventId).catch((e) => log("error", "handoff: old event not deleted", { error: String(e) }));
      }
      const now = this.d.now();
      await this.d.repo.touchLastAssigned(x.id, now);
      const dueAt = addWorkingMinutes(now, this.d.config.handoffAcceptWorkingMinutes, this.d.hours ?? DEFAULT_HOURS);
      const next = await this.d.repo.createHandoff({ bookingId: booking.id, designerId: x.id, dueAt, attemptNo: old.attemptNo + 1 });
      await this.d.repo.linkReassignedHandoff(old.id, next.id);
      await this.d.repo.transitionHandoff(old.id, ["declined", "timed_out"], "reassigned", now);
      try {
        const m = await this.d.notifier.sendHandoff(x.telegramChatId!, this.note(next, moved.booking, enquiry, true));
        await this.d.repo.markHandoffSent(next.id, m.messageId, now);
      } catch (e) {
        log("error", "handoff: reassigned note failed; left pending", { error: String(e), handoff_id: next.id });
      }
      return { ok: true };
    }

    await this.escalate(old, booking, reason, oldDesigner?.name);
    return { ok: false };
  }

  // ---- helpers ---------------------------------------------------------------------------------------------------------
  private async freeAmong(cands: Designer[], b: Booking): Promise<Designer[]> {
    if (!cands.length) return [];
    const buf = this.d.config.bufferMinutes;
    const from = new Date(b.startsAt.getTime() - buf * 60_000), to = new Date(b.endsAt.getTime() + buf * 60_000);
    const cal = await this.d.calendar.freeBusy(cands.map((x) => x.calendarId!), from, to);
    const mine = await this.d.repo.busyForDesigners(cands.map((x) => x.id), from, to);
    return cands.filter((x) => !overlapsWithBuffer({ start: b.startsAt, end: b.endsAt }, [...(cal.get(x.calendarId!) ?? []), ...(mine.get(x.id) ?? [])], buf));
  }

  private note(h: HandoffRecord, b: Booking, e: EnquiryRecord, reassigned: boolean): HandoffNote {
    const n = buildHandoffNote({ handoffId: h.id, enquiry: e, start: b.startsAt, mode: b.mode || MODE_LABEL, principalRequested: b.wantsPrincipal });
    return reassigned ? { ...n, text: `↻ Reassigned to you (the previous designer could not take it)\n${n.text}`.slice(0, 4096) } : n;
  }

  private async edit(h: HandoffRecord, designer: Designer, heading: string): Promise<void> {
    if (designer.telegramChatId == null || h.telegramMessageId == null) return;
    try {
      const booking = await this.d.repo.getBooking(h.bookingId);
      const enquiry = booking && (await this.d.loadEnquiry(booking.enquiryId));
      const body = booking && enquiry ? this.note(h, booking, enquiry, false).text : "";
      await this.d.notifier.editHandoff(designer.telegramChatId, h.telegramMessageId, `${heading}\n${body}`.slice(0, 4096));
    } catch (e) {
      log("error", "handoff: edit message failed", { error: String(e), handoff_id: h.id });
    }
  }

  private async leadChat(): Promise<number | null> {
    const lead = (await this.d.repo.listActiveDesigners()).find((x) => x.isDesignLead && x.telegramChatId != null);
    return lead?.telegramChatId ?? null;
  }
  private async alertLead(h: HandoffRecord, text: string) {
    const chat = (await this.leadChat()) ?? this.d.ownerChatId ?? null;
    if (chat == null) { log("warn", "handoff: no design lead or owner chat to alert", { handoff_id: h.id }); return; }
    try { await this.d.notifier.sendAlert(chat, text); await this.d.repo.markDesignLeadAlerted(h.id, this.d.now()); }
    catch (e) { log("error", "handoff: lead alert failed", { error: String(e) }); }
  }

  private async escalate(h: HandoffRecord, b: Booking, reason: string, previous?: string) {
    const text = `No designer is available to take the consultation on ${formatSlot(b.startsAt)} (${reason === "declined" ? `${previous ?? "the designer"} declined` : `${previous ?? "the designer"} did not respond`}). It needs a person to sort out.`;
    const targets = new Set<number>();
    const lead = await this.leadChat();
    for (const c of [lead, this.d.ownerChatId, this.d.nikhilChatId]) if (c != null) targets.add(c);
    for (const c of targets) await this.d.notifier.sendAlert(c, text).catch((e) => log("error", "handoff: escalation alert failed", { error: String(e) }));
    await this.d.repo.markDesignLeadAlerted(h.id, this.d.now());
  }
}
