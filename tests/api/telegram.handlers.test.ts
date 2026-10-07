import { describe, it, expect, beforeEach } from "vitest";
import { makeDeps, MemoryDeps as Deps } from "@/server/deps";
import { handleTelegramWebhook } from "@/server/handlers/telegram-webhook";

const SECRET = "tg-secret-0123456789";
const NOW = new Date("2026-10-07T05:00:00Z"); // 10:30 IST Wednesday
let d: Deps;
beforeEach(() => {
  d = makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789", TELEGRAM_WEBHOOK_SECRET: SECRET }, now: () => NOW });
});
const send = (body: unknown, secret: string | null = SECRET) =>
  handleTelegramWebhook(new Request("http://localhost/api/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) }, body: JSON.stringify(body) }), d);

async function book() {
  const e = d.enquiries.create({ callerName: "Priya", callerEmail: "p@example.com", input: { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, decision_maker: "owner" } as never, fit: "fit", reasonCodes: [], nextAction: "proceed_to_booking", flags: [], ruleVersion: "v1", createdAt: NOW.toISOString() });
  const slots = await d.booking.getSlots({ enquiry: e });
  const r = await d.booking.bookSlot({ enquiry: e, start: slots.slots[0]!.start });
  if (!r.ok) throw new Error(JSON.stringify(r));
  const [h] = await d.bookingRepo.handoffsForBooking(r.booking_id);
  const chat = (await d.bookingRepo.getDesigner(h!.designerId))!.telegramChatId!;
  return { h: h!, chat };
}
const cb = (updateId: number, data: string, chat: number) => ({ update_id: updateId, callback_query: { id: `cq${updateId}`, from: { id: chat }, message: { message_id: 1, chat: { id: chat } }, data } });

describe("POST /api/telegram/webhook", () => {
  it("rejects a missing or wrong secret token and does nothing", async () => {
    const { h, chat } = await book();
    expect((await send(cb(1, `h:${h.id}:a`, chat), null)).status).toBe(401);
    expect((await send(cb(1, `h:${h.id}:a`, chat), "wrong-secret-0123456789")).status).toBe(401);
    expect((await d.bookingRepo.getHandoff(h.id))!.status).toBe("sent");
  });
  it("503 if no secret is configured: never accept unauthenticated updates", async () => {
    const d2 = makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789" }, now: () => NOW });
    const r = await handleTelegramWebhook(new Request("http://x", { method: "POST", body: "{}" }), d2);
    expect(r.status).toBe(503);
  });
  it("an Accept press accepts the handoff", async () => {
    const { h, chat } = await book();
    expect((await send(cb(10, `h:${h.id}:a`, chat))).status).toBe(200);
    expect((await d.bookingRepo.getHandoff(h.id))!.status).toBe("accepted");
  });
  it("a redelivered update (same update_id) is processed once", async () => {
    const { h, chat } = await book();
    await send(cb(11, `h:${h.id}:d`, chat));
    const n = (await d.bookingRepo.handoffsForBooking(h.bookingId)).length;
    const r = await send(cb(11, `h:${h.id}:d`, chat));
    expect(await r.json()).toMatchObject({ duplicate: true });
    expect((await d.bookingRepo.handoffsForBooking(h.bookingId)).length).toBe(n);
  });
  it("other updates (plain messages, junk) are acknowledged with 200 so Telegram does not retry", async () => {
    expect((await send({ update_id: 12, message: { text: "hi", chat: { id: 1 } } })).status).toBe(200);
    expect((await send({ junk: true })).status).toBe(200);
  });
  it("invalid JSON is a 400", async () => {
    const r = await handleTelegramWebhook(new Request("http://x", { method: "POST", headers: { "x-telegram-bot-api-secret-token": SECRET }, body: "{not json" }), d);
    expect(r.status).toBe(400);
  });
});
