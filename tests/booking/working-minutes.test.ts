import { describe, it, expect } from "vitest";
import { addWorkingMinutes } from "@/core/booking/working-minutes";
import { DEFAULT_HOURS } from "@/core/hours";

const ist = (iso: string) => new Date(`${iso}+05:30`);
const iso = (d: Date) => d.toISOString();

describe("addWorkingMinutes (Mon-Fri 10:00-19:00 IST)", () => {
  it("adds inside the working day", () => {
    expect(iso(addWorkingMinutes(ist("2026-10-07T11:00:00"), 30))).toBe(iso(ist("2026-10-07T11:30:00")));
  });
  it("carries the remainder to the next working morning", () => {
    // 18:45 + 30 min: 15 min today, 15 min after opening tomorrow
    expect(iso(addWorkingMinutes(ist("2026-10-07T18:45:00"), 30))).toBe(iso(ist("2026-10-08T10:15:00")));
  });
  it("starting after hours counts from the next opening", () => {
    expect(iso(addWorkingMinutes(ist("2026-10-07T22:00:00"), 30))).toBe(iso(ist("2026-10-08T10:30:00")));
    expect(iso(addWorkingMinutes(ist("2026-10-07T07:00:00"), 30))).toBe(iso(ist("2026-10-07T10:30:00")));
  });
  it("Friday evening rolls to Monday; weekends do not count", () => {
    expect(iso(addWorkingMinutes(ist("2026-10-09T18:50:00"), 30))).toBe(iso(ist("2026-10-12T10:20:00")));
    expect(iso(addWorkingMinutes(ist("2026-10-10T12:00:00"), 30))).toBe(iso(ist("2026-10-12T10:30:00"))); // Saturday
  });
  it("holidays are skipped", () => {
    const cfg = { ...DEFAULT_HOURS, holidays: ["2026-10-08"] };
    expect(iso(addWorkingMinutes(ist("2026-10-07T18:50:00"), 30, cfg))).toBe(iso(ist("2026-10-09T10:20:00")));
  });
  it("spans more than a day and handles zero", () => {
    expect(iso(addWorkingMinutes(ist("2026-10-07T10:00:00"), 9 * 60 + 30))).toBe(iso(ist("2026-10-08T10:30:00")));
    expect(iso(addWorkingMinutes(ist("2026-10-07T12:00:00"), 0))).toBe(iso(ist("2026-10-07T12:00:00")));
  });
});
