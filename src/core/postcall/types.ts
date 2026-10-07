// Vendor-neutral record of a finished call. The Vaani adapter will map its (still undocumented) end-of-call payload to this;
// tests, the simulator and the replay harness feed it directly.
export interface CallTurn {
  speaker: "agent" | "caller";
  text: string;
  atMs?: number;
}

export interface CallRecordInput {
  vendor: string;                // 'vaani' | 'fake'
  vendorCallId: string;
  callerPhone?: string;          // E.164 when available (vendor webhooks mask it; tool calls carry the real one)
  rangAt?: string;               // ISO
  answeredAt?: string;           // ISO
  endedAt: string;               // ISO
  durationS?: number;
  endedReason?: string;          // 'completed' | 'dropped' | 'failed' | 'missed' | ...
  transcript: CallTurn[];
  recordingRef?: string;
  language?: string;
  /** Vendor's own one-paragraph summary, used when no model extraction is available. */
  vendorSummary?: string;
  /** Estimated voice-platform cost of the call in INR (the vendor does not document its cost field). */
  voiceCostInr?: number;
  /** The per-minute rate that estimate used (so the cost ledger can show minutes x rate). */
  voiceRateInrPerMin?: number;
  /** The vendor's own extracted fields, exactly as it reported them (merged into the extraction by the vendor adapter's `refine`). Never persisted. */
  vendorEntities?: unknown;
  /** Signals the vendor's own extraction picked up (routing hints; the scans still run on the transcript). */
  signals?: { wantsPerson?: boolean; claimedBooking?: boolean; claimedBookingTime?: string };
}
