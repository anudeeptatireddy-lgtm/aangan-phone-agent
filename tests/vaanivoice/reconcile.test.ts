import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { makeDeps, MemoryDeps } from "@/server/deps";
import { reconcileVaani, GRACE_MS, PENDING_MS, STALE_MS, MAX_PER_RUN } from "@/server/vaanivoice-reconcile";
import { handleTick } from "@/server/handlers/tick";
import { handleCalcomWebhook } from "@/server/handlers/calcom-webhook";
import { cleanTurns, ext } from "../postcall/pipeline.helpers";

// The retry gap: Vaani documents no retry for a webhook that failed, so the tick reads Vaani's call history and processes any inbound call we never processed.
const NOW = new Date("2026-10-07T07:00:00Z");
const MIN = 60_000;
const ENV = { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789", CRON_SECRET: "cron-secret-0123456789", CALCOM_SIGNING_SECRET: "cal-signing-secret-0123456789" };
let d: MemoryDeps; let clock: { t: Date };

const transcription = cleanTurns().map((t) => `${t.speaker === "agent" ? "AGENT" : "USER"}: ${t.text}`).join("\n\n ");
const iso = (minAgo: number) => new Date(clock.t.getTime() - minAgo * MIN).toISOString();
/** A call that ended `endedMinAgo` minutes ago (5 minutes long). */
function vaaniCall(id: string, endedMinAgo: number, o: { status?: string; details?: boolean; direction?: string; callType?: string; phone?: string; entity?: Record<string, unknown> } = {}) {
  d.fakeVaaniVoice!.set(id, {
    details: o.details === false ? null : { transcription, entity: { locality: "Kothrud", project_type: "home", scope: "full home", bhk: "3", carpet_area_sqft: "1400", booked_consultation: "yes", ...o.entity }, summary: "3BHK in Kothrud." },
    history: { call_type: o.callType ?? "Inbound", direction: o.direction ?? "Incoming", from_number: o.phone ?? "+919000000021", Start_time: iso(endedMinAgo + 5), End_time: iso(endedMinAgo), duration_ms: 300_000, post_processing_status: o.status ?? "completed" },
  });
  d.fakeExtractor!.set(id, ext());
}
beforeEach(() => { clock = { t: NOW }; d = makeDeps({ env: ENV, now: () => clock.t }); });
const rows = () => [...d.postcall.calls.values()];
const stats = (r: Awaited<ReturnType<typeof reconcileVaani>>) => { const { skipped: _s, ...rest } = r; return rest; };

describe("a call whose webhook never arrived (or failed) is recovered from Vaani's history", () => {
  it("processes an inbound call that ended more than 10 minutes ago and that we have no record of", async () => {
    vaaniCall("lost-1", 20);
    expect(stats(await reconcileVaani(d))).toEqual({ checked: 1, recovered: 1, waiting: 0, failedRecorded: 0 });
    const c = (await d.postcall.getCall("lost-1"))!;
    expect(c).toMatchObject({ postCallStatus: "processed", durationS: 300 });
    expect([...d.postcall.outbox.values()].some((o) => o.kind === "call_routing")).toBe(true); // the rest of the pipeline ran: it is a normal call now
    expect(d.fakeVaaniVoice!.fetched).toEqual(["lost-1"]);
  });
  it("uses the call's own end time, and the caller number from the history row (so the booking can be matched by phone)", async () => {
    vaaniCall("lost-2", 30, { phone: "+919000000077" });
    await reconcileVaani(d);
    const c = (await d.postcall.getCall("lost-2"))!;
    expect(c.endedAt!.toISOString()).toBe(iso(30));
    expect(c.callerId).toBeTruthy();
  });
  it("is idempotent: running again does nothing more and fetches nothing", async () => {
    vaaniCall("lost-3", 20);
    await reconcileVaani(d); const fetched = [...d.fakeVaaniVoice!.fetched];
    expect(stats(await reconcileVaani(d))).toEqual({ checked: 0, recovered: 0, waiting: 0, failedRecorded: 0 });
    expect(d.fakeVaaniVoice!.fetched).toEqual(fetched);
    expect(rows()).toHaveLength(1);
  });
  it("leaves a call alone for 10 minutes after it ends: its webhook is probably still on the way", async () => {
    vaaniCall("fresh", 9);
    expect(stats(await reconcileVaani(d))).toMatchObject({ checked: 0, recovered: 0 });
    expect(rows()).toHaveLength(0);
    clock.t = new Date(clock.t.getTime() + 2 * MIN);
    expect(stats(await reconcileVaani(d))).toMatchObject({ recovered: 1 });
    expect(GRACE_MS).toBe(10 * MIN);
  });
  it("never touches outbound calls (hard rule 5), calls we already processed, or calls older than three days", async () => {
    vaaniCall("out", 30, { callType: "Outbound", direction: "Outbound" });
    vaaniCall("old", 4 * 24 * 60);
    vaaniCall("done", 30);
    await d.pipeline!.process({ vendor: "vaanivoice", vendorCallId: "done", endedAt: iso(30), rangAt: iso(35), durationS: 300, endedReason: "completed", transcript: cleanTurns() });
    const before = d.fakeVaaniVoice!.fetched.length;
    expect(stats(await reconcileVaani(d))).toEqual({ checked: 0, recovered: 0, waiting: 0, failedRecorded: 0 });
    expect(d.fakeVaaniVoice!.fetched.length).toBe(before);
    expect(await d.postcall.getCall("out")).toBeNull(); expect(await d.postcall.getCall("old")).toBeNull();
  });
  it("a call stuck half-processed (a row that stayed 'pending') is retried after 30 minutes, not before (the webhook may be mid-flight)", async () => {
    vaaniCall("stuck", 20);
    await d.postcall.upsertCall("stuck", { endedAt: new Date(clock.t.getTime() - 20 * MIN) }); // pending
    expect(stats(await reconcileVaani(d))).toMatchObject({ checked: 0, recovered: 0 });
    clock.t = new Date(clock.t.getTime() + 11 * MIN);
    expect(stats(await reconcileVaani(d))).toMatchObject({ recovered: 1 });
    expect((await d.postcall.getCall("stuck"))!.postCallStatus).toBe("processed");
    expect(PENDING_MS).toBe(30 * MIN);
  });
  it("does at most 5 calls per run, oldest first, so a long outage catches up over a few ticks without timing out", async () => {
    for (let i = 0; i < 8; i++) vaaniCall(`b${i}`, 100 - i * 5);
    expect(stats(await reconcileVaani(d))).toMatchObject({ recovered: MAX_PER_RUN });
    expect(rows().map((r) => r.vendorCallId).sort()).toEqual(["b0", "b1", "b2", "b3", "b4"]);
    expect(stats(await reconcileVaani(d))).toMatchObject({ recovered: 3 });
    expect(rows()).toHaveLength(8);
  });
});

describe("when Vaani is not ready, the call waits and is retried; it is never lost silently", () => {
  it("Vaani still post-processing: no lookup is made and nothing is recorded yet", async () => {
    vaaniCall("slow", 20, { status: "processing" });
    expect(stats(await reconcileVaani(d))).toEqual({ checked: 1, recovered: 0, waiting: 1, failedRecorded: 0 });
    expect(d.fakeVaaniVoice!.fetched).toEqual([]);
    expect(rows()).toHaveLength(0);
    expect([...d.postcall.outbox.values()]).toHaveLength(0);
  });
  it("a transcript that is not ready, or a Vaani error, waits quietly and succeeds on a later run", async () => {
    vaaniCall("nr", 20, { details: false }); vaaniCall("err", 25);
    d.fakeVaaniVoice!.fail("err");
    expect(stats(await reconcileVaani(d))).toMatchObject({ recovered: 0, waiting: 2, failedRecorded: 0 });
    expect([...d.postcall.outbox.values()]).toHaveLength(0);
    vaaniCall("nr", 20); d.fakeVaaniVoice!.fail("err", "recovered");
    d.fakeVaaniVoice!.set("err", { details: { transcription, entity: {}, summary: "x" }, history: { call_type: "Inbound", direction: "Incoming", from_number: "+919000000022", Start_time: iso(30), End_time: iso(25), duration_ms: 300_000, post_processing_status: "completed" } });
    d.fakeVaaniVoice!.heal("err");
    expect(stats(await reconcileVaani(d))).toMatchObject({ recovered: 2 });
  });
  it("after an hour of failing, the call is recorded as FAILED so it shows on the dashboard, and the owner is told once", async () => {
    vaaniCall("never", 20, { details: false });
    await reconcileVaani(d);
    clock.t = new Date(NOW.getTime() + STALE_MS);              // the call ended > 60 min ago and still cannot be read
    expect(stats(await reconcileVaani(d))).toMatchObject({ failedRecorded: 1, recovered: 0 });
    const c = (await d.postcall.getCall("never"))!;
    expect(c).toMatchObject({ postCallStatus: "extraction_failed", outcome: "review", endedReason: "failed" });
    const alerts = [...d.postcall.outbox.values()].filter((o) => o.kind === "owner_alert");
    expect(alerts).toHaveLength(1);
    expect(stats(await reconcileVaani(d))).toMatchObject({ checked: 0, failedRecorded: 0 }); // not repeated
    expect([...d.postcall.outbox.values()].filter((o) => o.kind === "owner_alert")).toHaveLength(1);
    expect([...d.postcall.outbox.values()].some((o) => o.kind === "nikhil_alert")).toBe(false);
  });
  it("a call Vaani never finished reading ('not_processed' for over an hour) is also recorded as failed", async () => {
    vaaniCall("np", 90, { status: "not_processed" });
    expect(stats(await reconcileVaani(d))).toMatchObject({ failedRecorded: 1 });
    expect((await d.postcall.getCall("np"))!.endedReason).toBe("failed");
  });
});

describe("a recovered call is a normal call", () => {
  it("is matched to its Cal.com booking, assigned a designer, and ends 'booked'", async () => {
    vaaniCall("m1", 20, { phone: "+919000000021" });
    const created = new Date(clock.t.getTime() - 22 * MIN).toISOString(); // inside the call's window
    const raw = JSON.stringify({ triggerEvent: "BOOKING_CREATED", createdAt: created, payload: { uid: "bk-m1", startTime: "2026-10-08T05:30:00Z", endTime: "2026-10-08T06:30:00Z", eventTypeId: 7, status: "ACCEPTED", attendees: [{ email: "priya@example.com", name: "Priya", phoneNumber: "+919000000021" }] } });
    await handleCalcomWebhook(new Request("http://x", { method: "POST", headers: { "x-cal-signature-256": createHmac("sha256", ENV.CALCOM_SIGNING_SECRET).update(raw).digest("hex") }, body: raw }), d);
    await reconcileVaani(d);
    expect((await d.postcall.getCall("m1"))!.outcome).toBe("booked");
    expect(d.fakeNotifier!.handoffs).toHaveLength(1);
  });
});

describe("the tick runs it", () => {
  const tick = () => handleTick(new Request("http://x/api/cron/tick", { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } }), d);
  it("as one isolated step, reported in the tick's answer", async () => {
    vaaniCall("t1", 20);
    const body = await (await tick()).json();
    expect(body.vaani).toEqual({ checked: 1, recovered: 1, waiting: 0, failedRecorded: 0 });
    expect((await d.postcall.getCall("t1"))!.postCallStatus).toBe("processed");
  });
  it("an unexpected crash inside the step does not stop the other steps", async () => {
    vaaniCall("boom", 20);
    d.postcall.getCall = async () => { throw new Error("database unavailable"); };
    const body = await (await tick()).json();
    expect(body).toMatchObject({ ok: false, vaani: { error: expect.stringContaining("database") }, outbox: { processed: 0 } });
  });
  it("is skipped, quietly, when the post-call pipeline is not configured (nothing could be done with the calls)", async () => {
    const d2 = makeDeps({ env: { ...ENV, GEMINI_API_KEY: "x".repeat(30) }, now: () => clock.t }); // key without the paid-tier confirmation: extraction disabled
    expect(await reconcileVaani(d2)).toMatchObject({ skipped: "extractor_not_configured" });
  });
});

describe("Vaani's call history is down (it is, for this account: HTTP 500 \"Invalid client_id format\")", () => {
  it("a webhook call is STILL processed: history only adds the caller's number and times, it is never a reason to lose a call", async () => {
    vaaniCall("h1", 20);
    d.fakeVaaniVoice!.historyDown();
    const { processVaaniCall } = await import("@/server/vaanivoice-process");
    const r = await processVaaniCall(d, "h1", { eventTimestamp: iso(20) });
    expect(r.kind).toBe("processed");
    const c = (await d.postcall.getCall("h1"))!;
    expect(c.postCallStatus).toBe("processed");
    expect(c.callerId).toBeNull();                      // no number without history: matching falls back to email, then the only candidate
    expect(c.answeredAt).toBeTruthy();                  // it had a conversation, so it counts as answered
    expect(c.rangAt).toBeNull();                        // and no invented start time (so no invented 'time to answer')
  });
  it("the reconciler cannot list calls, says so (no crash, nothing invented), and tells the owner once per day", async () => {
    vaaniCall("h2", 20);
    d.fakeVaaniVoice!.historyDown();
    const r = await reconcileVaani(d);
    expect(r).toMatchObject({ checked: 0, recovered: 0, skipped: "vaani_history_unavailable" });
    expect(rows()).toHaveLength(0);
    await reconcileVaani(d); await reconcileVaani(d);
    const alerts = [...d.postcall.outbox.values()].filter((o) => o.kind === "owner_alert");
    expect(alerts).toHaveLength(1);
    expect(String(alerts[0]!.payload.evidence)).toMatch(/call history/i);
    expect(String(alerts[0]!.payload.evidence)).not.toMatch(/\+91|vaani_[a-z0-9]/i);
    clock.t = new Date(clock.t.getTime() + 25 * 3_600_000);           // the next day: still broken, tell them again
    await reconcileVaani(d);
    expect([...d.postcall.outbox.values()].filter((o) => o.kind === "owner_alert")).toHaveLength(2);
  });
  it("when it comes back, the lost call is recovered with its number", async () => {
    vaaniCall("h3", 20, { phone: "+919000000055" });
    d.fakeVaaniVoice!.historyDown();
    await reconcileVaani(d);
    d.fakeVaaniVoice!.historyUp();
    expect(stats(await reconcileVaani(d))).toMatchObject({ recovered: 1 });
    expect((await d.postcall.getCall("h3"))!.callerId).toBeTruthy();
  });
  it("the tick keeps going and stays healthy (the owner alert is the signal, not a failing tick every minute)", async () => {
    d.fakeVaaniVoice!.historyDown();
    const body = await (await handleTick(new Request("http://x/api/cron/tick", { headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } }), d)).json();
    expect(body).toMatchObject({ ok: true, vaani: { skipped: "vaani_history_unavailable" } });
  });
});
