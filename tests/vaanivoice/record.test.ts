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
