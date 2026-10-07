import type { HandoffButton, HandoffNote, NotifierPort } from "@/core/ports";

/** In-memory Telegram stand-in: records messages and can fail on demand. */
export class FakeNotifier implements NotifierPort {
  handoffs: { chatId: number; note: HandoffNote; messageId: number }[] = [];
  alerts: { chatId: number; text: string }[] = [];
  edits: { chatId: number; messageId: number; text: string; buttons?: HandoffButton[] }[] = [];
  callbackAnswers: { id: string; text?: string }[] = [];
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
  async editHandoff(chatId: number, messageId: number, text: string, buttons?: HandoffButton[]) {
    if (this.fail) { this.fail = false; throw new Error("fake telegram failure"); }
    this.edits.push({ chatId, messageId, text, buttons });
  }
  async answerCallback(id: string, text?: string) { this.callbackAnswers.push({ id, text }); }
}
