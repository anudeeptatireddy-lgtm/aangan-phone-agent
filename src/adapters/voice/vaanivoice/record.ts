import type { CallRecordInput } from "@/core/postcall/types";
import { bookingClaim } from "./entities";
import type { VaaniCallDetails, VaaniHistoryRow } from "./client";
import { parseTranscription } from "./transcript";

const E164 = /^\+\d{8,15}$/;

export function buildCallRecord(i: { callId: string; details: VaaniCallDetails; history?: VaaniHistoryRow | null; eventTimestamp?: string; ratePerMinInr?: number; now?: Date }): CallRecordInput {
  const turns = parseTranscription(i.details.transcription);
  const h = i.history ?? undefined;
  const iso = (v?: string) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined; };
  const started = iso(h?.Start_time);
  const ended = iso(h?.End_time) ?? iso(i.eventTimestamp) ?? (i.now ?? new Date()).toISOString();
  const durationS = typeof h?.duration_ms === "number" ? Math.round(h.duration_ms / 1000)
    : started ? Math.max(0, Math.round((Date.parse(ended) - Date.parse(started)) / 1000)) : undefined;
  const inbound = /^(in|incoming)/i.test(h?.direction ?? "") || /^inbound$/i.test(h?.call_type ?? "");
  const claim = bookingClaim(i.details.entity);
  return {
    vendor: "vaanivoice", vendorCallId: i.callId,
    callerPhone: inbound && h?.from_number && E164.test(h.from_number) ? h.from_number : undefined,
    rangAt: started, answeredAt: started ?? (turns.length ? ended : undefined), endedAt: ended, durationS, // no history: a conversation means it was answered; the start time stays unknown
    endedReason: turns.some((t) => t.speaker === "caller") ? "completed" : "dropped",
    transcript: turns, recordingRef: h?.recording_api, vendorSummary: i.details.summary || undefined,
    voiceRateInrPerMin: durationS !== undefined ? i.ratePerMinInr : undefined,
    // The vendor's cost field ("credits") has no documented unit, so this is an ESTIMATE from the dashboard's per-minute rate.
    voiceCostInr: durationS !== undefined && i.ratePerMinInr !== undefined ? Math.round((durationS / 60) * i.ratePerMinInr * 100) / 100 : undefined,
    vendorEntities: i.details.entity,
    signals: { wantsPerson: claim.wantsPerson, claimedBooking: claim.booked, claimedBookingTime: claim.time ?? undefined },
  };
}

export interface VaaniVoiceEvent { event: string; callId: string; timestamp?: string }

/** Defensive: the docs list event names and some fields but no complete sample. A call id is `data.call_id`, `call_id`, or `room_name`. */
export function parseVaaniVoiceEvent(body: unknown): VaaniVoiceEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const data = typeof b.data === "object" && b.data !== null ? (b.data as Record<string, unknown>) : {};
  const event = typeof b.event === "string" ? b.event : null;
  const callId = [data.call_id, b.call_id, b.room_name].find((x): x is string => typeof x === "string" && x.length > 0);
  if (!event || !callId) return null;
  const ts = [data.timestamp, b.timestamp].find((x): x is string => typeof x === "string");
  return { event, callId, ...(ts ? { timestamp: ts } : {}) };
}
