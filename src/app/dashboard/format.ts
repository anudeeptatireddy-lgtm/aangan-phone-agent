// Plain wording and number helpers for the dashboard (no React, no Next): unit tested in tests/dashboard/format.test.ts.
// ---- words and numbers ---------------------------------------------------------------------------------------------------------------------------
export const inr = (n: number | null | undefined, max = 2) => (n == null ? "n/a" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: max })}`);
export const inrShort = (n: number | null | undefined) => {
  if (n == null) return "n/a";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} crore`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} lakh`;
  return inr(n, 0);
};
export const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${Math.round(x * 1000) / 10}%`);
const IST = { timeZone: "Asia/Kolkata" } as const;
export const when = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString("en-IN", { ...IST, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "—");
export const whenShort = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" }) : "—");
export const clock = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleTimeString("en-IN", { ...IST, hour: "numeric", minute: "2-digit", hour12: true }) : "—");
export const day = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short", year: "numeric" }) : "—");
export const weekdayDate = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { ...IST, weekday: "short", day: "numeric", month: "short" }) : "—");
export const dur = (s: number | null | undefined) => (s == null ? "—" : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
export const mins = (m: number | null | undefined) => (m == null ? "n/a" : m < 1 ? "under a minute" : `${Math.round(m)} min`);
export const label = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");
export const langName = (l: string | null | undefined) => (l === "en" ? "English" : l === "hi" ? "Hindi" : l === "mr" ? "Marathi" : l ? l : null);
/** The work a caller wanted, in words ("unspecified" is a system word). */
export const scopeName = (s: string | null | undefined) => (!s || s === "unspecified" ? "Not said" : label(s));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const parseYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number) as [number, number, number]; return { y, m, d }; };
const short = (s: string) => { const { m, d } = parseYmd(s); return `${d} ${MONTHS[m - 1]!.slice(0, 3)}`; };
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** "September 2026" for a whole calendar month, else "1 Sep to 14 Sep 2026". */
export function periodTitle(from: string, to: string): string {
  const a = parseYmd(from), b = parseYmd(to);
  if (a.y === b.y && a.m === b.m && a.d === 1 && b.d === lastDay(b.y, b.m)) return `${MONTHS[a.m - 1]} ${a.y}`;
  return a.y === b.y ? `${short(from)} to ${short(to)} ${b.y}` : `${short(from)} ${a.y} to ${short(to)} ${b.y}`;
}
/** What the previous period is called in a sentence: "August" or "the 7 days before". */
export function previousName(c: { prev: { kind: "month" | "days"; from: Date; to: Date } }): string {
  if (c.prev.kind === "month") return MONTHS[new Date(c.prev.from.getTime() + 330 * 60_000).getUTCMonth()]!;
  return `the ${Math.round((c.prev.to.getTime() - c.prev.from.getTime()) / 86_400_000)} days before`;
}
/** "up 4", "down 4", "same" against the previous period, with a tone only where a direction is clearly better. */
export function vs(cur: number | null | undefined, prev: number | null | undefined, o: { better?: "lower" | "higher"; fmt?: (n: number) => string } = {}): { text: string; tone: "" | "better" | "worse" } {
  const f = o.fmt ?? ((n: number) => String(n));
  if (cur == null || prev == null) return { text: "", tone: "" };
  const d = Math.round((cur - prev) * 100) / 100;
  const word = d === 0 ? "same" : d > 0 ? `up ${f(Math.abs(d))}` : `down ${f(Math.abs(d))}`;
  const tone = d === 0 || !o.better ? "" : (d < 0) === (o.better === "lower") ? "better" : "worse";
  return { text: word, tone };
}

export const outcomeWord = (o: string | null | undefined) => ({ booked: "Booked", not_fit: "Not a fit", review: "Needs a person", escalated: "Passed to a person", closed_other: "Not an enquiry", dropped: "Call dropped", missed: "Missed" } as Record<string, string>)[o ?? ""] ?? label(o);
