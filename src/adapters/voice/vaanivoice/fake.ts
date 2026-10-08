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
  /** Vaani's call-history endpoint is down (as it is, for this account, on 2026-10-08: HTTP 500 "Invalid client_id format"); call_details still works. */
  historyDown(message = "vaanivoice call-history failed: 500") { this.historyError = message; }
  historyUp() { this.historyError = null; }
  private historyError: string | null = null;
  /** Vaani answers this call again. */
  heal(callId: string) { this.broken.delete(callId); }

  async getCallDetails(callId: string) {
    this.fetched.push(callId);
    const bad = this.broken.get(callId);
    if (bad) throw new Error(bad);
    const c = this.calls.get(callId);
    if (!c) throw new Error("vaanivoice call_details failed: 404");
    return c.details;
  }
  async findInHistory(callId: string) {
    if (this.historyError) throw new Error(this.historyError);
    const bad = this.broken.get(callId);
    if (bad) throw new Error(bad);
    return this.calls.get(callId)?.history ?? null;
  }

  async recentCalls(since: Date) {
    if (this.historyError) throw new Error(this.historyError);
    return [...this.calls.values()].map((c) => c.history).filter((h): h is VaaniHistoryRow => !!h && Date.parse(h.Start_time ?? "") >= since.getTime());
  }
}
