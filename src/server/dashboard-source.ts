import type { DashboardSource } from "@/core/dashboard/source";
import type { DashRows } from "@/core/dashboard/summary";
import type { InMemoryBookingRepo } from "./booking-repo";
import type { InMemoryPostCallRepo } from "./postcall-repo";

/** Dev/test source over the in-memory stores. */
export class InMemoryDashboardSource implements DashboardSource {
  constructor(private pc: InMemoryPostCallRepo, private bk: InMemoryBookingRepo) {}
  async fetchRows(from: Date, to: Date): Promise<DashRows> {
    const calls = [...this.pc.calls.values()].filter((c) => { const t = c.rangAt ?? c.endedAt; return !!t && t >= from && t < to; });
    const ids = new Set(calls.map((c) => c.vendorCallId));
    const enqIds = new Set(calls.map((c) => c.enquiryId).filter((x): x is string => !!x));
    return {
      calls: calls.map((c) => ({ rangAt: c.rangAt, durationS: c.durationS, outcome: c.outcome, afterHours: c.afterHours, costAiInr: c.costAiInr, costVoiceInr: c.costVoiceInr, costTotalInr: c.costTotalInr, postCallStatus: c.postCallStatus })),
      enquiries: [...enqIds].map((id) => ({ fit: this.pc.enquiries.get(id)?.fit ?? null })),
      handoffs: this.bk.handoffs.filter((h) => h.dueAt >= from && h.dueAt < to).map((h) => ({ status: h.status })),
      flags: this.pc.flags.filter((f) => ids.has(f.vendorCallId)).map((f) => ({ kind: f.kind, resolved: false })),
    };
  }
}
