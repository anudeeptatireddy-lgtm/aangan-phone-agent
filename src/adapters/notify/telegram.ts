import type { HandoffButton, HandoffNote, NotifierPort } from "@/core/ports";

// Method names, parameter names and the 64-byte callback_data limit verified against https://core.telegram.org/bots/api (docs/vendor-findings-s5.md).
export interface TelegramOptions {
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
}

class TelegramError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); this.name = "TelegramError"; }
}

const TEXT_MAX = 4096;
const TRANSIENT = new Set([500, 502, 503, 504]);

export class TelegramNotifier implements NotifierPort {
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxAttempts: number;
  private timeoutMs: number;
  private token: string;

  constructor(o: TelegramOptions) {
    if (!o.token) throw new Error("TelegramNotifier needs a bot token");
    this.token = o.token;
    this.fetchImpl = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = o.maxAttempts ?? 3;
    this.timeoutMs = o.timeoutMs ?? 10_000;
  }

  private keyboard(buttons: HandoffButton[] | undefined) {
    for (const b of buttons ?? []) if (Buffer.byteLength(b.data, "utf8") > 64) throw new Error("Telegram callback_data must be at most 64 bytes");
    return { inline_keyboard: buttons?.length ? [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] : [] };
  }

  /** Never lets the bot token reach an error message or a log line (it is part of the request URL). */
  private scrub(s: string) { return s.split(this.token).join("[token]").replace(/bot\d+:[\w-]+/g, "bot[token]"); }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let last: Error = new Error("telegram: no attempt made");
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal,
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; parameters?: { retry_after?: number } };
        if (res.ok && json.ok) return json.result as T;
        const e = new TelegramError(res.status, this.scrub(`telegram ${method} failed: ${res.status} ${json.description ?? ""}`.trim()), json.parameters?.retry_after);
        if (res.status === 429 || TRANSIENT.has(res.status)) { last = e; if (attempt < this.maxAttempts) await this.sleep(res.status === 429 ? (e.retryAfter ?? 1) * 1000 : 500 * 2 ** (attempt - 1)); continue; }
        throw e;
      } catch (err) {
        if (err instanceof TelegramError && !(err.status === 429 || TRANSIENT.has(err.status))) throw err;
        if (err instanceof TelegramError) { last = err; continue; }
        last = new Error(this.scrub(`telegram ${method} network error: ${(err as Error).message}`));
        if (attempt < this.maxAttempts) await this.sleep(500 * 2 ** (attempt - 1));
      } finally { clearTimeout(timer); }
    }
    throw last;
  }

  async sendHandoff(chatId: number, note: HandoffNote) {
    const r = await this.call<{ message_id: number }>("sendMessage", { chat_id: chatId, text: note.text.slice(0, TEXT_MAX), reply_markup: this.keyboard(note.buttons) });
    return { messageId: r.message_id };
  }
  async sendAlert(chatId: number, text: string) { await this.call("sendMessage", { chat_id: chatId, text: text.slice(0, TEXT_MAX) }); }
  async editHandoff(chatId: number, messageId: number, text: string, buttons?: HandoffButton[]) {
    try {
      await this.call("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, TEXT_MAX), reply_markup: this.keyboard(buttons) });
    } catch (e) {
      if (/message is not modified/i.test((e as Error).message)) return;
      throw e;
    }
  }
  async answerCallback(callbackQueryId: string, text?: string) {
    await this.call("answerCallbackQuery", text === undefined ? { callback_query_id: callbackQueryId } : { callback_query_id: callbackQueryId, text: text.slice(0, 200) });
  }
}
