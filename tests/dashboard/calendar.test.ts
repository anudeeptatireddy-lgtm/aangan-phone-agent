import { describe, it, expect, beforeAll } from "vitest";
import { monthGrid, monthsIn } from "@/app/dashboard/calendar-grid";
import { dailyCounts } from "@/db/dash-days";
import { september, type World } from "./fixture";

describe("the calendar grid", () => {
  it("September 2026 starts on a Tuesday: weeks are Monday-first, 5 rows of 7, padded with the neighbouring months", () => {
    const g = monthGrid(2026, 9);
    expect(g).toHaveLength(5); for (const w of g) expect(w).toHaveLength(7);
    expect(g[0]![0]).toMatchObject({ date: "2026-08-31", inMonth: false });
    expect(g[0]![1]).toMatchObject({ date: "2026-09-01", day: 1, inMonth: true });
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(30);
  });
  it("a month that starts on a Monday has no leading padding; February 2027 is exactly 4 rows", () => {
    expect(monthGrid(2027, 2)[0]![0]).toMatchObject({ date: "2027-02-01", inMonth: true });
    expect(monthGrid(2027, 2)).toHaveLength(4);
  });
  it("monthsIn lists the months a range touches, capped", () => {
    expect(monthsIn("2026-09-01", "2026-09-30")).toEqual([{ year: 2026, month: 9 }]);
    expect(monthsIn("2026-11-20", "2027-01-05")).toEqual([{ year: 2026, month: 11 }, { year: 2026, month: 12 }, { year: 2027, month: 1 }]);
    expect(monthsIn("2026-01-01", "2026-12-31", 2)).toHaveLength(2);
  });
});

describe("calls and converted calls per day", () => {
  let w: World;
  beforeAll(async () => { ({ w } = await september()); }, 120_000);
  it("sums to the month's calls, never counts more converted than calls, and buckets by the IST day", async () => {
    const days = await dailyCounts(w.db, { from: new Date("2026-08-31T18:30:00Z"), to: new Date("2026-09-30T18:30:00Z"), demo: false });
    const total = Object.values(days).reduce((a, d) => a + d.calls, 0);
    const all = Number(((await w.db.query("select count(*)::int n from calls where is_demo = false and coalesce(rang_at, ended_at, created_at) >= '2026-08-31T18:30:00Z' and coalesce(rang_at, ended_at, created_at) < '2026-09-30T18:30:00Z'")).rows[0] as { n: number }).n);
    expect(total).toBe(all); expect(total).toBeGreaterThan(0);
    for (const [d, v] of Object.entries(days)) { expect(d).toMatch(/^2026-09-\d\d$/); expect(v.booked).toBeLessThanOrEqual(v.calls); }
  });
});
