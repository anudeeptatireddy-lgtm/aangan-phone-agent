import type { EmailMessage, EmailPort } from "@/core/ports";

/** In-memory Resend stand-in. Like the real API, a repeated idempotency key does not send twice. */
export class FakeEmail implements EmailPort {
  sent: (EmailMessage & { id: string })[] = [];
  private fail: Error | null = null;
  private n = 0;
  failNext(message = "fake resend failure") { this.fail = new Error(message); }
  async send(m: EmailMessage) {
    if (this.fail) { const e = this.fail; this.fail = null; throw e; }
    const dup = this.sent.find((x) => x.idempotencyKey === m.idempotencyKey);
    if (dup) return { id: dup.id };
    const id = `fake-email-${++this.n}`;
    this.sent.push({ ...m, id });
    return { id };
  }
}
