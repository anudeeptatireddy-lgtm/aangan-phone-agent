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
}
