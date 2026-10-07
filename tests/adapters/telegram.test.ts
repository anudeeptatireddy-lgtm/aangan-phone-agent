import { describe, it, expect } from "vitest";
import { TelegramNotifier } from "@/adapters/notify/telegram";

const TOKEN = "123456:ABC-secret-token";
const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const err = (status: number, description: string, parameters?: unknown) => new Response(JSON.stringify({ ok: false, error_code: status, description, parameters }), { status });

function make(responses: Response[]) {
  const calls: { url: string; body: any }[] = [];
  const sleeps: number[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    return r;
  }) as unknown as typeof fetch;
  return { tg: new TelegramNotifier({ token: TOKEN, fetch: f, sleep: async (ms) => { sleeps.push(ms); } }), calls, sleeps };
}

describe("TelegramNotifier", () => {
  it("sends a handoff with an inline keyboard and returns the message id", async () => {
    const { tg, calls } = make([ok({ message_id: 77 })]);
    const r = await tg.sendHandoff(5, { text: "hello", acceptData: "h:x:a", declineData: "h:x:d", buttons: [{ text: "Accept", data: "h:x:a" }, { text: "Can't take it", data: "h:x:d" }] });
    expect(r).toEqual({ messageId: 77 });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0]!.body).toMatchObject({ chat_id: 5, text: "hello", reply_markup: { inline_keyboard: [[{ text: "Accept", callback_data: "h:x:a" }, { text: "Can't take it", callback_data: "h:x:d" }]] } });
  });
  it("refuses callback data over 64 bytes", async () => {
    const { tg, calls } = make([]);
    await expect(tg.sendHandoff(5, { text: "t", acceptData: "a", declineData: "d", buttons: [{ text: "x", data: "h".repeat(65) }] })).rejects.toThrow(/64/);
    expect(calls).toHaveLength(0);
  });
  it("edits a message; no buttons means an empty keyboard so the buttons disappear", async () => {
    const { tg, calls } = make([ok(true)]);
    await tg.editHandoff(5, 77, "done");
    expect(calls[0]!.url).toMatch(/editMessageText$/);
    expect(calls[0]!.body).toMatchObject({ chat_id: 5, message_id: 77, text: "done", reply_markup: { inline_keyboard: [] } });
  });
  it("treats 'message is not modified' as success", async () => {
    const { tg } = make([err(400, "Bad Request: message is not modified: specified new message content and reply markup are exactly the same")]);
    await expect(tg.editHandoff(5, 77, "same")).resolves.toBeUndefined();
  });
  it("answers callback queries", async () => {
    const { tg, calls } = make([ok(true)]);
    await tg.answerCallback("cq", "Done");
    expect(calls[0]!.url).toMatch(/answerCallbackQuery$/);
    expect(calls[0]!.body).toEqual({ callback_query_id: "cq", text: "Done" });
  });
  it("waits retry_after on 429 and retries", async () => {
    const { tg, sleeps } = make([err(429, "Too Many Requests: retry after 3", { retry_after: 3 }), ok({ message_id: 1 })]);
    await tg.sendAlert(5, "x");
    expect(sleeps).toEqual([3000]);
  });
  it("retries a 5xx, then gives up", async () => {
    const { tg, calls } = make([err(502, "Bad Gateway"), err(502, "Bad Gateway"), err(502, "Bad Gateway")]);
    await expect(tg.sendAlert(5, "x")).rejects.toThrow(/502/);
    expect(calls).toHaveLength(3);
  });
  it("does not retry a 400/403 (e.g. the bot was blocked)", async () => {
    const { tg, calls } = make([err(403, "Forbidden: bot was blocked by the user")]);
    await expect(tg.sendAlert(5, "x")).rejects.toThrow(/403/);
    expect(calls).toHaveLength(1);
  });
  it("never puts the bot token in an error message", async () => {
    const f = (async () => { throw new Error(`connect failed for https://api.telegram.org/bot${TOKEN}/sendMessage`); }) as unknown as typeof fetch;
    const tg = new TelegramNotifier({ token: TOKEN, fetch: f, sleep: async () => undefined });
    const e = (await tg.sendAlert(5, "x").then(() => new Error("no error"), (x) => x as Error));
    expect(String(e.message)).not.toContain(TOKEN);
    expect(String(e.message)).not.toContain("ABC-secret");
  });
  it("truncates text to Telegram's 4096 limit", async () => {
    const { tg, calls } = make([ok({ message_id: 1 })]);
    await tg.sendAlert(5, "x".repeat(5000));
    expect(calls[0]!.body.text.length).toBe(4096);
  });
});
