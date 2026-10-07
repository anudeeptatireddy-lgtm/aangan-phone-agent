import { describe, it, expect } from "vitest";
import { AlertDrainer } from "@/core/postcall/alerts";
import { InMemoryPostCallRepo } from "@/server/postcall-repo";
import { FakeNotifier } from "@/adapters/notify/fake";

const setup = (chat: { owner?: number; nikhil?: number } = { owner: 111, nikhil: 222 }) => {
  const repo = new InMemoryPostCallRepo("pepper-0123456789ab");
  const notifier = new FakeNotifier();
  return { repo, notifier, drainer: new AlertDrainer({ repo, notifier, ownerChatId: chat.owner, nikhilChatId: chat.nikhil }) };
};
const alert = (kind: "owner_alert" | "nikhil_alert", flag = "price_mention") => ({ kind, payload: { flag, vendorCallId: "vc-1", evidence: "around 15 lakh", severity: "high" }, key: `${kind}:${flag}:vc-1` });

describe("alert delivery from the outbox", () => {
  it("sends owner alerts to the owner chat and Nikhil alerts to Nikhil's, then marks them processed", async () => {
    const { repo, notifier, drainer } = setup();
    await repo.enqueue("owner_alert", alert("owner_alert").payload, alert("owner_alert").key);
    await repo.enqueue("nikhil_alert", alert("nikhil_alert", "missed_complaint").payload, alert("nikhil_alert", "missed_complaint").key);
    expect(await drainer.drain()).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(notifier.alerts.map((x) => x.chatId).sort()).toEqual([111, 222]);
    expect(await repo.pendingOutbox(["owner_alert", "nikhil_alert"], 10)).toHaveLength(0);
  });
  it("the message names the problem, the call and the evidence, and never a phone or email", async () => {
    const { repo, notifier, drainer } = setup();
    await repo.enqueue("owner_alert", { ...alert("owner_alert").payload, evidence: "call me on 9876543210 or a@b.com, it'd be around 15 lakh" }, "k");
    await drainer.drain();
    const text = notifier.alerts[0]!.text;
    expect(text).toMatch(/price/i);
    expect(text).toContain("vc-1");
    expect(text).toContain("15 lakh");
    expect(text).not.toMatch(/9876543210|a@b\.com/);
  });
  it("a failed send stays pending (counted), so it is retried", async () => {
    const { repo, notifier, drainer } = setup();
    await repo.enqueue("owner_alert", alert("owner_alert").payload, "k");
    notifier.failNext();
    expect(await drainer.drain()).toMatchObject({ sent: 0, failed: 1 });
    const pending = await repo.pendingOutbox(["owner_alert"], 10);
    expect(pending).toHaveLength(1);
    expect(await drainer.drain()).toMatchObject({ sent: 1 });
  });
  it("no chat id configured: left pending, never dropped", async () => {
    const { repo, drainer } = setup({});
    await repo.enqueue("owner_alert", alert("owner_alert").payload, "k");
    expect(await drainer.drain()).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(await repo.pendingOutbox(["owner_alert"], 10)).toHaveLength(1);
  });
  it("only alert kinds are touched; HubSpot and email items stay for their own workers", async () => {
    const { repo, drainer } = setup();
    await repo.enqueue("hubspot_deal", {}, "h");
    await repo.enqueue("confirmation_email", {}, "e");
    await drainer.drain();
    expect(await repo.pendingOutbox(["hubspot_deal", "confirmation_email"], 10)).toHaveLength(2);
  });
});
