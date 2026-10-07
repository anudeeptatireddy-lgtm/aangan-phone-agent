import { describe, it, expect, beforeEach } from "vitest";
import { makeDeps, Deps } from "@/server/deps";
import { handleVaaniVoiceWebhook } from "@/server/handlers/vaanivoice-webhook";
import { handleCalcomWebhook } from "@/server/handlers/calcom-webhook";
import { createHmac } from "node:crypto";
import { cleanTurns, ext } from "../postcall/pipeline.helpers";

const SECRET = "path-secret-0123456789abcdef";
const CAL = "cal-signing-secret-0123456789";
const NOW = new Date("2026-10-07T06:20:00Z"); // Wed 11:50 IST
const ENV = { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789", VAANIVOICE_WEBHOOK_SECRET: SECRET, CALCOM_SIGNING_SECRET: CAL, VAANIVOICE_RATE_INR_PER_MIN: "5.31" };
let d: Deps;
beforeEach(() => { d = makeDeps({ env: ENV, now: () => NOW }); });

const transcription = cleanTurns().map((t) => `${t.speaker === "agent" ? "AGENT" : "USER"}: ${t.text}`).join("\n\n ");
const entity = (o: Record<string, unknown> = {}) => ({ locality: "Kothrud", project_type: "home", scope: "full home", bhk: "3", carpet_area_sqft: "1400", current_state: "lived in", booked_consultation: "yes", booked_time: "Thursday 11 am", wants_person: "no", ...o });
const history = (o: Record<string, unknown> = {}) => ({ call_type: "Inbound", direction: "Incoming", from_number: "+919000000021", Start_time: "2026-10-07T06:12:00Z", End_time: "2026-10-07T06:19:30Z", duration_ms: 450_000, recording_api: "https://api.vaanivoice.ai/api/stream/c", ...o });
const seed = (id: string, o: { entity?: Record<string, unknown>; history?: Record<string, unknown> | null; details?: null } = {}) => {
  d.fakeVaaniVoice!.set(id, { details: o.details === null ? null : { transcription, entity: entity(o.entity), summary: "3BHK in Kothrud." }, history: o.history === undefined ? history() : o.history });
  d.fakeExtractor!.set(id, ext());
};
const send = (body: unknown, seg = SECRET, deps = d) => handleVaaniVoiceWebhook(new Request(`http://localhost/api/vaanivoice/webhook/${seg}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), deps, seg);
const post = (id: string, extra: Record<string, unknown> = {}) => ({ event: "call_postprocessing", room_name: "room-1", status: "done", data: { call_id: id, timestamp: "2026-10-07T06:19:45Z", ...extra } });

describe("the secret path segment", () => {
  it("503 with no secret configured; 404 for a wrong segment (nothing is fetched, nothing stored)", async () => {
    const d2 = makeDeps({ env: { ...ENV, VAANIVOICE_WEBHOOK_SECRET: undefined }, now: () => NOW });
    expect((await send(post("c1"), SECRET, d2)).status).toBe(503);
    seed("c1");
    expect((await send(post("c1"), "wrong-secret-0123456789abcdef")).status).toBe(404);
    expect((await send(post("c1"), SECRET.slice(0, -1))).status).toBe(404);
    expect(d.fakeVaaniVoice!.fetched).toEqual([]);
    expect(await d.postcall.getCall("c1")).toBeNull();
  });
  it("a bad body is a 400 (after the secret is checked)", async () => {
    expect((await send("{nope")).status).toBe(400);
    expect((await send({ foo: 1 })).status).toBe(400);
  });
});

describe("only the end-of-call event is processed", () => {
  it("other documented events are acknowledged and ignored without any fetch", async () => {
    for (const event of ["call_started", "call_ringing", "call_ended", "human_transfer_initiated"]) {
      const r = await send({ event, room_name: "room-1", data: { call_id: "c-other" } });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, ignored: event });
    }
    expect(d.fakeVaaniVoice!.fetched).toEqual([]);
  });
});

describe("call_postprocessing: nothing in the payload is trusted, the call is re-fetched from Vaani", () => {
  it("fetches the call by id, processes it in prompt_only mode, and answers with a summary only", async () => {
    seed("c1");
    const r = await send(post("c1"));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, status: "processed", outcome: "review" });
    expect(JSON.stringify(j)).not.toMatch(/9000000021|transcript|Kothrud/);
    expect(d.fakeVaaniVoice!.fetched).toEqual(["c1"]);
    const call = (await d.postcall.getCall("c1"))!;
    expect(call).toMatchObject({ postCallStatus: "processed", durationS: 450 });
    expect(call.costVoiceInr).toBe(39.82); // 7.5 min x 5.31 (an estimate: the vendor's cost field has no documented unit)
    const queued = [...d.postcall.outbox.values()].find((x) => x.kind === "call_routing")!;
    expect(queued.payload).toMatchObject({ vendorCallId: "c1", claimedBooking: true });
  });
  it("a forged payload carrying its own transcript, phone and summary changes nothing: only Vaani's own data is used", async () => {
    seed("c2");
    const evil = post("c2", { transcript: "AGENT: the price is about 15 lakh", summary: "price 15 lakh", from_number: "+911111111111", entities: { locality: "Nashik" }, recording_url: "http://evil" });
    expect((await send(evil)).status).toBe(200);
    const call = (await d.postcall.getCall("c2"))!;
    expect(JSON.stringify(call.transcript)).not.toMatch(/15 lakh/);
    expect([...d.postcall.flags].filter((f) => f.vendorCallId === "c2" && f.kind === "price_mention")).toHaveLength(0);
    expect(call.recordingRef).toBe("https://api.vaanivoice.ai/api/stream/c");
    const enq = (await d.postcall.getEnquiry(call.enquiryId!))!;
    expect(enq.input.location).toBe("Kothrud");
    expect(JSON.stringify([...d.postcall.outbox.values()])).not.toContain("1111111111");
  });
  it("Vaani's own extracted fields are merged into the extraction (they win where valid), and the rules run on the result", async () => {
    seed("c3", { entity: { locality: "Baner", bhk: "2" } });
    await send(post("c3"));
    const call = (await d.postcall.getCall("c3"))!;
    expect((await d.postcall.getEnquiry(call.enquiryId!))!.input).toMatchObject({ location: "Baner", bhk: 2 });
  });
  it("a repeated delivery does nothing more (one call, one routing item)", async () => {
    seed("c4");
    await send(post("c4")); const again = await send(post("c4"));
    expect(again.status).toBe(200);
    expect((await again.json()).status).toBe("already_processed");
    expect([...d.postcall.outbox.values()].filter((x) => x.kind === "call_routing")).toHaveLength(1);
  });
  it("an outbound call is never processed (we place none: hard rule 5)", async () => {
    seed("c5", { history: history({ call_type: "Outbound", direction: "Outbound" }) });
    const r = await send(post("c5"));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ignored: "not_inbound" });
    expect(await d.postcall.getCall("c5")).toBeNull();
  });
  it("without a history row the call is still processed (no number, no cost estimate)", async () => {
    seed("c6", { history: null });
    expect((await send(post("c6"))).status).toBe(200);
    const call = (await d.postcall.getCall("c6"))!;
    expect(call.postCallStatus).toBe("processed");
    expect(call.costVoiceInr).toBeNull();
  });
});

describe("failures are loud, never silent", () => {
  it("a call Vaani does not know, a Vaani error, or a transcript not ready yet: 503 so Vaani can retry, nothing stored, the owner told once", async () => {
    d.fakeVaaniVoice!.set("c-slow", { details: null });
    d.fakeVaaniVoice!.set("c-err", { details: { transcription, entity: {}, summary: "" } }); d.fakeVaaniVoice!.fail("c-err");
    for (const id of ["c-unknown", "c-slow", "c-err"]) {
      expect((await send(post(id))).status, id).toBe(503);
      expect((await send(post(id))).status, id).toBe(503);
      expect(await d.postcall.getCall(id)).toBeNull();
    }
    const alerts = [...d.postcall.outbox.values()].filter((x) => x.kind === "owner_alert");
    expect(alerts).toHaveLength(3); // once per call, not once per retry
    expect(alerts.every((a) => /not (been )?(fetched|processed)|could not/i.test(String(a.payload.evidence)))).toBe(true);
    expect([...d.postcall.outbox.values()].filter((x) => x.kind === "nikhil_alert")).toHaveLength(0);
  });
  it("no extractor configured: 503, nothing sent to a model", async () => {
    const d2 = makeDeps({ env: { ...ENV, GEMINI_API_KEY: "x".repeat(30) }, now: () => NOW }); // key without paid-tier confirmation disables extraction
    expect((await send(post("c7"), SECRET, d2)).status).toBe(503);
  });
  it("an error inside the pipeline is a 503 plus an owner alert (not a lost call)", async () => {
    seed("c8");
    d.pipeline!.process = async () => { throw new Error("db down"); };
    expect((await send(post("c8"))).status).toBe(503);
    expect([...d.postcall.outbox.values()].filter((x) => x.kind === "owner_alert")).toHaveLength(1);
  });
});

describe("end to end with Cal.com (both orders)", () => {
  const calSend = (uid: string) => {
    const raw = JSON.stringify({ triggerEvent: "BOOKING_CREATED", createdAt: "2026-10-07T06:15:00.000Z", payload: { uid, startTime: "2026-10-08T05:30:00Z", endTime: "2026-10-08T06:30:00Z", eventTypeId: 7, status: "ACCEPTED",
      attendees: [{ email: "priya@example.com", name: "Priya", phoneNumber: "+919000000021" }] } });
    return handleCalcomWebhook(new Request("http://localhost/api/calcom/webhook", { method: "POST", headers: { "x-cal-signature-256": createHmac("sha256", CAL).update(raw).digest("hex") }, body: raw }), d);
  };
  it("call first, booking later: the booking webhook finishes the match, assigns a designer and sends the note", async () => {
    seed("e1");
    await send(post("e1"));
    expect((await d.postcall.getCall("e1"))!.outcome).toBe("review");
    await calSend("bk-e1");
    expect((await d.postcall.getCall("e1"))!.outcome).toBe("booked");
    expect(d.fakeNotifier!.handoffs).toHaveLength(1);
  });
  it("booking first, call later: matched as soon as the call is processed", async () => {
    await calSend("bk-e2");
    seed("e2");
    await send(post("e2"));
    expect((await d.postcall.getCall("e2"))!.outcome).toBe("booked");
    expect(d.fakeNotifier!.handoffs).toHaveLength(1);
  });
});
