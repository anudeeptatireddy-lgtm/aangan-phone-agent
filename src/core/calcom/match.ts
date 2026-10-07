import type { CalBooking } from "./types";

// Owner-approved (2026-10-07). Clock skew between Vaani and Cal.com before the call; Cal.com's webhook delay after it.
export const MATCH_BEFORE_MS = 2 * 60_000;
export const MATCH_AFTER_MS = 10 * 60_000;
/** Call end + this: anything still unmatched is flagged to the design lead. */
export const SWEEP_AFTER_MS = 15 * 60_000;
/** A booking no call claimed this long after Cal.com created it is reported (low priority). Longer than any call + sweep. */
export const ORPHAN_AFTER_MS = 45 * 60_000;

export interface CallFacts {
  startedAt: Date;
  endedAt: Date;
  /** HMAC of the caller's E.164 number (see `callPhoneHash`), when the number is known. */
  phoneHash: string | null;
  email: string | null;
  /** The agent said it booked a consultation. Only a claim; but it is what allows the weakest match. */
  claimedBooking: boolean;
}

export type MatchResult =
  | { kind: "matched"; booking: CalBooking; by: "phone" | "email" | "only_candidate" }
  | { kind: "ambiguous"; candidates: CalBooking[] }
  | { kind: "none" };

export function matchWindow(c: Pick<CallFacts, "startedAt" | "endedAt">): { from: Date; to: Date } {
  return { from: new Date(c.startedAt.getTime() - MATCH_BEFORE_MS), to: new Date(c.endedAt.getTime() + MATCH_AFTER_MS) };
}

const lower = (s: string | null) => (s ? s.trim().toLowerCase() : null);

/**
 * Pure and deterministic (hard rule 2): which Cal.com booking belongs to this call.
 * Order: phone hash, then attendee email, then the only candidate in the window. A step that finds exactly one wins; two or more is
 * `ambiguous` (a person decides); none falls through. The last step needs the agent's booking claim, and a candidate whose phone or
 * email contradicts the call is not a candidate at all.
 */
export function matchBooking(call: CallFacts, bookings: CalBooking[]): MatchResult {
  const { from, to } = matchWindow(call);
  const pool = bookings.filter((b) => b.status === "accepted" && !b.claimedByCall && b.createdAt >= from && b.createdAt <= to);
  const decide = (hits: CalBooking[], by: "phone" | "email" | "only_candidate"): MatchResult | null =>
    hits.length === 1 ? { kind: "matched", booking: hits[0]!, by } : hits.length > 1 ? { kind: "ambiguous", candidates: hits } : null;

  if (call.phoneHash) { const r = decide(pool.filter((b) => b.attendeePhoneHash === call.phoneHash), "phone"); if (r) return r; }
  const email = lower(call.email);
  if (email) { const r = decide(pool.filter((b) => lower(b.attendeeEmail) === email), "email"); if (r) return r; }
  if (call.claimedBooking) {
    const compatible = pool.filter((b) => !(b.attendeePhoneHash && call.phoneHash && b.attendeePhoneHash !== call.phoneHash)
      && !(lower(b.attendeeEmail) && email && lower(b.attendeeEmail) !== email));
    const r = decide(compatible, "only_candidate");
    if (r) return r;
  }
  return { kind: "none" };
}
