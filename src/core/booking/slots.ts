import type { BookingConfig, Interval } from "./types";

const IST = 330 * 60_000;
const istYmd = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const istDow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number) as [number, number]; return h * 60 + m; };
const fromIst = (ymd: string, minutes: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) - IST + minutes * 60_000);

export interface SlotPrefs {
  earliestDate?: string;  // YYYY-MM-DD
  onDate?: string;        // YYYY-MM-DD
  afterTime?: string;     // HH:MM, slot start >= this
  beforeTime?: string;    // HH:MM, slot start < this
  weekdayOnly?: boolean;
  weekendOnly?: boolean;
}

/** All bookable start times (IST window, step, lead time, horizon, preferences), sorted. */
export function candidateStarts(now: Date, cfg: BookingConfig, prefs: SlotPrefs = {}): Date[] {
  const earliest = now.getTime() + cfg.minLeadMinutes * 60_000;
  const latest = now.getTime() + cfg.horizonDays * 86_400_000;
  const open = toMin(cfg.window.open), close = toMin(cfg.window.close);
  const out: Date[] = [];
  for (let i = 0; i <= cfg.horizonDays; i++) {
    const ymd = istYmd(new Date(now.getTime() + i * 86_400_000));
    const dow = istDow(ymd);
    if (!cfg.window.days.includes(dow)) continue;
    if (prefs.onDate && ymd !== prefs.onDate) continue;
    if (prefs.earliestDate && ymd < prefs.earliestDate) continue;
    if (prefs.weekdayOnly && (dow === 0 || dow === 6)) continue;
    if (prefs.weekendOnly && dow !== 0 && dow !== 6) continue;
    for (let m = open; m + cfg.slotMinutes <= close; m += cfg.stepMinutes) {
      if (prefs.afterTime && m < toMin(prefs.afterTime)) continue;
      if (prefs.beforeTime && m >= toMin(prefs.beforeTime)) continue;
      const start = fromIst(ymd, m);
      if (start.getTime() < earliest || start.getTime() > latest) continue;
      out.push(start);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export function isCandidateStart(start: Date, now: Date, cfg: BookingConfig): boolean {
  if (Number.isNaN(start.getTime())) return false;
  return candidateStarts(now, cfg).some((s) => s.getTime() === start.getTime());
}

/** True if the slot comes within `bufferMinutes` of any busy interval. */
export function overlapsWithBuffer(slot: Interval, busy: Interval[], bufferMinutes: number): boolean {
  const b = bufferMinutes * 60_000;
  return busy.some((x) => x.start.getTime() - b < slot.end.getTime() && x.end.getTime() + b > slot.start.getTime());
}

/** Earliest slot on each of the first days (so callers hear distinct days), topped up with more slots; returned in time order. */
export function pickOffered(starts: Date[], max: number): Date[] {
  const chosen: Date[] = [];
  const seenDays = new Set<string>();
  for (const s of starts) {
    const day = istYmd(s);
    if (!seenDays.has(day) && chosen.length < max) { seenDays.add(day); chosen.push(s); }
  }
  for (const s of starts) if (chosen.length < max && !chosen.includes(s)) chosen.push(s);
  return chosen.sort((a, b) => a.getTime() - b.getTime());
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Thursday 8 October, 11:00 am" in IST. */
export function formatSlot(d: Date): string {
  const s = new Date(d.getTime() + IST);
  const h = s.getUTCHours(), m = s.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${WEEKDAY[s.getUTCDay()]} ${s.getUTCDate()} ${MONTH[s.getUTCMonth()]}, ${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export { istYmd };
