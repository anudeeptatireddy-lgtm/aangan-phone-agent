import { describe, it, expect, beforeAll } from "vitest";
import { september, SEP, World, ist, ENC_KEY, PEPPER } from "./fixture";
import { listCalls, callsCsv, getCallDetail, designerStats, getReview, reviewCall, revealPhone, type CallsQuery } from "@/db/dash-calls";
import { PgPostCallRepo } from "@/db/pg-postcall-repo";

let w: World; let ids: Record<string, string>;
const q: CallsQuery = { ...SEP, demo: false };
beforeAll(async () => { ({ w, ids } = await september()); }, 120_000);

describe("calls table", () => {
  it("lists every call in the period, newest first, with the masked phone only", async () => {
    const r = await listCalls(w.db, q);
    expect(r.total).toBe(9);
    expect(r.rows.map((x) => x.id)).toEqual(["c9", "c8", "c7", "c6", "c5", "c4", "c3", "c2", "c1"]);
    const c1 = r.rows.find((x) => x.id === "c1")!;
    expect(c1).toMatchObject({ callerName: "Priya Shah", phoneMasked: "+91 90••••••11", locality: "Kothrud", scope: "full_home", outcome: "booked", fit: "fit", designer: "Asha", bookingStatus: "attended", handoffStatus: "accepted", afterHours: false });
    expect(c1.bookingStartsAt).toBeInstanceOf(Date);
    expect(JSON.stringify(r)).not.toMatch(/\+919000000011|9000000011/);
  });
  it("a call with no caller or enquiry still lists, with blanks", async () => {
    const c5 = (await listCalls(w.db, q)).rows.find((x) => x.id === "c5")!;
    expect(c5).toMatchObject({ callerName: null, phoneMasked: null, locality: null, outcome: "missed", designer: null, bookingStartsAt: null });
  });
  it("the designer shown is the booking's CURRENT designer (c4 was reassigned from Asha to Bela)", async () => {
    expect((await listCalls(w.db, q)).rows.find((x) => x.id === "c4")!.designer).toBe("Bela");
  });
  it("filters: outcome, fit, designer, after hours; and they combine", async () => {
    const ids_ = async (o: Partial<CallsQuery>) => (await listCalls(w.db, { ...q, ...o })).rows.map((x) => x.id).sort();
    expect(await ids_({ outcome: "booked" })).toEqual(["c1", "c2", "c4"]);
    expect(await ids_({ fit: "not_fit" })).toEqual(["c3"]);
    expect(await ids_({ designerId: ids.bela })).toEqual(["c2", "c4"]);
    expect(await ids_({ afterHours: true })).toEqual(["c3", "c5"]);
    expect(await ids_({ outcome: "booked", designerId: ids.asha })).toEqual(["c1"]);
  });
  it("search matches name, locality, call id and the masked phone, case-insensitively, and treats wildcards literally", async () => {
    const ids_ = async (search: string) => (await listCalls(w.db, { ...q, search })).rows.map((x) => x.id).sort();
    expect(await ids_("priya")).toEqual(["c1"]);
    expect(await ids_("BANER")).toEqual(["c2"]);
    expect(await ids_("c7")).toEqual(["c7"]);
    expect(await ids_("90••••••12")).toEqual(["c2"]);
    expect(await ids_("%")).toEqual([]);
    expect(await ids_("'; drop table calls; --")).toEqual([]);
    expect((await listCalls(w.db, q)).total).toBe(9);
  });
  it("paginates, and total ignores the page", async () => {
    const p = await listCalls(w.db, { ...q, limit: 4, offset: 4 });
    expect(p.total).toBe(9);
    expect(p.rows.map((x) => x.id)).toEqual(["c5", "c4", "c3", "c2"]);
  });
  it("the demo switch shows only demo calls", async () => {
    expect((await listCalls(w.db, { ...q, demo: true })).rows.map((x) => x.id)).toEqual(["demo-1"]);
  });
  it("CSV: header + one line per call, quoted safely, only the masked phone", async () => {
    const csv = callsCsv((await listCalls(w.db, q)).rows);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("time_ist,call_id,caller_name,phone_masked,locality,scope,outcome,fit,booking_start_ist,designer,status");
    expect(lines).toHaveLength(10);
    expect(csv).toContain("+91 90••••••11");
    expect(csv).not.toContain("+919000000011");
    const base = (await listCalls(w.db, q)).rows[0]!;
    expect(callsCsv([{ ...base, callerName: '=cmd()' }])).toContain(",'=cmd(),");            // spreadsheet formula injection is defused
    expect(callsCsv([{ ...base, callerName: 'Evil, "Name"' }])).toContain('"Evil, ""Name"""'); // commas and quotes are escaped
  });
});

describe("call detail", () => {
  it("everything about one call: fields, rule decision with version, booking, handoff timeline, flags, escalations, alerts, links", async () => {
    await w.db.query("update enquiries set designer_note='NEW CONSULTATION' where id=$1", [ids.E1]);
    const d = (await getCallDetail(w.db, "c1", false))!;
    expect(d.call).toMatchObject({ id: "c1", outcome: "booked", summary: "3BHK Kothrud", recordingUrl: "https://rec/c1", durationS: 300 });
    expect(d.transcript).toEqual([{ speaker: "agent", text: "Namaste" }]);
    expect(d.caller).toMatchObject({ name: "Priya Shah", phoneMasked: "+91 90••••••11" });
    expect(d.enquiry).toMatchObject({ locality: "Kothrud", projectType: "home", scope: "full_home", fit: "fit", language: "en", designerNote: "NEW CONSULTATION" });
    expect(d.decision).toMatchObject({ fit: "fit", ruleVersion: "v1", reasonCodes: [] });
    expect(d.decision!.evaluations).toEqual([expect.objectContaining({ phase: "post_call", fit: "fit", ruleVersion: "v1" })]);
    expect(d.booking).toMatchObject({ status: "attended", designer: "Asha" });
    expect(d.handoffs.map((h) => [h.attempt, h.designer, h.status])).toEqual([[1, "Asha", "accepted"]]);
    expect(d.hubspot).toMatchObject({ dealId: expect.any(String), stage: "won", dealAmountInr: 1_200_000 });
  });
  it("a reassigned booking shows both handoffs in order (sent, timed out / reassigned, accepted)", async () => {
    const d = (await getCallDetail(w.db, "c4", false))!;
    expect(d.handoffs.map((h) => [h.attempt, h.designer, h.status])).toEqual([[1, "Asha", "reassigned"], [2, "Bela", "accepted"]]);
    expect(d.handoffs[1]!.acceptedAt).toBeInstanceOf(Date);
  });
  it("flags and escalations of the call", async () => {
    expect((await getCallDetail(w.db, "c3", false))!.flags).toEqual([expect.objectContaining({ kind: "price_mention" })]);
    expect((await getCallDetail(w.db, "c6", false))!.escalations).toEqual([expect.objectContaining({ reason: "complaint", mode: "callback_sla" })]);
  });
  it("alerts raised about this call are listed (design lead / owner / Nikhil)", async () => {
    await w.db.query("insert into outbox(kind, payload, dedupe_key) values ('design_lead_alert', $1::jsonb, 'dl-c8')", [JSON.stringify({ kind: "booking_missing", priority: "urgent", vendorCallId: "c8" })]);
    expect((await getCallDetail(w.db, "c8", false))!.alerts).toEqual([expect.objectContaining({ kind: "booking_missing", priority: "urgent", to: "design_lead" })]);
  });
  it("unknown id, or a demo call seen from the live view, is null (views never mix)", async () => {
    expect(await getCallDetail(w.db, "nope", false)).toBeNull();
    expect(await getCallDetail(w.db, "demo-1", false)).toBeNull();
    expect(await getCallDetail(w.db, "demo-1", true)).not.toBeNull();
  });
  it("contains no full phone number, even in the caller's email field masking", async () => {
    await w.db.query("update callers set email='priya.shah@example.com' where name='Priya Shah'");
    const d = (await getCallDetail(w.db, "c1", false))!;
    expect(d.caller!.emailMasked).toBe("p•••@example.com");
    expect(JSON.stringify(d)).not.toMatch(/9000000011|priya\.shah/);
  });
});

describe("designers page", () => {
  it("assigned, accepted, median accept time, consultations, quotes and wins per designer", async () => {
    const s = await designerStats(w.db, q);
    expect(s).toEqual([
      { id: ids.asha, name: "Asha", assigned: 1, accepted: 1, medianAcceptMinutes: 15, medianAcceptWorkingMinutes: 15, consultations: 1, quotes: 1, wins: 1 },
      { id: ids.bela, name: "Bela", assigned: 2, accepted: 2, medianAcceptMinutes: 40, medianAcceptWorkingMinutes: 40, consultations: 0, quotes: 1, wins: 0 }]);
  });
  it("demo designers never appear in the live view", async () => {
    await w.demo(true); await w.designer("DemoDev", { demo: true }); await w.demo(false);
    expect((await designerStats(w.db, q)).map((x) => x.name)).toEqual(["Asha", "Bela"]);
    expect((await designerStats(w.db, { ...q, demo: true })).map((x) => x.name)).toEqual(["DemoDev"]);
  });
});

describe("weekly review", () => {
  const WEEK = "2026-09-07"; // Monday
  it("draws up to 10 random processed calls of the week once and keeps them (a refresh cannot re-draw)", async () => {
    const x = await september();
    for (let i = 0; i < 14; i++) await x.w.call(`wk-${i}`, { rang: ist(`09-0${8 + (i % 2)}T1${i % 6}:00:00`), answeredAfterS: 2, outcome: "booked" });
    const a = await getReview(x.w.db, { demo: false, weekStart: WEEK });
    expect(a.items).toHaveLength(10);
    expect(new Set(a.items.map((i) => i.callId)).size).toBe(10);
    const b = await getReview(x.w.db, { demo: false, weekStart: WEEK });
    expect(b.items.map((i) => i.callId)).toEqual(a.items.map((i) => i.callId));
    expect(a.items[0]!.agentDecision).toMatch(/booked|review|escalated|not_fit|closed_other|missed/);
  }, 120_000);
  it("fewer than 10 calls: take them all; a week with none is empty, not an error", async () => {
    expect((await getReview(w.db, { demo: false, weekStart: WEEK })).items.map((i) => i.callId).sort()).toEqual(["c4", "c5", "c6", "c7", "c8", "c9"]);
    expect((await getReview(w.db, { demo: false, weekStart: "2025-01-06" })).items).toEqual([]);
  });
  it("Confirm and Overturn set the review; the overturn rate is overturned / reviewed", async () => {
    const x = await september();
    const r = await getReview(x.w.db, { demo: false, weekStart: "2026-08-31" });
    const [a, b, c] = r.items;
    expect(await reviewCall(x.w.db, { callId: a!.callId, overturned: false, reviewer: "Nikhil" })).toEqual({ ok: true });
    expect(await reviewCall(x.w.db, { callId: b!.callId, overturned: true, reason: "should have escalated", reviewer: "Nikhil" })).toEqual({ ok: true });
    const after = await getReview(x.w.db, { demo: false, weekStart: "2026-08-31" });
    expect([after.reviewed, after.overturned, after.overturnRate]).toEqual([2, 1, 0.5]);
    expect(after.items.find((i) => i.callId === b!.callId)).toMatchObject({ overturned: true, reason: "should have escalated", reviewer: "Nikhil" });
    expect(after.items.find((i) => i.callId === c!.callId)).toMatchObject({ overturned: null });
    expect(after.allTime).toEqual({ reviewed: 2, overturned: 1, rate: 0.5 });
  }, 120_000);
  it("overturning a critical decision (booked / escalated / not_fit) needs a reason; an unknown call is rejected", async () => {
    const x = await september();
    const r = await getReview(x.w.db, { demo: false, weekStart: "2026-08-31" });
    const critical = r.items.find((i) => /booked|escalated|not_fit/.test(i.agentDecision))!;
    expect(await reviewCall(x.w.db, { callId: critical.callId, overturned: true, reviewer: "N" })).toEqual({ ok: false, error: "reason_required" });
    expect(await reviewCall(x.w.db, { callId: "nope", overturned: false, reviewer: "N" })).toEqual({ ok: false, error: "not_in_review" });
    expect(await reviewCall(x.w.db, { callId: critical.callId, overturned: false, reviewer: "" })).toEqual({ ok: false, error: "reviewer_required" });
  }, 120_000);
});

describe("revealing a phone number", () => {
  const keys = { pepper: PEPPER, encKey: ENC_KEY };
  it("logs the reveal BEFORE returning the number, and returns the real number only to this call", async () => {
    const repo = new PgPostCallRepo(w.db, keys);
    const r = await revealPhone(w.db, repo, { vendorCallId: "c1", demo: false, ip: "10.0.0.1" });
    expect(r).toEqual({ ok: true, phone: "+919000000011" });
    const log = (await w.db.query("select who, ip, call_id from phone_reveals")).rows;
    expect(log).toEqual([{ who: "dashboard", ip: "10.0.0.1", call_id: expect.any(String) }]);
  });
  it("a call with no caller has nothing to reveal and logs nothing", async () => {
    const repo = new PgPostCallRepo(w.db, keys);
    expect(await revealPhone(w.db, repo, { vendorCallId: "c5", demo: false })).toEqual({ ok: false, error: "no_caller" });
    expect(((await w.db.query("select count(*)::int n from phone_reveals")).rows[0] as { n: number }).n).toBe(1);
  });
  it("is rate limited: 30 reveals an hour", async () => {
    const repo = new PgPostCallRepo(w.db, keys);
    for (let i = 0; i < 29; i++) await revealPhone(w.db, repo, { vendorCallId: "c2", demo: false });
    expect(await revealPhone(w.db, repo, { vendorCallId: "c2", demo: false })).toEqual({ ok: false, error: "rate_limited" });
  }, 120_000);
});
