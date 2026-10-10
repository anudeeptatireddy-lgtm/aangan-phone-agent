import type { EmailPort, HandoffButton, NotifierPort } from "@/core/ports";

/**
 * Resend replaces Telegram. There are no buttons: the designer is emailed the project (the `designer_email` outbox job, with the meeting link and the
 * transcript), and that email IS the handoff, so a handoff counts as accepted once it is sent (`confirmsOnSend`) and the 30-minute reassignment never fires.
 * Alerts (design lead / owner / Nikhil) all go to one address.
 */
export class EmailNotifier implements NotifierPort {
  readonly confirmsOnSend = true;
  constructor(private o: { email: EmailPort; alertTo: string }) {}
  async sendHandoff(): Promise<{ messageId: number }> { return { messageId: 0 }; } // the real email is the designer_email job
  async sendAlert(_chatId: number, text: string): Promise<void> {
    const key = `alert:${Buffer.from(text).toString("base64url").slice(0, 120)}`;
    await this.o.email.send({ to: this.o.alertTo, subject: `Aangan alert: ${text.split("\n")[0]!.slice(0, 90)}`, text, idempotencyKey: key });
  }
  async editHandoff(_c: number, _m: number, _t: string, _b?: HandoffButton[]): Promise<void> {}
  async answerCallback(): Promise<void> {}
}
