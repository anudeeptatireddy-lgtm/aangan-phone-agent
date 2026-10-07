import { z } from "zod";
import type { Extraction } from "@/core/postcall/extraction";

// Vaani's per-call "entity" object: the 23 data points configured on the agent (names in agent/entities.json). All values are strings or null;
// "NA" / "unknown" mean "not said". The post-call Gemini extraction fills whatever Vaani left empty (owner decision, 2026-10-07).

const MISSING = new Set(["", "na", "n/a", "none", "null", "nil", "not available", "not mentioned", "-"]);

export function normalizeEntities(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined || typeof v === "object") continue;
    const s = String(v).trim();
    if (!MISSING.has(s.toLowerCase())) out[k] = s;
  }
  return out;
}

const yes = (s?: string) => (s && /^(yes|y|true)$/i.test(s) ? true : s && /^(no|n|false)$/i.test(s) ? false : null);
const int = (s?: string) => { const m = s && /(\d+)/.exec(s.replace(/,/g, "")); return m ? Number(m[1]) : null; };
const num = (s?: string) => { const m = s && /(\d+(?:\.\d+)?)/.exec(s.replace(/,/g, "")); return m ? Number(m[1]) : null; };

/** Indian money words: "15 lakh", "2.5 lac", "3 crore", "80k", "Rs. 12,00,000". Anything vaguer is null (never guessed). */
export function parseRupees(s: string): number | null {
  const t = s.toLowerCase().replace(/rs\.?|₹|inr|around|about|approximately|approx\.?/g, " ").replace(/,/g, "").trim();
  const m = /^(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|lac|crores?|cr|thousand|k)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = !unit ? 1 : /^(lakh|lac)/.test(unit) ? 100_000 : /^(crore|cr)/.test(unit) ? 10_000_000 : 1_000;
  return Math.round(n * mult);
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const FESTIVALS = ["diwali", "dussehra", "navratri", "ganesh chaturthi", "ganeshotsav", "gudi padwa", "akshaya tritiya", "holi", "eid", "christmas", "pongal", "onam", "raksha bandhan"];

function parseDeadline(s: string): Extraction["deadline"] {
  const t = s.toLowerCase();
  const text = s;
  const fest = FESTIVALS.find((f) => t.includes(f));
  if (fest) return { kind: "festival", date: null, month: null, year: null, festival: fest.replace(/\b\w/g, (c) => c.toUpperCase()), value: null, unit: null, text };
  const rel = /(?:in|within)\s+(\d+)\s*(day|week|month)s?/.exec(t);
  if (rel) return { kind: "relative", date: null, month: null, year: null, festival: null, value: Number(rel[1]), unit: `${rel[2]}s` as "days" | "weeks" | "months", text };
  // A month counts only after a deadline word ("by March", "before the end of Jan"), so "may" the verb or "market" never match.
  const mm = new RegExp(`\\b(?:by|in|before|until|till|latest|around|end of|within)\\s+(?:the\\s+)?(?:end\\s+of\\s+)?(?:month\\s+of\\s+)?(${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join("|")})\\b`).exec(t);
  if (mm) {
    const mi = MONTHS.findIndex((m) => m === mm[1] || m.slice(0, 3) === mm[1]);
    const yr = /\b(20\d\d)\b/.exec(t);
    return { kind: "month", date: null, month: mi + 1, year: yr ? Number(yr[1]) : null, festival: null, value: null, unit: null, text };
  }
  return null; // vague ("as soon as possible"): leave it to the Gemini extraction, which sees the whole conversation
}

const PROJECT = z.enum(["home", "office", "other"]);

export function mergeVaaniEntities(base: Extraction, rawEntity: unknown): Extraction {
  const v = normalizeEntities(rawEntity);
  const e: Extraction = { ...base };
  const low = (k: string) => v[k]?.toLowerCase();

  if (v.caller_name) e.caller_name = v.caller_name;
  if (v.caller_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.caller_email)) e.caller_email = v.caller_email.toLowerCase();
  if (v.locality) e.location = v.locality;
  const pt = PROJECT.safeParse(low("project_type"));
  if (pt.success) e.project_type = pt.data;
  const bhk = int(v.bhk); if (bhk) e.bhk = bhk;
  const sq = num(v.carpet_area_sqft); if (sq) e.carpet_sqft = sq;
  if (v.referral_source) e.source_heard = v.referral_source;
  if (v.referrer_name) e.referrer = v.referrer_name;

  const lang = low("language");
  if (lang) e.language = lang.startsWith("hin") ? "hi" : lang.startsWith("mar") ? "mr" : lang.startsWith("eng") ? "en" : e.language;

  const intent = low("intent");
  if (intent === "new_enquiry" || intent === "existing_client" || intent === "other") e.intent = intent;
  if (yes(v.is_complaint) === true) e.intent = "complaint";

  const ow = yes(v.owners_attend); if (ow !== null) e.owners_attending = ow;
  const rent = yes(v.is_rental); if (rent !== null) e.tenure = rent ? "rented" : "owned";
  const lc = yes(v.landlord_consent); if (lc !== null) e.landlord_consent = lc;
  if (yes(v.asked_price) === true) e.asked_for_price = true; // only ever raised

  // service: the studio does design AND execution; "design only" is the advisory case the rules already decline.
  const svc = low("service_wanted");
  if (svc === "design_only") e.scope = "advisory_only";
  if (svc === "execution_only") e.notes = [e.notes, "Caller wants execution only (not design + execution): check before the consultation."].filter(Boolean).join(" ");

  // free-text scope / state: only used when the other source had nothing better
  const sc = low("scope");
  if (sc && e.scope === "unspecified") {
    if (/full|whole|complete|entire/.test(sc) && !/office/.test(sc)) e.scope = "full_home";
    else if (/office|fit-?out/.test(sc)) e.scope = "office_fitout";
    else if (/^kitchen( only)?$/.test(sc)) e.scope = "kitchen_only";
    else if (/^wardrobes?( only)?$/.test(sc)) e.scope = "wardrobe_only";
  }
  const cs = low("current_state");
  if (cs && e.current_state === "unknown") e.current_state = /await|possession/.test(cs) ? "awaiting_possession" : /bare|empty|shell/.test(cs) ? "bare" : /lived|occupied|staying|living/.test(cs) ? "lived_in" : /construct/.test(cs) ? "under_construction" : e.current_state;

  if (v.completion_deadline) { const d = parseDeadline(v.completion_deadline); if (d) e.deadline = d; }
  if (v.budget_volunteered && e.budget_inr === null) { const b = parseRupees(v.budget_volunteered); if (b !== null) e.budget_inr = b; }
  return e;
}

export interface VaaniBookingClaim { booked: boolean; time: string | null; wantsPerson: boolean }
/** What the agent says happened. Only a CLAIM: the booking itself is confirmed from Cal.com, never from this. */
export function bookingClaim(rawEntity: unknown): VaaniBookingClaim {
  const v = normalizeEntities(rawEntity);
  return { booked: yes(v.booked_consultation) === true, time: v.booked_time ?? null, wantsPerson: yes(v.wants_person) === true };
}
