import { describe, it, expect } from "vitest";
import { a, book, c, cleanTurns, ext, liveEnquiry, makeAll, OPEN, record } from "./pipeline.helpers";
import { computeAiCost } from "@/core/postcall/costs";
import { GEMINI_EXTRACTION_MODEL } from "@/config/models";

const kinds = (r: { flags: string[] }) => [...r.flags].sort();

describe("a normal booked call", () => {
  async function run() {
    const t = makeAll();
    t.extractor.set("vc-1", ext());
    const live = await liveEnquiry(t.repo, "vc-1");
    const booking = await book(t.bookings, live.id);
    const r = await t.pipeline.process(record("vc-1"));
    return { ...t, live, booking, r };
  }
  it("is processed: outcome booked, no flags, disclosure ok, retention set, transcript stored", async () => {
    const { repo, r, live } = await run();
    expect(r).toMatchObject({ status: "processed", outcome: "booked", enquiryId: live.id, flags: [] });
    const call = (await repo.getCall("vc-1"))!;
    expect(call).toMatchObject({ outcome: "booked", intent: "new_enquiry", disclosureOk: true, postCallStatus: "processed", durationS: 450, afterHours: false, endedReason: "completed", recordingRef: "rec/vc-1" });
    expect(call.summary).toContain("3BHK");
    expect(call.transcript).toHaveLength(7);
    expect(call.recordingExpiresAt!.toISOString()).toBe("2027-01-05T06:19:30.000Z"); // endedAt + 90 days
    expect(call.processedAt).toEqual(new Date("2026-10-07T06:20:00Z"));
  });
  it("re-runs the rules engine on the extraction (post_call) next to the live evaluation, and keeps the live result", async () => {
    const { repo, live } = await run();
    expect(await repo.latestEvaluation("vc-1", "post_call")).toMatchObject({ fit: "fit", ruleVersion: "v1", enquiryId: live.id });
    expect((await repo.getEnquiry(live.id))!.fit).toBe("fit");
  });
  it("logs AI cost per call: ledger rows + roll-up on the call", async () => {
    const { repo, extractor } = await run();
    const expected = computeAiCost(extractor.usage, GEMINI_EXTRACTION_MODEL);
    expect(repo.costs).toHaveLength(1);
    expect(repo.costs[0]!.rows.map((x) => x.line)).toEqual(["ai_tokens_in", "ai_tokens_out"]);
    const call = (await repo.getCall("vc-1"))!;
    expect(call.costAiInr).toBeCloseTo(expected.totalInr, 6);
    expect(call.costTotalInr).toBeCloseTo(expected.totalInr, 6); // voice cost arrives with the Vaani usage sync
    expect(call.costVoiceInr).toBeNull();
  });
  it("drafts the designer note: structured facts + a neutral summary + call length, no phone or email", async () => {
    const { repo, live } = await run();
    const note = (await repo.getEnquiry(live.id))!.designerNote!;
    expect(note).toContain("NEW CONSULTATION · Qualified");
    expect(note).toContain("Booked: Thursday 8 October, 11:00 am");
    expect(note).toContain("Summary: 3BHK full redesign in Kothrud, owners attending.");
    expect(note).toContain("Call: 7 min 30 s");
    expect(note).not.toMatch(/priya@example\.com|\+?91\s?9000000021|9000000021/);
  });
  it("queues the follow-ups: HubSpot deal and the caller's confirmation email (delivered in Session 5)", async () => {
    const { repo, live, booking } = await run();
    const kinds2 = [...repo.outbox.values()].map((o) => o.kind).sort();
    expect(kinds2).toEqual(["confirmation_email", "hubspot_deal"]);
    expect(repo.outbox.get(`hubspot_deal:${live.id}`)!.payload).toMatchObject({ enquiryId: live.id });
    expect(repo.outbox.get(`confirmation_email:${booking.id}`)!.payload).toMatchObject({ bookingId: booking.id, email: "priya@example.com" });
  });
  it("is idempotent: processing the same call again changes nothing", async () => {
    const t = await run();
    const again = await t.pipeline.process(record("vc-1"));
    expect(again.status).toBe("already_processed");
    expect(t.extractor.calls).toHaveLength(1);
    expect(t.repo.costs).toHaveLength(1);
    expect(t.repo.outbox.size).toBe(2);
  });
  it("stores the caller's name/email on the caller (never on logs) and links call and enquiry to them", async () => {
    const { repo, live } = await run();
    const call = (await repo.getCall("vc-1"))!;
    expect(call.callerId).toBeTruthy();
    expect(repo.callerById(call.callerId!)).toMatchObject({ name: "Priya", email: "priya@example.com", language: "en" });
    expect((await repo.getEnquiry(live.id))!.callerId).toBe(call.callerId);
  });
});

describe("hard rule 1: the agent said a price", () => {
  it("is flagged high-severity with evidence, the owner is alerted, and the call is still processed", async () => {
    const t = makeAll();
    t.extractor.set("vc-p", ext());
    const turns = [...cleanTurns().slice(0, 4), a("That would be around 15 lakh for a 3BHK."), ...cleanTurns().slice(4)];
    const r = await t.pipeline.process(record("vc-p", { transcript: turns }));
    expect(r.status).toBe("processed");
    expect(kinds(r)).toContain("price_mention");
    const f = (await t.repo.listFlags("vc-p")).find((x) => x.kind === "price_mention")!;
    expect(f).toMatchObject({ severity: "high", detectedBy: "price_scan" });
    expect(f.evidence).toContain("lakh");
    const alert = t.repo.outbox.get(`owner_alert:price_mention:vc-p`)!;
    expect(alert.kind).toBe("owner_alert");
    expect(JSON.stringify(alert.payload)).toContain("lakh");
  });
  it("only the AGENT's lines are scanned: a caller volunteering a budget is not a violation", async () => {
    const t = makeAll();
    t.extractor.set("vc-b", ext({ budget_inr: 150000 }));
    const r = await t.pipeline.process(record("vc-b", { transcript: [a(OPEN), c("My budget is 1.5 lakh."), a("Thank you, I've noted that for the designer.")] }));
    expect(kinds(r)).not.toContain("price_mention");
  });
});

describe("hard rule 3: disclosure", () => {
  it("a first line without the disclosure is flagged and alerted", async () => {
    const t = makeAll();
    t.extractor.set("vc-d", ext());
    const r = await t.pipeline.process(record("vc-d", { transcript: [a("Namaste, Aangan Studio. How can I help?"), ...cleanTurns().slice(1)] }));
    expect(kinds(r)).toContain("missing_disclosure");
    expect((await t.repo.getCall("vc-d"))!.disclosureOk).toBe(false);
    expect(t.repo.outbox.has("owner_alert:missing_disclosure:vc-d")).toBe(true);
  });
});

describe("hard rule 4: a complaint slipped through", () => {
  it("is flagged, the owner AND Nikhil are alerted, and it is never turned into a lead", async () => {
    const t = makeAll();
    t.extractor.set("vc-c", ext({ intent: "unknown" }));
    const turns = [a(OPEN), c("My project has been going for three months and my designer hasn't replied in five days."), a("Could you tell me the area of the flat?"), c("Viman Nagar, 2BHK.")];
    const r = await t.pipeline.process(record("vc-c", { transcript: turns }));
    expect(kinds(r)).toContain("missed_complaint");
    expect(r.outcome).toBe("review");
    expect(r.enquiryId).toBeUndefined();
    expect(t.repo.outbox.has("owner_alert:missed_complaint:vc-c")).toBe(true);
    expect(t.repo.outbox.has("nikhil_alert:missed_complaint:vc-c")).toBe(true);
    expect([...t.repo.outbox.values()].some((o) => o.kind === "hubspot_deal")).toBe(false);
  });
  it("the same call, correctly escalated: outcome 'escalated', no flag, no lead", async () => {
    const t = makeAll();
    t.extractor.set("vc-e", ext({ intent: "complaint" }));
    await t.repo.upsertCall("vc-e", {});
    await t.repo.recordEscalation("vc-e", { reason: "complaint", mode: "live_transfer" });
    const r = await t.pipeline.process(record("vc-e", { transcript: [a(OPEN), c("My designer hasn't replied in five days.")] }));
    expect(r).toMatchObject({ outcome: "escalated", flags: [] });
    expect(r.enquiryId).toBeUndefined();
  });
});

describe("rules engine, post-call: the model extracts, code decides", () => {
  it("a disagreement with the live decision is flagged for review; the live result stays authoritative", async () => {
    const t = makeAll();
    const live = await liveEnquiry(t.repo, "vc-r");
    await book(t.bookings, live.id);
    t.extractor.set("vc-r", ext({ location: "Nashik" })); // post-call reading says out of area, live said fit
    const r = await t.pipeline.process(record("vc-r"));
    expect(kinds(r)).toContain("rule_disagreement");
    expect(await t.repo.latestEvaluation("vc-r", "post_call")).toMatchObject({ fit: "not_fit", reasonCodes: ["area_outside_service"] });
    expect((await t.repo.getEnquiry(live.id))!.fit).toBe("fit");
    expect(r.outcome).toBe("booked");
    const flag = (await t.repo.listFlags("vc-r")).find((x) => x.kind === "rule_disagreement")!;
    expect(flag.evidence).toMatch(/live: fit.*post-call: not_fit/s);
    expect(flag.evidence).not.toMatch(/\d{5,}/); // never thresholds or budgets
  });
  it("agreement raises no flag", async () => {
    const t = makeAll();
    await liveEnquiry(t.repo, "vc-ok");
    t.extractor.set("vc-ok", ext());
    expect(kinds(await t.pipeline.process(record("vc-ok")))).not.toContain("rule_disagreement");
  });
  it("a call that ended before any live check: the enquiry is built from the extraction and decided by the engine", async () => {
    const t = makeAll();
    t.extractor.set("vc-n", ext({ location: "Nashik" }));
    const r = await t.pipeline.process(record("vc-n"));
    expect(r.outcome).toBe("not_fit");
    const e = (await t.repo.getEnquiry(r.enquiryId!))!;
    expect(e).toMatchObject({ fit: "not_fit", reasonCodes: ["area_outside_service"], ruleVersion: "v1" });
    expect([...t.repo.outbox.values()].some((o) => o.kind === "hubspot_deal")).toBe(false);
  });
  it("unclear -> review, no deal; fit but not booked -> review with a deal (qualified), no confirmation email", async () => {
    const t = makeAll();
    t.extractor.set("vc-u", ext({ location: "Talegaon" }));
    expect((await t.pipeline.process(record("vc-u"))).outcome).toBe("review");
    expect([...t.repo.outbox.values()].some((o) => o.kind === "hubspot_deal")).toBe(false);
    t.extractor.set("vc-f", ext());
    const r = await t.pipeline.process(record("vc-f", { callerPhone: "+919000000022" }));
    expect(r.outcome).toBe("review");
    expect(t.repo.outbox.has(`hubspot_deal:${r.enquiryId}`)).toBe(true);
    expect([...t.repo.outbox.values()].some((o) => o.kind === "confirmation_email")).toBe(false);
  });
  it("an unresolvable festival deadline is noted on the enquiry rather than guessed", async () => {
    const t = makeAll();
    t.extractor.set("vc-g", ext({ deadline: { kind: "festival", date: null, month: null, year: null, festival: "Ganesh Chaturthi", value: null, unit: null, text: "before Ganpati" } }));
    const r = await t.pipeline.process(record("vc-g"));
    expect((await t.repo.getEnquiry(r.enquiryId!))!.flags).toContain("deadline_unresolved");
  });
});

describe("other call types", () => {
  it("vendor / wrong number: closed_other, no lead, nothing queued", async () => {
    const t = makeAll();
    t.extractor.set("vc-o", ext({ intent: "other" }));
    const r = await t.pipeline.process(record("vc-o", { transcript: [a(OPEN), c("I'm calling about a tile supply tie-up.")] }));
    expect(r).toMatchObject({ outcome: "closed_other", flags: [] });
    expect(r.enquiryId).toBeUndefined();
    expect(t.repo.outbox.size).toBe(0);
  });
  it("a missed call: no model call, outcome missed", async () => {
    const t = makeAll();
    const r = await t.pipeline.process(record("vc-m", { transcript: [], endedReason: "missed", durationS: 0, answeredAt: undefined }));
    expect(r).toMatchObject({ status: "processed", outcome: "missed", flags: [] });
    expect(t.extractor.calls).toHaveLength(0);
  });
  it("a call that dropped before anything useful: outcome dropped", async () => {
    const t = makeAll();
    t.extractor.set("vc-x", ext({ location: null, project_type: "unknown", scope: "unspecified", bhk: null, carpet_sqft: null, deadline: null, decision_maker: "unknown", owners_attending: null }));
    const r = await t.pipeline.process(record("vc-x", { endedReason: "dropped", durationS: 12, transcript: [a(OPEN), c("Hi, I wanted to inquire about —")] }));
    expect(r.outcome).toBe("dropped");
    expect(r.enquiryId).toBeUndefined();
  });
  it("after-hours calls are marked", async () => {
    const t = makeAll();
    t.extractor.set("vc-ah", ext());
    await t.pipeline.process(record("vc-ah", { rangAt: "2026-10-07T16:40:00Z", answeredAt: "2026-10-07T16:40:02Z", endedAt: "2026-10-07T16:47:00Z" })); // 22:10 IST
    expect((await t.repo.getCall("vc-ah"))!.afterHours).toBe(true);
  });
  it("a caller who rang back after a dropped call: both calls merge into one enquiry (T17)", async () => {
    const t = makeAll();
    t.extractor.set("vc-1a", ext({ location: null, project_type: "unknown", scope: "unspecified", bhk: null, carpet_sqft: null, deadline: null, decision_maker: "unknown", owners_attending: null }));
    await t.pipeline.process(record("vc-1a", { endedReason: "dropped", durationS: 72, rangAt: "2026-10-07T06:00:00Z", answeredAt: "2026-10-07T06:00:02Z", endedAt: "2026-10-07T06:01:12Z", transcript: [a(OPEN), c("Hi, I wanted to inquire about —")] }));
    t.extractor.set("vc-1b", ext());
    const r = await t.pipeline.process(record("vc-1b", { rangAt: "2026-10-07T06:03:00Z", answeredAt: "2026-10-07T06:03:02Z", endedAt: "2026-10-07T06:08:00Z" }));
    const first = (await t.repo.getCall("vc-1a"))!, second = (await t.repo.getCall("vc-1b"))!;
    expect(second.parentCallId).toBe(first.id);
    expect(first.enquiryId).toBe(r.enquiryId);
    expect(second.enquiryId).toBe(r.enquiryId);
  });
  it("a callback after a dropped call that already had a live enquiry continues that same enquiry", async () => {
    const t = makeAll();
    const live = await liveEnquiry(t.repo, "vc-2a");
    await t.repo.upsertCall("vc-2a", { endedAt: new Date("2026-10-07T06:01:00Z"), endedReason: "dropped", postCallStatus: "processed" });
    t.extractor.set("vc-2b", ext());
    const r = await t.pipeline.process(record("vc-2b", { rangAt: "2026-10-07T06:03:00Z", answeredAt: "2026-10-07T06:03:02Z" }));
    expect(r.enquiryId).toBe(live.id);
  });
  it("a callback more than 30 minutes later is a NEW enquiry", async () => {
    const t = makeAll();
    const live = await liveEnquiry(t.repo, "vc-3a");
    await t.repo.upsertCall("vc-3a", { endedAt: new Date("2026-10-07T04:00:00Z"), endedReason: "dropped", postCallStatus: "processed" });
    t.extractor.set("vc-3b", ext());
    expect((await t.pipeline.process(record("vc-3b"))).enquiryId).not.toBe(live.id);
  });
});

describe("the model call fails", () => {
  it("one transient failure is retried once and the call is processed", async () => {
    const t = makeAll();
    t.extractor.set("vc-t", ext());
    t.extractor.failNext("upstream_unavailable", 1);
    expect((await t.pipeline.process(record("vc-t"))).status).toBe("processed");
    expect(t.extractor.calls).toHaveLength(2);
  });
  it("two failures: status extraction_failed, flagged and alerted, but the deterministic scans still ran", async () => {
    const t = makeAll();
    t.extractor.failNext("upstream_unavailable", 2);
    const turns = [...cleanTurns().slice(0, 2), a("It would be about 8 lakh."), ...cleanTurns().slice(2)];
    const r = await t.pipeline.process(record("vc-f1", { transcript: turns }));
    expect(r.status).toBe("extraction_failed");
    expect(kinds(r)).toEqual(["extraction_failed", "price_mention"]);
    expect((await t.repo.getCall("vc-f1"))!.postCallStatus).toBe("extraction_failed");
    expect(t.repo.outbox.has("owner_alert:extraction_failed:vc-f1")).toBe(true);
    expect(t.repo.costs).toHaveLength(0);
    expect([...t.repo.outbox.values()].some((o) => o.kind === "hubspot_deal")).toBe(false);
  });
  it("a rejected request (bad key / schema) is not retried", async () => {
    const t = makeAll();
    t.extractor.failNext("rejected", 1);
    expect((await t.pipeline.process(record("vc-rj"))).status).toBe("extraction_failed");
    expect(t.extractor.calls).toHaveLength(1);
  });
  it("an extraction_failed call can be reprocessed later and completes (same record, idempotent)", async () => {
    const t = makeAll();
    t.extractor.failNext("upstream_unavailable", 2);
    await t.pipeline.process(record("vc-rp"));
    t.extractor.set("vc-rp", ext());
    const r = await t.pipeline.process(record("vc-rp"));
    expect(r.status).toBe("processed");
    expect((await t.repo.getCall("vc-rp"))!.postCallStatus).toBe("processed");
    expect(t.repo.outbox.has("owner_alert:extraction_failed:vc-rp")).toBe(true); // history is kept
  });
});

describe("works without a caller phone", () => {
  it("the call is processed with no caller link", async () => {
    const t = makeAll();
    t.extractor.set("vc-np", ext());
    const r = await t.pipeline.process(record("vc-np", { callerPhone: undefined }));
    expect(r.status).toBe("processed");
    expect((await t.repo.getCall("vc-np"))!.callerId).toBeNull();
  });
  it("uses the caller recorded at lookup time when the vendor payload masks the number", async () => {
    const t = makeAll();
    const caller = await t.repo.upsertCaller({ phone: "+919000000031" });
    await t.repo.upsertCall("vc-lk", { callerId: caller.id });
    t.extractor.set("vc-lk", ext());
    await t.pipeline.process(record("vc-lk", { callerPhone: undefined }));
    expect((await t.repo.getCall("vc-lk"))!.callerId).toBe(caller.id);
  });
});
