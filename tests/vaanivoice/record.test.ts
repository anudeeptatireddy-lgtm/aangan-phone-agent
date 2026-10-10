import { describe, it, expect } from "vitest";
import { buildCallRecord, parseVaaniVoiceEvent } from "@/adapters/voice/vaanivoice/record";

const details = { transcription: "AGENT: Namaste, Aangan Studio.\n\n USER: Hi, 3BHK in Kothrud.\n\n AGENT: Thanks.", entity: { booked_consultation: "yes", booked_time: "Thursday 11 am", wants_person: "no" }, summary: "A 3BHK enquiry." };
const history = { call_id: "c1", call_type: "Inbound", direction: "Incoming", from_number: "+919876543210", to_number: "+911234567890", Start_time: "2026-10-07T05:00:00Z", End_time: "2026-10-07T05:05:00Z", duration_ms: 300_000, recording_api: "https://api.vaanivoice.ai/api/stream/c1" };
const base = { callId: "c1", details, history, eventTimestamp: "2026-10-07T05:05:30Z", ratePerMinInr: 5.31 };

describe("buildCallRecord", () => {
  it("maps details + history into a vendor-neutral call record", () => {
    const r = buildCallRecord(base);
    expect(r).toMatchObject({ vendor: "vaanivoice", vendorCallId: "c1", callerPhone: "+919876543210", rangAt: "2026-10-07T05:00:00.000Z", endedAt: "2026-10-07T05:05:00.000Z", durationS: 300,
      endedReason: "completed", recordingRef: "https://api.vaanivoice.ai/api/stream/c1", vendorSummary: "A 3BHK enquiry." });
    expect(r.transcript).toHaveLength(3);
    expect(r.voiceRateInrPerMin).toBe(5.31);
    expect(r.voiceCostInr).toBe(26.55);                                    // 5 min x 5.31
    expect(r.signals).toEqual({ wantsPerson: false, claimedBooking: true, claimedBookingTime: "Thursday 11 am" });
  });
  it("the caller number is taken only from inbound calls (an outbound call's from-number is ours)", () => {
    expect(buildCallRecord({ ...base, history: { ...history, direction: "Outbound", call_type: "Outbound" } }).callerPhone).toBeUndefined();
    expect(buildCallRecord({ ...base, history: { ...history, from_number: "not-a-number" } }).callerPhone).toBeUndefined();
    expect(buildCallRecord({ ...base, history: undefined }).callerPhone).toBeUndefined();
  });
  it("without history: end time from the event, duration unknown, no cost estimate", () => {
    const r = buildCallRecord({ ...base, history: undefined });
    expect(r.endedAt).toBe("2026-10-07T05:05:30.000Z");
    expect(r.durationS).toBeUndefined();
    expect(r.voiceCostInr).toBeUndefined();
  });
  it("without history but with a conversation, the call counts as answered (at its end) and no start time is invented", () => {
    const r = buildCallRecord({ ...base, history: undefined });
    expect(r.answeredAt).toBe("2026-10-07T05:05:30.000Z");
    expect(r.rangAt).toBeUndefined();
    const silent = buildCallRecord({ ...base, history: undefined, details: { ...details, transcription: "" } });
    expect(silent.answeredAt).toBeUndefined(); // nothing was said by anyone: not claimed as answered
  });
  it("a call where the caller never spoke is 'dropped'", () => {
    const r = buildCallRecord({ ...base, details: { ...details, transcription: "AGENT: Namaste, Aangan Studio." } });
    expect(r.endedReason).toBe("dropped");
  });
});

describe("parseVaaniVoiceEvent", () => {
  it("reads the documented call_postprocessing shape (data.call_id) and the flat shape", () => {
    expect(parseVaaniVoiceEvent({ event: "call_postprocessing", room_name: "room-1", status: "done", data: { call_id: "c1", timestamp: "2026-10-07T05:05:30Z", recording_url: "u" } }))
      .toEqual({ event: "call_postprocessing", callId: "c1", timestamp: "2026-10-07T05:05:30Z" });
    expect(parseVaaniVoiceEvent({ event: "call_postprocessing", call_id: "c2" })).toMatchObject({ callId: "c2" });
  });
  it("falls back to room_name when no call id is present", () => {
    expect(parseVaaniVoiceEvent({ event: "call_ended", room_name: "room-9", call_duration: 12 })).toMatchObject({ event: "call_ended", callId: "room-9" });
  });
  it("rejects non-objects and bodies without an event", () => {
    expect(parseVaaniVoiceEvent(null)).toBeNull();
    expect(parseVaaniVoiceEvent("x")).toBeNull();
    expect(parseVaaniVoiceEvent({ foo: 1 })).toBeNull();
  });
});

describe("without call history, the call's real start and end come from the transcript's own [hh:mm:ss] stamps (UTC)", () => {
  const details = (t: string) => ({ transcription: t, entity: {}, summary: "" });
  const t = "[09:48:43] AGENT: Namaste.\n[09:48:51] USER: Hi.\n[09:52:05] AGENT: Goodbye.";
  it("start, end and duration are the first and last stamp, on the day the webhook arrived", () => {
    const r = buildCallRecord({ callId: "x", details: details(t), now: new Date("2026-10-10T09:56:00Z"), ratePerMinInr: 5.31 });
    expect(r.rangAt).toBe("2026-10-10T09:48:43.000Z");
    expect(r.endedAt).toBe("2026-10-10T09:52:05.000Z");
    expect(r.durationS).toBe(202);
    expect(r.voiceCostInr).toBeCloseTo(17.88, 1);
  });
  it("a call that ran past midnight UTC is placed on the previous day", () => {
    const r = buildCallRecord({ callId: "x", details: details("[23:58:00] AGENT: Hi.\n[23:59:40] USER: Hi."), now: new Date("2026-10-11T00:01:00Z") });
    expect(r.endedAt).toBe("2026-10-10T23:59:40.000Z");
  });
  it("real history always wins over the stamps, and a transcript without stamps keeps the old behaviour", () => {
    const h = { Start_time: "2026-10-10T09:00:00Z", End_time: "2026-10-10T09:05:00Z" } as never;
    expect(buildCallRecord({ callId: "x", details: details(t), history: h, now: new Date("2026-10-10T09:56:00Z") }).rangAt).toBe("2026-10-10T09:00:00.000Z");
    const plain = buildCallRecord({ callId: "x", details: details("AGENT: Hi.\n\nUSER: Hello."), now: new Date("2026-10-10T09:56:00Z") });
    expect(plain.endedAt).toBe("2026-10-10T09:56:00.000Z"); expect(plain.rangAt).toBeUndefined();
  });
});

