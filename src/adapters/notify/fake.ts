import type { HandoffNote, NotifierPort } from "@/core/ports";

/** In-memory Telegram stand-in: records messages and can fail on demand. */
export class FakeNotifier implements NotifierPort {
  handoffs: { chatId: number; note: HandoffNote; messageId: number }[] = [];
  alerts: { chatId: number; text: string }[] = [];
  private fail = false;
  private n = 0;
  failNext() { this.fail = true; }

  async sendHandoff(chatId: number, note: HandoffNote) {
    if (this.fail) { this.fail = false; throw new Error("fake telegram failure"); }
    const messageId = 9000 + ++this.n;
    this.handoffs.push({ chatId, note, messageId });
    return { messageId };
  }
  async sendAlert(chatId: number, text: string) {
    if (this.fail) { this.fail = false; throw new Error("fake telegram failure"); }
    this.alerts.push({ chatId, text });
  }
}
