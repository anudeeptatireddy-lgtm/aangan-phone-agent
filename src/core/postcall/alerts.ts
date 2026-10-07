import { redact } from "@/lib/log";
import type { NotifierPort } from "../ports";
import type { OutboxKind, OutboxRow, PostCallRepo } from "./repo";

const LABEL: Record<string, string> = {
  price_mention: "PRICE SAID BY THE AGENT",
  missed_complaint: "COMPLAINT NOT ESCALATED",
  missing_disclosure: "NO VIRTUAL-ASSISTANT / RECORDING DISCLOSURE",
  rule_disagreement: "RULE DISAGREEMENT (live vs post-call)",
  extraction_failed: "POST-CALL EXTRACTION FAILED",
  other: "ATTENTION NEEDED",
};
const ALERT_KINDS: OutboxKind[] = ["owner_alert", "nikhil_alert", "design_lead_alert"];
const MAX_ATTEMPTS = 5;

export function alertText(payload: Record<string, unknown>): string {
  const flag = String(payload.flag ?? "other");
  const evidence = payload.evidence ? String(payload.evidence).slice(0, 240) : "";
  const body = `⚠ Aangan agent alert: ${LABEL[flag] ?? flag}\nCall: ${String(payload.vendorCallId ?? "?")}${evidence ? `\n“${evidence}”` : ""}`;
  return (redact({ t: body }) as { t: string }).t; // belt and braces: no phone or email ever leaves in an alert
}

const DL_TITLE: Record<string, string> = {
  booking_missing: "The caller was told a consultation is booked, but no booking was found. They believe they are booked. A front-desk callback is queued.",
  booking_ambiguous: "Several Cal.com bookings fit one call. Link it to the right one by hand and assign a designer.",
  booking_orphan: "A Cal.com booking has no matching call. Check where it came from.",
  booking_not_fit: "A booking exists for an enquiry the rules did not call a fit. No designer was assigned. Decide what to do.",
  booking_no_designer: "A booking was matched but no eligible designer is free at that time. Assign one by hand.",
  booking_no_enquiry: "A booking matched a call that has no saved enquiry. Link it by hand.",
  booking_cancelled: "A booked consultation was cancelled in Cal.com.",
  booking_rescheduled: "A booked consultation was rescheduled in Cal.com.",
  complaint_callback: "A complaint / existing-client caller needs a senior callback.",
};
const ICON: Record<string, string> = { urgent: "🚨 URGENT", normal: "⚠", low: "ℹ" };
const istLabel = (iso: unknown) => {
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
};

/** What the design lead reads. No phone or email is ever in it (belt and braces below). */
export function designLeadText(payload: Record<string, unknown>): string {
  const kind = String(payload.kind ?? "other");
  const lines = [`${ICON[String(payload.priority)] ?? "⚠"} ${DL_TITLE[kind] ?? `Attention needed (${kind}).`}`];
  if (payload.vendorCallId) lines.push(`Call: ${String(payload.vendorCallId)}`);
  const uids = Array.isArray(payload.bookingUids) ? payload.bookingUids : payload.bookingUid ? [payload.bookingUid] : [];
  if (uids.length) lines.push(`Cal.com booking${uids.length > 1 ? "s" : ""}: ${uids.map(String).join(", ")}`);
  const when = payload.startsAt ? istLabel(payload.startsAt) : null;
  if (when) lines.push(`Consultation: ${when} IST`);
  const due = payload.callbackDueAt ? istLabel(payload.callbackDueAt) : null;
  if (due) lines.push(`Front-desk callback due: ${due} IST`);
  if (payload.evidence) lines.push(`“${String(payload.evidence).slice(0, 200)}”`);
  return (redact({ t: lines.join("\n") }) as { t: string }).t;
}

/** Delivers alert items from the outbox. HubSpot / email items are left for the OutboxRunner. */
export class AlertDrainer {
  constructor(private d: { repo: PostCallRepo; notifier: NotifierPort; ownerChatId?: number; nikhilChatId?: number;
    /** The design lead's Telegram chat (design_lead_alert items wait until there is one). */
    designLeadChat?: () => Promise<number | null> }) {}

  async drain(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
    const out = { sent: 0, failed: 0, skipped: 0 };
    for (const item of await this.d.repo.pendingOutbox(ALERT_KINDS, limit)) {
      const chat = item.kind === "owner_alert" ? this.d.ownerChatId : item.kind === "nikhil_alert" ? this.d.nikhilChatId : (await this.d.designLeadChat?.()) ?? undefined;
      if (chat === undefined) { out.skipped++; continue; } // never dropped: it waits for a destination
      try {
        await this.d.notifier.sendAlert(chat, item.kind === "design_lead_alert" ? designLeadText(item.payload) : alertText(item.payload));
        await this.d.repo.markOutbox(item.id, "processed");
        out.sent++;
      } catch (err) {
        out.failed++;
        await this.d.repo.markOutbox(item.id, this.nextStatus(item), String(err).slice(0, 200));
      }
    }
    return out;
  }
  private nextStatus(item: OutboxRow): "pending" | "failed" { return item.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending"; }
}
