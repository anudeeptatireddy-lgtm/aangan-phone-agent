import { describe, it, expect } from "vitest";
import { isWorkingTime, nextOpening, DEFAULT_HOURS } from "@/core/hours";

// IST = UTC+5:30. 2026-10-07 is a Wednesday.
const ist = (iso: string) => new Date(`${iso}+05:30`);

describe("working hours (IST)", () => {
  it("open 10:00 inclusive, closed 19:00", () => {
    expect(isWorkingTime(ist("2026-10-07T09:59:59"))).toBe(false);
    expect(isWorkingTime(ist("2026-10-07T10:00:00"))).toBe(true);
    expect(isWorkingTime(ist("2026-10-07T18:59:59"))).toBe(true);
    expect(isWorkingTime(ist("2026-10-07T19:00:00"))).toBe(false);
  });
  it("closed on non-working days (default Mon-Fri, pending Nikhil)", () => {
    expect(isWorkingTime(ist("2026-10-10T12:00:00"))).toBe(false); // Saturday
    expect(isWorkingTime(ist("2026-10-11T12:00:00"))).toBe(false); // Sunday
  });
  it("uses IST, not the server's timezone", () => {
    // 04:30 UTC == 10:00 IST
    expect(isWorkingTime(new Date("2026-10-07T04:30:00Z"))).toBe(true);
    expect(isWorkingTime(new Date("2026-10-07T04:29:00Z"))).toBe(false);
  });
  it("next opening: same day before open, next working day after close, skips weekend", () => {
    expect(nextOpening(ist("2026-10-07T08:00:00")).toISOString()).toBe(ist("2026-10-07T10:00:00").toISOString());
    expect(nextOpening(ist("2026-10-07T21:00:00")).toISOString()).toBe(ist("2026-10-08T10:00:00").toISOString());
    expect(nextOpening(ist("2026-10-09T20:00:00")).toISOString()).toBe(ist("2026-10-12T10:00:00").toISOString()); // Fri night -> Mon
  });
  it("holidays are config-driven", () => {
    const cfg = { ...DEFAULT_HOURS, holidays: ["2026-10-08"] };
    expect(isWorkingTime(ist("2026-10-08T12:00:00"), cfg)).toBe(false);
    expect(nextOpening(ist("2026-10-07T21:00:00"), cfg).toISOString()).toBe(ist("2026-10-09T10:00:00").toISOString());
  });
});
