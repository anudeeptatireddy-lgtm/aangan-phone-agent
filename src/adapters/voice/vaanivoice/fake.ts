import type { VaaniCallDetails, VaaniHistoryRow, VaaniVoicePort } from "./client";

/** In-memory stand-in for Vaani's call_details / call-history (dev, tests, the simulator). Records every id it was asked about. */
export class FakeVaaniVoiceClient implements VaaniVoicePort {
  private calls = new Map<string, { details: VaaniCallDetails | null; history: VaaniHistoryRow | null }>();
  private broken = new Map<string, string>();
  fetched: string[] = [];

  set(callId: string, v: { details: Omit<VaaniCallDetails, "callEvalTag"> | null; history?: Partial<VaaniHistoryRow> | null }) {
    this.calls.set(callId, { details: v.details ? { ...v.details } : null, history: v.history ? { call_id: callId, ...v.history } : null });
  }
  /** The next lookups of this call fail with this message (as when Vaani answers 5xx). */
  fail(callId: string, message = "vaanivoice call_details failed: 500") { this.broken.set(callId, message); }

  async getCallDetails(callId: string) {
    this.fetched.push(callId);
    const bad = this.broken.get(callId);
    if (bad) throw new Error(bad);
    const c = this.calls.get(callId);
    if (!c) throw new Error("vaanivoice call_details failed: 404");
    return c.details;
  }
  async findInHistory(callId: string) {
    const bad = this.broken.get(callId);
    if (bad) throw new Error(bad);
    return this.calls.get(callId)?.history ?? null;
  }
}
