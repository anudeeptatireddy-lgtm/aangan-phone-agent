import { log } from "@/lib/log";
import { buildHandoffNote } from "../booking/note";
import type { BookingRepo } from "../booking/repo";
import type { CrmPort, EmailPort, NotifierPort } from "../ports";
import type { OutboxKind, OutboxRow, PostCallRepo } from "../postcall/repo";
import { buildConfirmationEmail } from "./confirmation-email";
import { buildDesignerEmail } from "./designer-email";
import type { CalBookingStore } from "../calcom/types";

const KINDS: OutboxKind[] = ["hubspot_deal", "confirmation_email", "designer_note_update", "designer_email"];
const MAX_ATTEMPTS = 5;

export interface OutboxDeps { repo: PostCallRepo; bookings: BookingRepo; notifier: NotifierPort; crm: CrmPort; email: EmailPort; now: () => Date;
  cal?: CalBookingStore; /** every designer email goes here instead (the Resend test sender only delivers to the account owner; also the demo) */ designerEmailTo?: string }

/** Delivers the non-alert outbox items. Alerts are the AlertDrainer's. A failure keeps the item pending; the 5th failure marks it failed and alerts the owner. */
export class OutboxRunner {
  constructor(private d: OutboxDeps) {}

  async run(limit = 50): Promise<{ processed: number; failed: number }> {
    const out = { processed: 0, failed: 0 };
    for (const item of await this.d.repo.pendingOutbox(KINDS, limit)) {
      try {
        await this.handle(item);
        await this.d.repo.markOutbox(item.id, "processed");
        out.processed++;
      } catch (err) {
        out.failed++;
        const final = item.attempts + 1 >= MAX_ATTEMPTS;
        log("error", "outbox: item failed", { kind: item.kind, attempts: item.attempts + 1, error: String(err).slice(0, 200) });
        await this.d.repo.markOutbox(item.id, final ? "failed" : "pending", String(err).slice(0, 200));
        if (final) await this.d.repo.enqueue("owner_alert", { flag: "other", vendorCallId: String(item.payload.vendorCallId ?? item.id), severity: "high",
          evidence: `${item.kind} could not be delivered after ${MAX_ATTEMPTS} attempts (${String(err).slice(0, 120)}). It needs a person.` }, `owner_alert:outbox_failed:${item.id}`);
      }
    }
    return out;
  }

  private handle(item: OutboxRow): Promise<void> {
    switch (item.kind) {
      case "hubspot_deal": return this.hubspotDeal(item);
      case "confirmation_email": return this.confirmationEmail(item);
      case "designer_note_update": return this.designerNoteUpdate(item);
      case "designer_email": return this.designerEmail(item);
      default: return Promise.resolve();
    }
  }

  private async hubspotDeal(item: OutboxRow) {
    const enquiryId = String(item.payload.enquiryId);
    if (await this.d.repo.getCrmLink(enquiryId)) return; // a previous attempt got as far as HubSpot: never create a second deal
    const enquiry = await this.d.repo.getEnquiry(enquiryId);
    if (!enquiry) throw new Error("enquiry not found");
    const caller = enquiry.callerId ? await this.d.repo.callerContact(enquiry.callerId) : null;
    const [first, ...rest] = (caller?.name ?? "").trim().split(/\s+/).filter(Boolean);
    const f = enquiry.input;
    const what = f.is_villa ? "Villa" : f.bhk ? `${f.bhk}BHK` : f.project_type ?? "Enquiry";
    const name = [f.location, what].filter(Boolean).join(" ") + (caller?.name ? ` · ${caller.name}` : "");
    const description = enquiry.designerNote ?? "Qualified enquiry (fit); no consultation booked on the call. Needs follow-up.";
    const r = await this.d.crm.createDealForEnquiry({
      contact: { email: caller?.email ?? undefined, phone: caller?.phone, firstName: first, lastName: rest.join(" ") || undefined },
      deal: { name, description },
    });
    await this.d.repo.saveCrmLink(enquiryId, r, this.d.now());
  }

  private async confirmationEmail(item: OutboxRow) {
    const booking = await this.d.bookings.getBooking(String(item.payload.bookingId));
    if (!booking || (booking.status !== "confirmed" && booking.status !== "held")) return; // cancelled since: nothing to confirm
    const msg = buildConfirmationEmail({ name: (item.payload.name as string | null) ?? null, startsAt: booking.startsAt });
    await this.d.email.send({ to: String(item.payload.email), ...msg, idempotencyKey: item.dedupeKey });
  }

  /** "You have a new project": the details, the meeting link and the transcript of the call, emailed to the assigned designer. */
  private async designerEmail(item: OutboxRow) {
    if (item.payload.callback === true) return this.callbackEmail(item);
    const booking = await this.d.bookings.getBooking(String(item.payload.bookingId));
    if (!booking || (booking.status !== "confirmed" && booking.status !== "held")) return; // cancelled since
    const designer = await this.d.bookings.getDesigner(String(item.payload.designerId ?? booking.designerId));
    if (!designer) throw new Error("designer not found");
    const to = this.d.designerEmailTo ?? designer.email;
    if (!to) throw new Error(`designer ${designer.name} has no email address`);
    const enquiry = await this.d.repo.getEnquiry(String(item.payload.enquiryId));
    const call = await this.d.repo.getCall(String(item.payload.vendorCallId));
    const cal = item.payload.bookingUid && this.d.cal ? await this.d.cal.get(String(item.payload.bookingUid)) : null;
    const caller = enquiry?.callerId ? await this.d.repo.callerContact(enquiry.callerId) : null;
    const msg = buildDesignerEmail({ designerName: designer.name, callerName: caller?.name ?? null, location: enquiry?.input.location ?? null, startsAt: booking.startsAt,
      meetingUrl: cal?.meetingUrl ?? null, phone: caller?.phone ?? null, callerEmail: caller?.email ?? booking.callerEmail ?? null, details: enquiry?.designerNote ?? "", transcript: call?.transcript ?? [], forDesigner: this.d.designerEmailTo && designer.email !== this.d.designerEmailTo ? designer.name : undefined });
    await this.d.email.send({ to, ...msg, idempotencyKey: item.dedupeKey });
  }

  /** A qualified enquiry that did not book a consultation: a designer (by rotation) is asked to call the customer back. No booking, no meeting link, and often no phone number (web calls). */
  private async callbackEmail(item: OutboxRow) {
    const enquiry = await this.d.repo.getEnquiry(String(item.payload.enquiryId));
    if (!enquiry || enquiry.fit !== "fit") return;
    const existing = await this.d.bookings.bookingForEnquiry(enquiry.id);
    if (existing && existing.status !== "cancelled") return; // it booked since: the booking path emails the designer
    const designers = (await this.d.bookings.listActiveDesigners()).sort((a, b) => (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
    const designer = designers[0];
    if (!designer) throw new Error("no active designer to ask for the callback");
    const to = this.d.designerEmailTo ?? designer.email;
    if (!to) throw new Error(`designer ${designer.name} has no email address`);
    const call = await this.d.repo.getCall(String(item.payload.vendorCallId));
    const caller = enquiry.callerId ? await this.d.repo.callerContact(enquiry.callerId) : null;
    const msg = buildDesignerEmail({ designerName: designer.name, callerName: caller?.name ?? null, location: enquiry.input.location ?? null, startsAt: null, meetingUrl: null,
      phone: caller?.phone ?? null, callerEmail: caller?.email ?? null, details: enquiry.designerNote ?? call?.summary ?? "", transcript: call?.transcript ?? [],
      forDesigner: this.d.designerEmailTo && designer.email !== this.d.designerEmailTo ? designer.name : undefined });
    await this.d.email.send({ to, ...msg, idempotencyKey: item.dedupeKey });
    await this.d.bookings.touchLastAssigned(designer.id, this.d.now()); // rotation: the next callback goes to the next designer
  }

  private async designerNoteUpdate(item: OutboxRow) {
    const enquiry = await this.d.repo.getEnquiry(String(item.payload.enquiryId));
    if (!enquiry?.designerNote) return;
    const handoffs = (await this.d.bookings.handoffsForBooking(String(item.payload.bookingId))).filter((h) => h.telegramMessageId != null && (h.status === "sent" || h.status === "accepted"));
    const h = handoffs[handoffs.length - 1];
    if (!h) return; // not delivered yet, or already reassigned: the new note is built from the stored enquiry anyway
    const designer = await this.d.bookings.getDesigner(h.designerId);
    if (!designer || designer.telegramChatId == null) return;
    const buttons = h.status === "sent" ? buildHandoffNote({ handoffId: h.id, enquiry: { id: enquiry.id, input: enquiry.input, reasonCodes: [], flags: [], createdAt: "" }, start: new Date(), mode: "", principalRequested: false }).buttons : undefined;
    const text = `${h.status === "accepted" ? `✅ Accepted by ${designer.name}\n` : ""}${enquiry.designerNote}`.slice(0, 4096);
    await this.d.notifier.editHandoff(designer.telegramChatId, h.telegramMessageId!, text, buttons);
  }
}
