import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { makeDeps, Deps } from "@/server/deps";
import { handleTool } from "@/server/handlers/tools";
import { handleProcessCall, handleDrainOutbox } from "@/server/handlers/post-call";
import { handleVaaniWebhook } from "@/server/handlers/vaani-webhook";
import { GeminiExtractor } from "@/adapters/llm/gemini";
import { FakeExtractor } from "@/adapters/llm/fake";
import { cleanTurns, ext, OPEN, a, c } from "../postcall/pipeline.helpers";

const SECRET = "tool-secret-0123456789";
const WHK = "vv_whk_secret";
const ENV = { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: SECRET, VAANI_WEBHOOK_SECRET: WHK, FRONT_DESK_NUMBER: "+919000000000", DESIGN_LEAD_NUMBER: "+919000000001",
  OWNER_TELEGRAM_CHAT_ID: "111", NIKHIL_TELEGRAM_CHAT_ID: "222" };
const NOW = new Date("2026-10-07T06:30:00Z"); // Wed 12:00 IST
const mk = (env: Record<string, string | undefined> = ENV) => makeDeps({ env, now: () => NOW });
const req = (body: unknown, auth: string | null = `Bearer ${SECRET}`) => new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
const tool = async (t: Parameters<typeof handleTool>[0], body: unknown, d: Deps) => { const r = await handleTool(t, req(body), d); return { status: r.status, json: await r.json() }; };
const process_ = async (body: unknown, d: Deps) => { const r = await handleProcessCall(req(body), d); return { status: r.status, json: await r.json() }; };

const T01 = { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, deadline_date: "2027-03-31", decision_maker: "owner", owners_attending: true };
const callBody = (id: string, o: Record<string, unknown> = {}) => ({ vendor: "fake", vendorCallId: id, callerPhone: "+919000000021", rangAt: "2026-10-07T06:12:00Z", answeredAt: "2026-10-07T06:12:03Z",
  endedAt: "2026-10-07T06:19:30Z", durationS: 450, endedReason: "completed", transcript: cleanTurns(), ...o });

let d: Deps;
beforeEach(() => { d = mk(); });

describe("the live tools leave a trail the post-call pipeline can use (when a call_id is supplied)", () => {
  it("lookup_caller links the call to the caller; check_fit mirrors the enquiry and records the LIVE evaluation; request_human records the escalation", async () => {
    await tool("lookup_caller", { phone: "9000000021", call_id: "vc-9" }, d);
    const call = (await d.postcall.getCall("vc-9"))!;
    expect(call.callerId).toBeTruthy();
    const fit = await tool("check_fit", { ...T01, call_id: "vc-9", phone: "9000000021" }, d);
    const afterFit = (await d.postcall.getCall("vc-9"))!;
    expect(afterFit.enquiryId).toBe(fit.json.enquiry_id);
    expect(await d.postcall.getEnquiry(fit.json.enquiry_id)).toMatchObject({ fit: "fit", ruleVersion: "v1" });
    expect(await d.postcall.latestEvaluation("vc-9", "live")).toMatchObject({ fit: "fit", ruleVersion: "v1" });
    await tool("request_human", { reason: "review", call_id: "vc-9" }, d);
    expect((await d.postcall.escalationsForCall("vc-9")).map((e) => e.reason)).toEqual(["review"]);
  });
  it("without a call_id nothing extra is stored (the tools still work exactly as before)", async () => {
    const r = await tool("check_fit", T01, d);
    expect(r.json.result).toBe("fit");
    expect(d.postcall.calls.size).toBe(0);
  });
  it("the mirrored enquiry keeps the live enquiry's id, so a booking made against it is found by the pipeline", async () => {
    const fit = await tool("check_fit", { ...T01, call_id: "vc-8" }, d);
    expect((await d.postcall.getEnquiry(fit.json.enquiry_id))!.id).toBe(fit.json.enquiry_id);
  });
});

describe("POST /api/calls/process", () => {
  it("requires the tool secret, a valid body, and a configured extractor", async () => {
    expect((await handleProcessCall(req(callBody("x"), null), d)).status).toBe(401);
    expect((await process_({ vendorCallId: "x" }, d)).status).toBe(400);
    const prod = mk({ ...ENV, NODE_ENV: "production" });
    expect((await process_(callBody("x"), prod)).status).toBe(503);
  });
  it("runs the pipeline and returns the summary (never the transcript or phone)", async () => {
    (d.fakeExtractor as FakeExtractor).set("vc-1", ext());
    const r = await process_(callBody("vc-1"), d);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: "processed", vendorCallId: "vc-1", flags: [] });
    expect(JSON.stringify(r.json)).not.toMatch(/9000000021|priya@example\.com|Namaste/);
  });
});

describe("end to end: live call -> booking -> post-call", () => {
  it("lookup -> check_fit -> get_slots -> book_slot -> process: outcome booked, designer note, deal + email queued, cost logged", async () => {
    await tool("lookup_caller", { phone: "9000000021", call_id: "vc-e2e", intent: "new_enquiry" }, d);
    const fit = await tool("check_fit", { ...T01, call_id: "vc-e2e", phone: "9000000021", caller_name: "Priya", caller_email: "priya@example.com" }, d);
    const slots = await tool("get_slots", { enquiry_id: fit.json.enquiry_id }, d);
    const booked = await tool("book_slot", { enquiry_id: fit.json.enquiry_id, start: slots.json.slots[0].start }, d);
    expect(booked.json.ok).toBe(true);
    (d.fakeExtractor as FakeExtractor).set("vc-e2e", ext());
    const r = await process_(callBody("vc-e2e"), d);
    expect(r.json).toMatchObject({ status: "processed", outcome: "booked", enquiryId: fit.json.enquiry_id, flags: [] });
    const e = (await d.postcall.getEnquiry(fit.json.enquiry_id))!;
    expect(e.designerNote).toContain("Booked:");
    expect(e.designerNote).toContain("Call: 7 min 30 s");
    expect([...d.postcall.outbox.values()].map((o) => o.kind).sort()).toEqual(["confirmation_email", "hubspot_deal"]);
    expect((await d.postcall.getCall("vc-e2e"))!.costAiInr).toBeGreaterThan(0);
  });
  it("a price slip on a real call raises an alert that the drain endpoint delivers to the owner", async () => {
    (d.fakeExtractor as FakeExtractor).set("vc-slip", ext());
    await process_(callBody("vc-slip", { transcript: [a(OPEN), c("How much would it cost?"), a("Around 15 lakh, roughly.")] }), d);
    const r = await handleDrainOutbox(req({}), d);
    expect(await r.json()).toMatchObject({ sent: 1 });
    expect(d.notifier.alerts[0]).toMatchObject({ chatId: 111 });
    expect(d.notifier.alerts[0]!.text).toContain("PRICE SAID BY THE AGENT");
  });
  it("drain requires the secret", async () => {
    expect((await handleDrainOutbox(req({}, null), d)).status).toBe(401);
  });
});

describe("extractor selection (hard rule 6: paid tier only)", () => {
  it("a Gemini key WITHOUT paid-tier confirmation refuses to start", () => {
    expect(() => mk({ ...ENV, GEMINI_API_KEY: "AIzaFAKEKEYFORTESTS0123456789abcdefgh" })).toThrow(/paid/i);
  });
  it("key + confirmation -> the real Gemini adapter", () => {
    expect(mk({ ...ENV, GEMINI_API_KEY: "AIzaFAKEKEYFORTESTS0123456789abcdefgh", GEMINI_PAID_TIER_CONFIRMED: "true" }).extractor).toBeInstanceOf(GeminiExtractor);
  });
  it("no key: a scripted fake in dev/test, NOTHING in production", () => {
    expect(mk().extractor).toBeInstanceOf(FakeExtractor);
    expect(mk({ ...ENV, NODE_ENV: "production" }).extractor).toBeUndefined();
  });
});

describe("Vaani end-of-call webhook (payload fields are undocumented, so it is acknowledged, stored and escalated, never guessed)", () => {
  const body = (id: string) => JSON.stringify({ id, type: "call.completed", created: 1714003200, data: { phone: "+91 98••••••10", something: "unknown shape" } });
  const send = (b: string) => handleVaaniWebhook(new Request("http://localhost/api/vaani/webhook", { method: "POST", headers: { "x-vaanivoice-signature": "sha256=" + createHmac("sha256", WHK).update(b).digest("hex") }, body: b }), d);
  it("200s a valid call.completed, marks it unmapped, and alerts the owner once per event type", async () => {
    const r1 = await send(body("evt_1"));
    expect(await r1.json()).toMatchObject({ ok: true, duplicate: false, mapped: false });
    await send(body("evt_2"));
    const alerts = [...d.postcall.outbox.values()].filter((o) => o.kind === "owner_alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({ flag: "other" });
    expect(d.repo.webhookEvents.find((e) => e.id === "evt_1")).toMatchObject({ status: "unmapped" });
  });
  it("retries of the same event do nothing more", async () => {
    await send(body("evt_3"));
    const again = await send(body("evt_3"));
    expect(await again.json()).toMatchObject({ duplicate: true });
  });
});
