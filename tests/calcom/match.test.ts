import { describe, it, expect } from "vitest";
import { matchBooking, matchWindow, MATCH_BEFORE_MS, MATCH_AFTER_MS, SWEEP_AFTER_MS, ORPHAN_AFTER_MS, type CallFacts } from "@/core/calcom/match";
import type { CalBooking } from "@/core/calcom/types";

const d = (s: string) => new Date(s);
const START = d("2026-10-07T06:00:00Z"), END = d("2026-10-07T06:10:00Z");
const call = (o: Partial<CallFacts> = {}): CallFacts => ({ startedAt: START, endedAt: END, phoneHash: "PH-CALL", email: "priya@example.com", claimedBooking: true, ...o });
const bk = (uid: string, o: Partial<CalBooking> = {}): CalBooking => ({ uid, eventTypeId: 7, title: null, status: "accepted", startsAt: d("2026-10-08T05:30:00Z"), endsAt: d("2026-10-08T06:30:00Z"),
  attendeeEmail: null, attendeeName: null, attendeePhoneHash: null, createdAt: d("2026-10-07T06:05:00Z"), claimedByCall: null, ...o });

describe("owner-approved constants", () => {
  it("window is start-2min .. end+10min; sweep is end+15min", () => {
    expect([MATCH_BEFORE_MS, MATCH_AFTER_MS, SWEEP_AFTER_MS]).toEqual([2 * 60_000, 10 * 60_000, 15 * 60_000]);
    expect(ORPHAN_AFTER_MS).toBeGreaterThan(SWEEP_AFTER_MS);
  });
  it("matchWindow", () => {
    expect(matchWindow(call())).toEqual({ from: d("2026-10-07T05:58:00Z"), to: d("2026-10-07T06:20:00Z") });
  });
});

describe("matchBooking: the window", () => {
  it("both edges are inclusive; a second outside is not a candidate", () => {
    const r = (createdAt: string) => matchBooking(call(), [bk("x", { createdAt: d(createdAt) })]);
    expect(r("2026-10-07T05:58:00Z").kind).toBe("matched");
    expect(r("2026-10-07T06:20:00Z").kind).toBe("matched");
    expect(r("2026-10-07T05:57:59Z").kind).toBe("none");
    expect(r("2026-10-07T06:20:01Z").kind).toBe("none");
  });
  it("only accepted, unclaimed bookings count", () => {
    expect(matchBooking(call(), [bk("x", { status: "cancelled" })]).kind).toBe("none");
    expect(matchBooking(call(), [bk("x", { claimedByCall: "other" })]).kind).toBe("none");
  });
});

describe("matchBooking: order phone, then email, then the only candidate", () => {
  it("phone hash wins, even over an email match on another booking", () => {
    const r = matchBooking(call(), [bk("by-email", { attendeeEmail: "priya@example.com" }), bk("by-phone", { attendeePhoneHash: "PH-CALL" })]);
    expect(r).toMatchObject({ kind: "matched", by: "phone", booking: { uid: "by-phone" } });
  });
  it("then email (case-insensitive)", () => {
    const r = matchBooking(call(), [bk("a", { attendeeEmail: "PRIYA@Example.com" }), bk("b", { attendeeEmail: "other@example.com" })]);
    expect(r).toMatchObject({ kind: "matched", by: "email", booking: { uid: "a" } });
  });
  it("then the only candidate, when the call said it booked and nothing contradicts", () => {
    expect(matchBooking(call(), [bk("a")])).toMatchObject({ kind: "matched", by: "only_candidate" });
    expect(matchBooking(call(), [bk("a", { attendeePhoneHash: "PH-CALL" })])).toMatchObject({ by: "phone" });
  });
  it("the only-candidate match needs the agent's claim: a call that booked nothing never takes someone else's booking", () => {
    expect(matchBooking(call({ claimedBooking: false }), [bk("a")]).kind).toBe("none");
    expect(matchBooking(call({ claimedBooking: false }), [bk("a", { attendeePhoneHash: "PH-CALL" })]).kind).toBe("matched");
  });
  it("the only candidate must not conflict: a different phone or a different email disqualifies it", () => {
    expect(matchBooking(call(), [bk("a", { attendeePhoneHash: "PH-OTHER" })]).kind).toBe("none");
    expect(matchBooking(call(), [bk("a", { attendeeEmail: "someone.else@example.com" })]).kind).toBe("none");
    expect(matchBooking(call({ email: null }), [bk("a", { attendeeEmail: "someone.else@example.com" })]).kind).toBe("matched"); // nothing known to contradict
    expect(matchBooking(call({ phoneHash: null }), [bk("a", { attendeePhoneHash: "PH-OTHER" })]).kind).toBe("matched");
  });
  it("a conflicting booking is not counted as a rival: the one compatible candidate still wins", () => {
    const r = matchBooking(call(), [bk("mine"), bk("theirs", { attendeePhoneHash: "PH-OTHER" })]);
    expect(r).toMatchObject({ kind: "matched", by: "only_candidate", booking: { uid: "mine" } });
  });
});

describe("matchBooking: ambiguity (2 or more) is never guessed", () => {
  it("two bookings with the caller's phone", () => {
    const r = matchBooking(call(), [bk("a", { attendeePhoneHash: "PH-CALL" }), bk("b", { attendeePhoneHash: "PH-CALL" })]);
    expect(r).toMatchObject({ kind: "ambiguous" });
    if (r.kind === "ambiguous") expect(r.candidates.map((x) => x.uid).sort()).toEqual(["a", "b"]);
  });
  it("two bookings with the caller's email, and none with the phone", () => {
    expect(matchBooking(call(), [bk("a", { attendeeEmail: "priya@example.com" }), bk("b", { attendeeEmail: "priya@example.com" })]).kind).toBe("ambiguous");
  });
  it("two compatible candidates and no identifying detail", () => {
    expect(matchBooking(call(), [bk("a"), bk("b")]).kind).toBe("ambiguous");
  });
  it("nothing in the window is simply 'none'", () => {
    expect(matchBooking(call(), [])).toEqual({ kind: "none" });
  });
});
