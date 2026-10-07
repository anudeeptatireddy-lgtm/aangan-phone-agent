export interface HoursConfig {
  openHour: number;       // IST, inclusive
  closeHour: number;      // IST, exclusive
  workingWeekdays: number[]; // 0=Sun .. 6=Sat
  holidays: string[];     // YYYY-MM-DD in IST
}

// 10am-7pm is fixed by the brief. Working DAYS are NOT specified (open question Q6): default is the
// conservative Mon-Fri so we never promise a live transfer when nobody may be at the desk.
export const DEFAULT_HOURS: HoursConfig = { openHour: 10, closeHour: 19, workingWeekdays: [1, 2, 3, 4, 5], holidays: [] };

const IST_OFFSET_MS = 330 * 60_000;
const istParts = (d: Date) => {
  const s = new Date(d.getTime() + IST_OFFSET_MS); // read with getUTC* => IST wall clock
  return { y: s.getUTCFullYear(), m: s.getUTCMonth() + 1, day: s.getUTCDate(), wd: s.getUTCDay(), h: s.getUTCHours() };
};
const ymd = (p: { y: number; m: number; day: number }) =>
  `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
const istMidnightMs = (p: { y: number; m: number; day: number }) => Date.UTC(p.y, p.m - 1, p.day) - IST_OFFSET_MS;

function isWorkingDay(d: Date, cfg: HoursConfig): boolean {
  const p = istParts(d);
  return cfg.workingWeekdays.includes(p.wd) && !cfg.holidays.includes(ymd(p));
}

export function isWorkingTime(d: Date, cfg: HoursConfig = DEFAULT_HOURS): boolean {
  const p = istParts(d);
  return isWorkingDay(d, cfg) && p.h >= cfg.openHour && p.h < cfg.closeHour;
}

/** The next moment the studio opens (now, if it is open right now is NOT assumed: used for after-hours promises). */
export function nextOpening(d: Date, cfg: HoursConfig = DEFAULT_HOURS): Date {
  const p = istParts(d);
  let dayStart = istMidnightMs(p);
  // Same day, still before opening?
  if (isWorkingDay(d, cfg) && p.h < cfg.openHour) return new Date(dayStart + cfg.openHour * 3_600_000);
  for (let i = 1; i <= 366; i++) {
    const candidate = new Date(dayStart + i * 86_400_000 + 12 * 3_600_000); // midday of that IST day
    if (isWorkingDay(candidate, cfg)) return new Date(dayStart + i * 86_400_000 + cfg.openHour * 3_600_000);
  }
  throw new Error("No working day found in the next year; check hours config");
}
