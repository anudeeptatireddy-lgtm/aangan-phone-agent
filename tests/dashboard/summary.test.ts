import { describe, it, expect } from "vitest";
import { buildSummary, type DashRows } from "@/core/dashboard/summary";

const call = (o: Partial<DashRows["calls"][number]> = {}) => ({ rangAt: new Date("2026-10-07T05:00:00Z"), durationS: 300, outcome: "booked" as const, afterHours: false, costAiInr: 0.24, costVoiceInr: 12, costTotalInr: 12.24, postCallStatus: "processed" as const, ...o });
const rows = (o: Partial<DashRows> = {}): DashRows => ({ calls: [], enquiries: [], handoffs: [], flags: [], ...o });
const range = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-08T00:00:00Z") };

describe("buildSummary", () => {
  it("an empty period is all zeros, not NaN", () => {
    const s = buildSummary(rows(), range);
    expect(s.totals).toEqual({ calls: 0, afterHours: 0, avgDurationS: 0, totalMinutes: 0 });
    expect(s.cost).toEqual({ totalInr: 0, aiInr: 0, voiceInr: 0, perCallInr: 0, perBookingInr: null });
    expect(s.rates).toEqual({ booked: 0, handoffAccepted: 0 });
  });
  it("counts volume, after-hours calls and durations", () => {
    const s = buildSummary(rows({ calls: [call(), call({ afterHours: true, durationS: 100 }), call({ durationS: null })] }), range);
    expect(s.totals).toEqual({ calls: 3, afterHours: 1, avgDurationS: 200, totalMinutes: 6.7 });
  });
  it("counts outcomes; calls with no outcome yet are 'unprocessed'", () => {
    const s = buildSummary(rows({ calls: [call(), call(), call({ outcome: "not_fit" }), call({ outcome: "escalated" }), call({ outcome: null })] }), range);
    expect(s.outcomes).toMatchObject({ booked: 2, not_fit: 1, escalated: 1, unprocessed: 1 });
    expect(s.rates.booked).toBe(0.4);
  });
  it("sums cost and derives per-call and per-booking cost", () => {
    const s = buildSummary(rows({ calls: [call(), call({ outcome: "not_fit", costAiInr: 0.2, costVoiceInr: 8, costTotalInr: 8.2 })] }), range);
    expect(s.cost.totalInr).toBe(20.44);
    expect(s.cost.perCallInr).toBe(10.22);
    expect(s.cost.perBookingInr).toBe(20.44);                 // total spend / bookings: what one booked consultation costs
    expect(s.cost.aiInr).toBe(0.44);
  });
  it("calls with unknown cost are not counted as zero-cost silently: they are reported", () => {
    const s = buildSummary(rows({ calls: [call({ costTotalInr: null, costAiInr: null, costVoiceInr: null })] }), range);
    expect(s.cost.unpricedCalls).toBe(1);
  });
  it("fit mix, handoff funnel and accept rate", () => {
    const s = buildSummary(rows({ enquiries: [{ fit: "fit" }, { fit: "fit" }, { fit: "unclear" }, { fit: "not_fit" }], handoffs: [{ status: "accepted" }, { status: "accepted" }, { status: "declined" }, { status: "timed_out" }, { status: "sent" }] }), range);
    expect(s.fits).toEqual({ fit: 2, not_fit: 1, unclear: 1 });
    expect(s.handoffs).toMatchObject({ accepted: 2, declined: 1, timed_out: 1, sent: 1 });
    expect(s.rates.handoffAccepted).toBe(0.4);
  });
  it("attention: unresolved flags by kind and failed extractions", () => {
    const s = buildSummary(rows({ calls: [call({ postCallStatus: "extraction_failed" })], flags: [{ kind: "price_mention", resolved: false }, { kind: "price_mention", resolved: true }, { kind: "missed_complaint", resolved: false }] }), range);
    expect(s.attention).toEqual({ openFlags: { price_mention: 1, missed_complaint: 1 }, extractionFailed: 1 });
  });
  it("daily series is bucketed by IST day, including empty days", () => {
    const s = buildSummary(rows({ calls: [call({ rangAt: new Date("2026-10-06T19:00:00Z") }), call({ rangAt: new Date("2026-10-07T05:00:00Z") })] }), { from: new Date("2026-10-06T18:30:00Z"), to: new Date("2026-10-09T18:30:00Z") });
    expect(s.daily.map((d) => [d.date, d.calls])).toEqual([["2026-10-07", 2], ["2026-10-08", 0], ["2026-10-09", 0]]);
  });
  it("contains no phone numbers or names by construction (only counts and money)", () => {
    expect(JSON.stringify(buildSummary(rows({ calls: [call()] }), range))).not.toMatch(/\+91|@/);
  });
});
