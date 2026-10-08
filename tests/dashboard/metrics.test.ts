import { describe, it, expect, beforeAll } from "vitest";
import { september, SEP, World } from "./fixture";
import { previousRange, funnel, outcomes, speed, price, escalations, routerHealth, cost, pipelineValue, breakdowns, daily, kpis, overview, type Q } from "@/db/dash-metrics";

let w: World;
const q: Q = { ...SEP, demo: false };
beforeAll(async () => { ({ w } = await september()); }, 120_000);
const stage = (r: Awaited<ReturnType<typeof funnel>>, key: string) => r.stages.find((s) => s.key === key)!;

describe("funnel (every count and conversion, computed in SQL from our tables)", () => {
  it("has the ten stages in order, with units", async () => {
    const f = await funnel(w.db, q);
    expect(f.stages.map((s) => s.key)).toEqual(["received", "answered", "enquiries", "qualified", "booked", "pushed", "accepted", "held", "quoted", "won"]);
    expect(f.stages.map((s) => s.unit)).toEqual(["calls", "calls", "enquiries", "enquiries", "enquiries", "enquiries", "enquiries", "enquiries", "enquiries", "enquiries"]);
  });
  it("counts: 9 calls, 8 answered (one missed), 5 new enquiries, 3 qualified, 3 booked, 3 pushed, 3 accepted, 2 held, 2 quoted, 1 won", async () => {
    const f = await funnel(w.db, q);
    expect(f.stages.map((s) => s.count)).toEqual([9, 8, 5, 3, 3, 3, 3, 2, 2, 1]);
  });
  it("conversion is each stage over the one before it; the first has none", async () => {
    const f = await funnel(w.db, q);
    expect(f.stages.map((s) => s.conversion)).toEqual([null, 0.8889, 0.625, 0.6, 1, 1, 1, 0.6667, 1, 0.5]);
  });
  it("stages with a data source are flagged; stages 8-10 have one here because bookings were attended and CRM stages moved", async () => {
    const f = await funnel(w.db, q);
    expect(f.stages.every((s) => s.hasData)).toBe(true);
  });
  it("a booking cancelled is not 'booked'; a handoff never sent is not 'pushed'; an enquiry from another month is not counted", async () => {
    const { w: x, ids } = await september();
    await x.db.query("update bookings set status='cancelled', idempotency_key=null where id=$1", [ids.B2]);
    await x.db.query("update handoffs set sent_at=null, status='pending', accepted_at=null where booking_id=$1 and attempt_no=1 and designer_id=$2", [ids.B1, ids.asha]);
    const f = await funnel(x.db, q);
    expect([stage(f, "booked").count, stage(f, "pushed").count, stage(f, "accepted").count]).toEqual([2, 1, 1]);
  }, 120_000);
  it("with no consultation or CRM progress, stages 8-10 say 'no data yet' (hasData false, count null), never a false zero", async () => {
    const { w: x } = await september();
    await x.db.query("update bookings set status='confirmed'");
    await x.db.query("update crm_links set stage='new', deal_amount_inr=null");
    const f = await funnel(x.db, q);
    for (const k of ["held", "quoted", "won"]) expect(stage(f, k)).toMatchObject({ hasData: false, count: null, conversion: null });
    expect(stage(f, "pushed").hasData).toBe(true);
  }, 120_000);
  it("an empty period is all zeros with no division by zero", async () => {
    const f = await funnel(w.db, { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2025-02-01T00:00:00Z"), demo: false });
    expect(f.stages.map((s) => s.count).filter((c) => c !== null).every((c) => c === 0)).toBe(true);
    expect(f.stages.every((s) => s.conversion === null)).toBe(true);
  });
});

describe("demo vs live never mix", () => {
  it("the live view has no demo call, the demo view only demo rows", async () => {
    expect(stage(await funnel(w.db, q), "received").count).toBe(9);
    const d = await funnel(w.db, { ...q, demo: true });
    expect(stage(d, "received").count).toBe(1);
    expect((await cost(w.db, { ...q, demo: true })).totalInr).toBe(1000);
    expect((await cost(w.db, q)).totalInr).toBe(1321.5);
  });
});

describe("outcomes", () => {
  it("fit 3, not_fit 1 by reason, unclear 1, complaint 2, other 1 (+ missed 1)", async () => {
    expect(await outcomes(w.db, q)).toEqual({ fit: 3, notFit: { total: 1, byReason: [{ reason: "area_outside_service", count: 1 }] }, unclear: 1, complaint: 2, other: 1, missed: 1, dropped: 0 });
  });
});

describe("speed", () => {
  it("median time to answer 3 s; 8 of 9 answered within an hour", async () => {
    const s = await speed(w.db, q);
    expect(s.medianAnswerSeconds).toBe(3);
    expect(s.pctAnsweredUnder1h).toBe(0.8889);
  });
  it("handoff-to-accept median is 20 min (15, 20, 60), in elapsed and in working minutes", async () => {
    const s = await speed(w.db, q);
    expect(s).toMatchObject({ acceptedHandoffs: 3, medianAcceptMinutes: 20, medianAcceptWorkingMinutes: 20 });
  });
  it("working minutes skip the night: sent 18:50, accepted 10:20 next morning = 30", async () => {
    const { w: x, ids } = await september();
    await x.db.query("update handoffs set sent_at=$2::timestamptz, accepted_at=$3::timestamptz where booking_id=$1 and attempt_no=1 and status='accepted'", [ids.B1, "2026-09-02T13:20:00Z", "2026-09-03T04:50:00Z"]);
    await x.db.query("update handoffs set accepted_at = sent_at where status='accepted' and booking_id <> $1", [ids.B1]);
    const s = await speed(x.db, q);
    expect(s.medianAcceptWorkingMinutes).toBe(0);
    expect(s.medianAcceptMinutes).toBe(0);
    await x.db.query("update handoffs set accepted_at = sent_at + interval '30 minutes' where status='accepted' and booking_id <> $1", [ids.B1]);
    expect((await speed(x.db, q)).medianAcceptWorkingMinutes).toBe(30);
  }, 120_000);
  it("no timestamps means 'n/a' (null), never a guess", async () => {
    const s = await speed(w.db, { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2025-02-01T00:00:00Z"), demo: false });
    expect(s).toMatchObject({ medianAnswerSeconds: null, pctAnsweredUnder1h: null, medianAcceptMinutes: null, medianAcceptWorkingMinutes: null, acceptedHandoffs: 0 });
  });
});

describe("price", () => {
  it("1 caller asked about price; 1 agent price-mention flag (target 0)", async () => {
    expect(await price(w.db, q)).toEqual({ askedCount: 1, agentPriceFlags: 1 });
  });
  it("only price_mention counts as a leak (other flags do not)", async () => {
    expect((await price(w.db, { ...q, demo: true })).agentPriceFlags).toBe(0);
  });
});

describe("escalations", () => {
  it("2 complaints, both resolved, 1 closed within 15 minutes = 50%", async () => {
    expect(await escalations(w.db, q)).toEqual({ complaints: 2, resolved: 2, closedWithin15Min: 1, pctClosedWithin15Min: 0.5, hasResolutionData: true });
  });
  it("complaints that nobody has marked resolved give 'no data yet', not 0%", async () => {
    const { w: x } = await september();
    await x.db.query("update escalations set resolved_at=null");
    expect(await escalations(x.db, q)).toEqual({ complaints: 2, resolved: 0, closedWithin15Min: 0, pctClosedWithin15Min: null, hasResolutionData: false });
  }, 120_000);
});

describe("router health", () => {
  it("matched 2, ambiguous 1, claimed-but-no-booking 1, booking-without-call 2 (alerts) and 1 unclaimed booking", async () => {
    expect(await routerHealth(w.db, q)).toEqual({ matched: 2, ambiguous: 1, claimedButNoBooking: 1, bookingWithoutCall: 2, unclaimedBookings: 1 });
  });
});

describe("cost", () => {
  it("this period's spend by line, grouped: voice 70, AI 1.50, fixed 1250", async () => {
    const c = await cost(w.db, q);
    expect(c.byLine).toEqual([
      { line: "voice_minutes", label: "Voice minutes", amountInr: 70 }, { line: "ai_tokens_in", label: "AI tokens (in)", amountInr: 0.5 }, { line: "ai_tokens_out", label: "AI tokens (out)", amountInr: 1 },
      { line: "phone_number", label: "Phone number", amountInr: 750 }, { line: "hosting", label: "Hosting", amountInr: 500 }]);
    expect(c.groups).toEqual({ voiceMinutes: 70, aiTokens: 1.5, fixedFees: 1250 });
    expect(c.totalInr).toBe(1321.5);
  });
  it("cost per call = total / 9 calls = 146.83; per booked consultation = total / 3 = 440.5", async () => {
    const c = await cost(w.db, q);
    expect([c.calls, c.booked, c.perCallInr, c.perBookedConsultationInr]).toEqual([9, 3, 146.83, 440.5]);
  });
  it("no booked consultation means 'n/a', not infinity", async () => {
    const c = await cost(w.db, { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2025-02-01T00:00:00Z"), demo: false });
    expect([c.totalInr, c.perCallInr, c.perBookedConsultationInr]).toEqual([0, null, null]);
  });
});

describe("pipeline (HubSpot deal value from agent-sourced calls)", () => {
  it("won 1.2M, quoted (open) 0.8M, total 2.0M", async () => {
    expect(await pipelineValue(w.db, q)).toEqual({ hasData: true, wonValueInr: 1_200_000, wonCount: 1, quotedValueInr: 800_000, quotedCount: 1, totalValueInr: 2_000_000 });
  });
  it("no deal amounts synced = 'no data yet'", async () => {
    const { w: x } = await september();
    await x.db.query("update crm_links set deal_amount_inr = null");
    expect((await pipelineValue(x.db, q)).hasData).toBe(false);
  }, 120_000);
});

describe("breakdowns", () => {
  it("by locality, project type, designer, hour of day (with the after-hours share) and language", async () => {
    const b = await breakdowns(w.db, q);
    expect(b.locality).toEqual([{ key: "Aundh", count: 1, fit: 1, booked: 1 }, { key: "Baner", count: 1, fit: 1, booked: 1 }, { key: "Kharadi", count: 1, fit: 0, booked: 0 }, { key: "Kothrud", count: 1, fit: 1, booked: 1 }, { key: "Nashik", count: 1, fit: 0, booked: 0 }]);
    expect(b.projectType).toEqual([{ key: "home", count: 4, fit: 2, booked: 2 }, { key: "office", count: 1, fit: 1, booked: 1 }]);
    expect(b.designer).toEqual([{ key: "Bela", count: 2 }, { key: "Asha", count: 1 }]);
    expect(b.language).toEqual([{ key: "en", count: 4 }, { key: "hi", count: 1 }]);
    expect(b.hourOfDay.find((h) => h.hour === 20)).toEqual({ hour: 20, count: 1, afterHours: 1 });
    expect(b.hourOfDay.find((h) => h.hour === 9)).toEqual({ hour: 9, count: 1, afterHours: 1 });
    expect(b.hourOfDay.find((h) => h.hour === 12)).toEqual({ hour: 12, count: 1, afterHours: 0 });
    expect(b.hourOfDay).toHaveLength(24);
    expect(b.afterHoursShare).toBe(0.2222);
  });
});

describe("calls per day, split in-hours / after-hours (IST days, empty days included)", () => {
  it("30 September days", async () => {
    const d = await daily(w.db, q);
    expect(d).toHaveLength(30);
    expect(d[0]).toEqual({ date: "2026-09-01", inHours: 0, afterHours: 0 });
    expect(d.find((x) => x.date === "2026-09-04")).toEqual({ date: "2026-09-04", inHours: 0, afterHours: 1 });
    expect(d.find((x) => x.date === "2026-09-08")).toEqual({ date: "2026-09-08", inHours: 0, afterHours: 1 });
    expect(d.reduce((a, x) => a + x.inHours + x.afterHours, 0)).toBe(9);
  });
  it("a call at 00:30 IST belongs to that IST day, not the previous UTC day", async () => {
    const { w: x } = await september();
    await x.call("midnight", { rang: new Date("2026-09-14T19:00:00Z"), answeredAfterS: 1, afterHours: true });
    expect((await daily(x.db, q)).find((d) => d.date === "2026-09-15")).toEqual({ date: "2026-09-15", inHours: 0, afterHours: 1 });
  }, 120_000);
});

describe("KPI tiles and the whole overview", () => {
  it("calls 9, qualified 3, booked 3, pushed 3, quoted 2, won 1, cost per booked 440.5, price leaks 1", async () => {
    expect(await kpis(w.db, q)).toEqual({ calls: 9, qualified: 3, booked: 3, pushed: 3, quoted: 2, won: 1, costPerBookedInr: 440.5, priceLeaks: 1 });
  });
  it("overview bundles every section", async () => {
    const o = await overview(w.db, q);
    expect(Object.keys(o).sort()).toEqual(["breakdowns", "cost", "daily", "escalations", "funnel", "kpis", "outcomes", "pipeline", "price", "range", "router", "speed"]);
  });
});

describe("previousRange: what each number is compared with", () => {
  const ist = (d: string) => new Date(`${d}T00:00:00+05:30`);
  it("a whole calendar month is compared with the whole month before it (even a 28-day February or a 31-day month)", () => {
    expect(previousRange({ from: ist("2026-09-01"), to: ist("2026-10-01"), demo: false })).toEqual({ from: ist("2026-08-01"), to: ist("2026-09-01"), demo: false, kind: "month" });
    expect(previousRange({ from: ist("2026-03-01"), to: ist("2026-04-01"), demo: true })).toEqual({ from: ist("2026-02-01"), to: ist("2026-03-01"), demo: true, kind: "month" });
    expect(previousRange({ from: ist("2026-01-01"), to: ist("2026-02-01"), demo: false })).toMatchObject({ from: ist("2025-12-01"), kind: "month" });
  });
  it("any other range is compared with the same number of days straight before it", () => {
    expect(previousRange({ from: ist("2026-09-10"), to: ist("2026-09-17"), demo: false })).toEqual({ from: ist("2026-09-03"), to: ist("2026-09-10"), demo: false, kind: "days" });
    expect(previousRange({ from: ist("2026-09-01"), to: ist("2026-09-16"), demo: false })).toMatchObject({ from: ist("2026-08-17"), kind: "days" }); // half a month is not a month
  });
  it("the previous period of the fixture's September (August has one call) really is computed", async () => {
    const p = previousRange(q);
    expect((await funnel(w.db, p)).stages[0]!.count).toBe(1);
  });
});
