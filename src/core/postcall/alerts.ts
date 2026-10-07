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
const ALERT_KINDS: OutboxKind[] = ["owner_alert", "nikhil_alert"];
const MAX_ATTEMPTS = 5;

export function alertText(payload: Record<string, unknown>): string {
  const flag = String(payload.flag ?? "other");
  const evidence = payload.evidence ? String(payload.evidence).slice(0, 240) : "";
  const body = `⚠ Aangan agent alert: ${LABEL[flag] ?? flag}\nCall: ${String(payload.vendorCallId ?? "?")}${evidence ? `\n“${evidence}”` : ""}`;
  return (redact({ t: body }) as { t: string }).t; // belt and braces: no phone or email ever leaves in an alert
}

/** Delivers alert items from the outbox. HubSpot / email items are left for their own workers (Session 5). */
export class AlertDrainer {
  constructor(private d: { repo: PostCallRepo; notifier: NotifierPort; ownerChatId?: number; nikhilChatId?: number }) {}

  async drain(limit = 50): Promise<{ sent: number; failed: number; skipped: number }> {
    const out = { sent: 0, failed: 0, skipped: 0 };
    for (const item of await this.d.repo.pendingOutbox(ALERT_KINDS, limit)) {
      const chat = item.kind === "owner_alert" ? this.d.ownerChatId : this.d.nikhilChatId;
      if (chat === undefined) { out.skipped++; continue; } // never dropped: it waits for a destination
      try {
        await this.d.notifier.sendAlert(chat, alertText(item.payload));
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
