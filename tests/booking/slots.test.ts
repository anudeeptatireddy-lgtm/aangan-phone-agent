import { describe, it, expect } from "vitest";
import { candidateStarts, isCandidateStart, overlapsWithBuffer, pickOffered, formatSlot } from "@/core/booking/slots";
import { DEFAULT_BOOKING_CONFIG as CFG } from "@/core/booking/types";

const ist = (iso: string) => new Date(`${iso}+05:30`);
const NOW = ist("2026-10-07T10:30:00"); // Wednesday
const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const ymd = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

describe("candidateStarts", () => {
  const all = candidateStarts(NOW, CFG);
  it("starts no earlier than now + lead time, on the half hour", () => {
    expect(all[0]!.toISOString()).toBe(ist("2026-10-07T12:30:00").toISOString());
    for (const s of all) expect(s.getTime() % (30 * 60_000)).toBe(0);
  });
  it("last slot of a day must END by 19:00", () => {
    const wed = all.filter((s) => ymd(s) === "2026-10-07");
    expect(hhmm(wed[wed.length - 1]!)).toBe("18:00");
  });
  it("offers Saturdays but never Sundays (assumption: Mon-Sat)", () => {
    const days = new Set(all.map(ymd));
    expect(days.has("2026-10-10")).toBe(true);   // Saturday
    expect(days.has("2026-10-11")).toBe(false);  // Sunday
  });
  it("respects the horizon", () => {
    const last = all[all.length - 1]!;
    expect(last.getTime()).toBeLessThanOrEqual(NOW.getTime() + CFG.horizonDays * 86_400_000);
  });
  it("preferences: weekday evening, weekend only, specific date, earliest date", () => {
    const eve = candidateStarts(NOW, CFG, { weekdayOnly: true, afterTime: "18:00" });
    expect(eve.length).toBeGreaterThan(0);
    for (const s of eve) { expect(hhmm(s)).toBe("18:00"); expect([0, 6]).not.toContain(new Date(s.getTime() + 330 * 60_000).getUTCDay()); }
    const we = candidateStarts(NOW, CFG, { weekendOnly: true });
    for (const s of we) expect(new Date(s.getTime() + 330 * 60_000).getUTCDay()).toBe(6);
    const one = candidateStarts(NOW, CFG, { onDate: "2026-10-09" });
    expect(new Set(one.map(ymd))).toEqual(new Set(["2026-10-09"]));
    const from = candidateStarts(NOW, CFG, { earliestDate: "2026-10-12" });
    expect(ymd(from[0]!)).toBe("2026-10-12");
  });
  it("isCandidateStart validates window, step, lead time, horizon and Sundays", () => {
    expect(isCandidateStart(ist("2026-10-08T11:00:00"), NOW, CFG)).toBe(true);
    expect(isCandidateStart(ist("2026-10-08T11:15:00"), NOW, CFG)).toBe(false);  // off-step
    expect(isCandidateStart(ist("2026-10-08T18:30:00"), NOW, CFG)).toBe(false);  // would end after 19:00
    expect(isCandidateStart(ist("2026-10-08T09:30:00"), NOW, CFG)).toBe(false);  // before opening
    expect(isCandidateStart(ist("2026-10-07T11:00:00"), NOW, CFG)).toBe(false);  // inside the lead time
    expect(isCandidateStart(ist("2026-10-11T11:00:00"), NOW, CFG)).toBe(false);  // Sunday
    expect(isCandidateStart(ist("2026-12-01T11:00:00"), NOW, CFG)).toBe(false);  // beyond horizon
  });
});

describe("overlapsWithBuffer", () => {
  const slot = { start: ist("2026-10-08T12:00:00"), end: ist("2026-10-08T13:00:00") };
  const busy = (a: string, b: string) => [{ start: ist(`2026-10-08T${a}:00`), end: ist(`2026-10-08T${b}:00`) }];
  it("a busy block ending exactly at the start is still a conflict inside the 30-minute buffer", () => {
    expect(overlapsWithBuffer(slot, busy("11:00", "12:00"), 30)).toBe(true);
  });
  it("is free once the buffer is respected", () => {
    expect(overlapsWithBuffer(slot, busy("10:00", "11:30"), 30)).toBe(false);
    expect(overlapsWithBuffer(slot, busy("13:30", "14:30"), 30)).toBe(false);
    expect(overlapsWithBuffer(slot, busy("13:29", "14:30"), 30)).toBe(true);
  });
  it("zero buffer: adjacency is fine", () => expect(overlapsWithBuffer(slot, busy("11:00", "12:00"), 0)).toBe(false));
});

describe("pickOffered", () => {
  const starts = ["2026-10-07T12:30", "2026-10-07T13:00", "2026-10-08T11:00", "2026-10-08T11:30", "2026-10-10T10:30"].map((s) => ist(`${s}:00`));
  it("earliest slot on each of the first days, so callers hear distinct days", () => {
    expect(pickOffered(starts, 3).map((d) => d.toISOString())).toEqual([starts[0], starts[2], starts[4]].map((d) => d!.toISOString()));
  });
  it("tops up with more slots when fewer days are available", () => {
    expect(pickOffered(starts.slice(0, 2), 3)).toHaveLength(2);
    expect(pickOffered(starts.slice(0, 4), 3).map((d) => d.toISOString())).toEqual([starts[0], starts[2], starts[1]].map((d) => d!.toISOString()).sort());
  });
  it("returns a time-sorted list", () => {
    const r = pickOffered(starts, 4);
    expect([...r].sort((a, b) => a.getTime() - b.getTime())).toEqual(r);
  });
});

describe("formatSlot", () => {
  it("speaks IST: weekday, day month, 12-hour time", () => {
    expect(formatSlot(ist("2026-10-08T11:00:00"))).toBe("Thursday 8 October, 11:00 am");
    expect(formatSlot(ist("2026-10-10T10:30:00"))).toBe("Saturday 10 October, 10:30 am");
    expect(formatSlot(ist("2026-10-08T15:00:00"))).toBe("Thursday 8 October, 3:00 pm");
    expect(formatSlot(ist("2026-10-08T12:00:00"))).toBe("Thursday 8 October, 12:00 pm");
  });
});
