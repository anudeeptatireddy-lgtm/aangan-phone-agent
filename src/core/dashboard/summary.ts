// The owner dashboard's numbers. Pure: rows in, counts and money out. No caller details ever pass through here.
export type DashOutcome = "booked" | "escalated" | "not_fit" | "review" | "dropped" | "not_qualified" | string;
export interface DashRows {
  calls: { rangAt: Date | null; durationS: number | null; outcome: DashOutcome | null; afterHours: boolean | null; costAiInr: number | null; costVoiceInr: number | null; costTotalInr: number | null; postCallStatus: string }[];
  enquiries: { fit: "fit" | "not_fit" | "unclear" | null }[];
  handoffs: { status: string }[];
  flags: { kind: string; resolved: boolean }[];
}

const IST = 330 * 60_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

export function buildSummary(rows: DashRows, range: { from: Date; to: Date }) {
  const n = rows.calls.length;
  const durs = rows.calls.map((c) => c.durationS).filter((x): x is number => x != null);
  const outcomes: Record<string, number> = { booked: 0, escalated: 0, not_fit: 0, review: 0, dropped: 0, unprocessed: 0 };
  for (const c of rows.calls) { const k = c.outcome ?? "unprocessed"; outcomes[k] = (outcomes[k] ?? 0) + 1; }

  const sum = (f: (c: DashRows["calls"][number]) => number | null) => r2(rows.calls.reduce((a, c) => a + (f(c) ?? 0), 0));
  const totalInr = sum((c) => c.costTotalInr);
  const booked = outcomes.booked ?? 0;

  const fits = { fit: 0, not_fit: 0, unclear: 0 };
  for (const e of rows.enquiries) if (e.fit) fits[e.fit]++;
  const handoffs: Record<string, number> = { pending: 0, sent: 0, accepted: 0, declined: 0, timed_out: 0, reassigned: 0 };
  for (const h of rows.handoffs) handoffs[h.status] = (handoffs[h.status] ?? 0) + 1;
  const openFlags: Record<string, number> = {};
  for (const f of rows.flags) if (!f.resolved) openFlags[f.kind] = (openFlags[f.kind] ?? 0) + 1;

  // One bucket per IST day in [from, to), empty days included.
  const daily: { date: string; calls: number; booked: number; costInr: number }[] = [];
  const index = new Map<string, number>();
  for (let t = range.from.getTime(); t < range.to.getTime(); t += 86_400_000) {
    const date = istDay(new Date(t)); index.set(date, daily.length); daily.push({ date, calls: 0, booked: 0, costInr: 0 });
  }
  for (const c of rows.calls) {
    const i = c.rangAt ? index.get(istDay(c.rangAt)) : undefined;
    if (i === undefined) continue;
    const d = daily[i]!; d.calls++; if (c.outcome === "booked") d.booked++; d.costInr = r2(d.costInr + (c.costTotalInr ?? 0));
  }

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    totals: { calls: n, afterHours: rows.calls.filter((c) => c.afterHours).length, avgDurationS: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0, totalMinutes: Math.round((durs.reduce((a, b) => a + b, 0) / 60) * 10) / 10 },
    outcomes,
    fits,
    handoffs,
    rates: { booked: n ? r2(booked / n) : 0, handoffAccepted: rows.handoffs.length ? r2((handoffs.accepted ?? 0) / rows.handoffs.length) : 0 },
    cost: { totalInr, aiInr: sum((c) => c.costAiInr), voiceInr: sum((c) => c.costVoiceInr), perCallInr: n ? r2(totalInr / n) : 0, perBookingInr: booked ? r2(totalInr / booked) : null,
      ...(rows.calls.some((c) => c.costTotalInr == null) ? { unpricedCalls: rows.calls.filter((c) => c.costTotalInr == null).length } : {}) },
    attention: { openFlags, extractionFailed: rows.calls.filter((c) => c.postCallStatus === "extraction_failed").length },
    daily,
  };
}
export type DashboardSummary = ReturnType<typeof buildSummary>;
