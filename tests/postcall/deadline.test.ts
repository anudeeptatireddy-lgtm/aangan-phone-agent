import { describe, it, expect } from "vitest";
import { normalizeDeadline } from "@/core/postcall/deadline";

const CALL = new Date("2026-09-08T10:00:00+05:30");

describe("normalizeDeadline: the model reports what was said; plain code makes the date", () => {
  it("explicit date passes through", () => expect(normalizeDeadline({ kind: "date", date: "2027-03-15" }, CALL)).toEqual({ date: "2027-03-15" }));
  it("month only -> last day of that month, next occurrence on/after the call", () => {
    expect(normalizeDeadline({ kind: "month", month: 3 }, CALL)).toEqual({ date: "2027-03-31" });
    expect(normalizeDeadline({ kind: "month", month: 9 }, CALL)).toEqual({ date: "2026-09-30" });
    expect(normalizeDeadline({ kind: "month", month: 8 }, CALL)).toEqual({ date: "2027-08-31" });
    expect(normalizeDeadline({ kind: "month", month: 2, year: 2028 }, CALL)).toEqual({ date: "2028-02-29" }); // leap year
    expect(normalizeDeadline({ kind: "month", month: 2, year: 2027 }, CALL)).toEqual({ date: "2027-02-28" });
  });
  it("festival -> the configured calendar date, NEVER a distance the caller stated", () => {
    expect(normalizeDeadline({ kind: "festival", festival: "before Diwali" }, CALL)).toEqual({ date: "2026-11-08" });
    expect(normalizeDeadline({ kind: "festival", festival: "Ganesh Chaturthi" }, CALL)).toEqual({ unresolved: "unknown_event" });
  });
  it("relative: weeks, days, months from the call date", () => {
    expect(normalizeDeadline({ kind: "relative", value: 3, unit: "weeks" }, CALL)).toEqual({ date: "2026-09-29" });
    expect(normalizeDeadline({ kind: "relative", value: 10, unit: "days" }, CALL)).toEqual({ date: "2026-09-18" });
    expect(normalizeDeadline({ kind: "relative", value: 4, unit: "months" }, CALL)).toEqual({ date: "2027-01-08" });
    expect(normalizeDeadline({ kind: "relative", value: 6, unit: "weeks" }, CALL)).toEqual({ date: "2026-10-20" });
  });
  it("none / null / junk -> nothing", () => {
    expect(normalizeDeadline({ kind: "none" }, CALL)).toEqual({});
    expect(normalizeDeadline(null, CALL)).toEqual({});
    expect(normalizeDeadline({ kind: "date", date: "March" }, CALL)).toEqual({});
    expect(normalizeDeadline({ kind: "month", month: 13 }, CALL)).toEqual({});
    expect(normalizeDeadline({ kind: "relative", value: -2, unit: "weeks" }, CALL)).toEqual({});
  });
});
