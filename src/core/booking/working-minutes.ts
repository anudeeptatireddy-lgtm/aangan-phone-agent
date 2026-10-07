import { DEFAULT_HOURS, HoursConfig, isWorkingTime, minutesLeftToday, nextOpening } from "../hours";

/** `start` + N WORKING minutes (Mon-Fri 10:00-19:00 IST by default). Time outside working hours does not count. */
export function addWorkingMinutes(start: Date, minutes: number, cfg: HoursConfig = DEFAULT_HOURS): Date {
  let t = isWorkingTime(start, cfg) ? start : nextOpening(start, cfg);
  let remaining = minutes;
  for (let guard = 0; guard < 400; guard++) {
    const left = minutesLeftToday(t, cfg);
    if (remaining <= left) return new Date(t.getTime() + remaining * 60_000);
    remaining -= left;
    t = nextOpening(new Date(t.getTime() + left * 60_000), cfg);
  }
  throw new Error("addWorkingMinutes: no working time found; check hours config");
}

/** Working minutes elapsed between two instants (0 if `end` is not after `start`). The inverse of addWorkingMinutes. */
export function workingMinutesBetween(start: Date, end: Date, cfg: HoursConfig = DEFAULT_HOURS): number {
  if (end <= start) return 0;
  let t = isWorkingTime(start, cfg) ? start : nextOpening(start, cfg);
  let total = 0;
  for (let guard = 0; guard < 4000 && t < end; guard++) {
    const left = minutesLeftToday(t, cfg);
    const span = (end.getTime() - t.getTime()) / 60_000;
    if (span <= left) return total + span;
    total += left;
    t = nextOpening(new Date(t.getTime() + left * 60_000), cfg);
  }
  return total;
}
