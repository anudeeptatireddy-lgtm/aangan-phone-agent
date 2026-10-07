import { istDate } from "./hours";
import type { Locale, ScriptStatus } from "./scripts";

// festival_dates: a caller's description of a festival's distance is NEVER trusted ("Diwali is three weeks away").
// When a caller names a festival/event we resolve it to a calendar date from this table, read it back, and run check_fit
// on the CONFIRMED date. Only dates the owner has supplied are listed (Diwali 2026 = 8 Nov); add more rows as they are approved.
export interface FestivalDate {
  key: string;
  names: string[];                 // lower-case match strings (Latin and Devanagari)
  display: Record<Locale, string>;
  date: string;                    // YYYY-MM-DD
}

export const FESTIVAL_DATES: FestivalDate[] = [
  { key: "diwali", names: ["diwali", "deepavali", "दिवाली", "दीपावली", "दिवाळी"], display: { en: "Diwali", hi: "दिवाली", mr: "दिवाळी" }, date: "2026-11-08" },
];

// Events we recognise but have no approved date for: the agent must ask for a calendar date instead.
const KNOWN_UNCONFIGURED = [
  "ganesh chaturthi", "ganpati", "gudi padwa", "dussehra", "navratri", "holi", "eid", "christmas", "akshaya tritiya", "raksha bandhan", "onam", "pongal",
  "wedding", "shaadi", "griha pravesh", "housewarming", "गणेश चतुर्थी", "गणपती", "दशहरा", "होली", "शादी", "लग्न", "गृहप्रवेश",
];

export type FestivalResolution =
  | { resolved: true; key: string; name: string; date: string; days_from_now: number; weeks_from_now: number; readback: string; readback_status: ScriptStatus }
  | { resolved: false; reason: "no_event" | "unknown_event" | "date_passed" };

const MONTH: Record<Locale, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  hi: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
  mr: ["जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून", "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर"],
};
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
const mentions = (text: string, names: string[]) => names.some((n) => (/^[a-z ]+$/.test(n) ? new RegExp(`\\b${n}\\b`).test(text) : text.includes(n)));

/** Read-back languages enabled for callers. Hindi/Marathi wording exists but stays OFF until native review (owner decision, round 3). */
export const READBACK_ENABLED_LOCALES: readonly Locale[] = ["en"];

export function resolveFestival(text: string, callDate: Date, requested: Locale = "en", table: FestivalDate[] = FESTIVAL_DATES,
  enabled: readonly Locale[] = READBACK_ENABLED_LOCALES): FestivalResolution {
  const locale: Locale = enabled.includes(requested) ? requested : "en";
  const t = text.toLowerCase();
  const hit = table.find((f) => mentions(t, f.names));
  if (!hit) return { resolved: false, reason: mentions(t, KNOWN_UNCONFIGURED) ? "unknown_event" : "no_event" };

  const days = daysBetween(istDate(callDate), hit.date);
  if (days < 0) return { resolved: false, reason: "date_passed" };
  const weeks = Math.round(days / 7);
  const [, m, d] = hit.date.split("-").map(Number) as [number, number, number];
  const month = MONTH[locale][m - 1]!;
  const name = hit.display[locale];

  let readback: string;
  if (locale === "en") {
    const dist = days < 14 ? `${days} days` : `${weeks <= 20 ? WORDS[weeks] : weeks} weeks`;
    readback = `${name} is on ${d} ${month}, so about ${dist} from now. Is that your deadline?`;
  } else if (locale === "hi") {
    const dist = days < 14 ? `${days} दिन` : `${weeks} हफ़्ते`;
    readback = `${name} ${d} ${month} को है, यानी अभी से लगभग ${dist} बाद। क्या यही आपकी डेडलाइन है?`;
  } else {
    const dist = days < 14 ? `${days} दिवस` : `${weeks} आठवडे`;
    readback = `${name} ${d} ${month} रोजी आहे, म्हणजे आतापासून सुमारे ${dist} नंतर. हीच तुमची डेडलाइन आहे का?`;
  }
  return { resolved: true, key: hit.key, name, date: hit.date, days_from_now: days, weeks_from_now: weeks, readback,
    readback_status: locale === "en" ? "approved" : "draft_pending_native_review" };
}
