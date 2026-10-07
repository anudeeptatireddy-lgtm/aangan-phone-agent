import { resolveFestival } from "../festivals";
import { istDate } from "../hours";

// The model reports WHAT THE CALLER SAID about their deadline; this plain code turns it into a calendar date (hard rule 2).
// A festival's distance as the caller states it is never used: only the configured festival date (owner decision, round 2).
export type DeadlineStatement =
  | { kind: "date"; date: string }
  | { kind: "month"; month: number; year?: number }
  | { kind: "festival"; festival: string }
  | { kind: "relative"; value: number; unit: "days" | "weeks" | "months" }
  | { kind: "none" };

export type NormalizedDeadline = { date?: string; unresolved?: "unknown_event" | "no_event" | "date_passed" };

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDay(ny, nm)))}`;
}

export function normalizeDeadline(s: DeadlineStatement | null | undefined, callDate: Date): NormalizedDeadline {
  if (!s) return {};
  const today = istDate(callDate);
  switch (s.kind) {
    case "none": return {};
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(s.date) && !Number.isNaN(Date.parse(s.date)) ? { date: s.date } : {};
    case "month": {
      if (!Number.isInteger(s.month) || s.month < 1 || s.month > 12) return {};
      const [cy, cm] = today.split("-").map(Number) as [number, number];
      const year = s.year ?? (s.month >= cm ? cy : cy + 1);
      return { date: `${year}-${pad(s.month)}-${pad(lastDay(year, s.month))}` };
    }
    case "festival": {
      const r = resolveFestival(s.festival, callDate, "en");
      return r.resolved ? { date: r.date } : { unresolved: r.reason };
    }
    case "relative": {
      if (!Number.isFinite(s.value) || s.value <= 0) return {};
      if (s.unit === "days") return { date: addDays(today, s.value) };
      if (s.unit === "weeks") return { date: addDays(today, s.value * 7) };
      return { date: addMonths(today, s.value) };
    }
  }
}
