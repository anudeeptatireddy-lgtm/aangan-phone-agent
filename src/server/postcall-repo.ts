import { randomUUID } from "node:crypto";
import { hashPhone } from "@/lib/phone";
import type { CostRow } from "@/core/postcall/costs";
import type {
  CallPatch, CallRow, EnquiryRow, EnquiryUpsert, EscalationInput, EscalationRow, EvaluationInput, EvaluationRow, FlagInput, FlagRow, OutboxKind, OutboxRow, PostCallRepo,
} from "@/core/postcall/repo";

const blankCall = (id: string, vendorCallId: string): CallRow => ({
  id, vendorCallId, callerId: null, enquiryId: null, parentCallId: null, rangAt: null, answeredAt: null, endedAt: null, durationS: null, afterHours: null, intent: null,
  outcome: null, endedReason: null, disclosureOk: null, recordingRef: null, recordingExpiresAt: null, transcript: null, summary: null, postCallStatus: "pending",
  processedAt: null, costAiInr: null, costVoiceInr: null, costTotalInr: null,
});

/** Local-dev / test store: same behaviour as the Postgres implementation (one shared contract suite). */
export class InMemoryPostCallRepo implements PostCallRepo {
  calls = new Map<string, CallRow>();
  enquiries = new Map<string, EnquiryRow>();
  evaluations: (EvaluationRow & { vendorCallId: string })[] = [];
  flags: (FlagRow & { vendorCallId: string })[] = [];
  costs: { vendorCallId: string; rows: CostRow[]; at: Date }[] = [];
  escalations: (EscalationRow & { vendorCallId: string })[] = [];
  outbox = new Map<string, OutboxRow>();
  private callers = new Map<string, { id: string; phone: string; name?: string; email?: string; language?: string }>();
  private crmLinks = new Map<string, { contactId: string; dealId: string }>();
  private seq = 0;

  constructor(private pepper: string) {}

  async upsertCaller(i: { phone: string; name?: string; email?: string; language?: string }) {
    const h = hashPhone(i.phone, this.pepper);
    const cur = this.callers.get(h);
    const next = { id: cur?.id ?? randomUUID(), phone: i.phone, name: i.name ?? cur?.name, email: i.email ?? cur?.email, language: i.language ?? cur?.language };
    this.callers.set(h, next);
    return { id: next.id };
  }
  async updateCaller(callerId: string, patch: { name?: string; email?: string; language?: string }) {
    const c = this.callerById(callerId);
    if (c) Object.assign(c, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  }
  async callerContact(callerId: string) { const c = this.callerById(callerId); return c ? { phone: c.phone, name: c.name ?? null, email: c.email ?? null } : null; }
  async getCrmLink(enquiryId: string) { return this.crmLinks.get(enquiryId) ?? null; }
  async saveCrmLink(enquiryId: string, link: { contactId: string; dealId: string }) { if (!this.crmLinks.has(enquiryId)) this.crmLinks.set(enquiryId, link); }
  callerById(id: string) { return [...this.callers.values()].find((c) => c.id === id); }

  async upsertCall(vendorCallId: string, patch: CallPatch) {
    const cur = this.calls.get(vendorCallId) ?? blankCall(randomUUID(), vendorCallId);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (cur as unknown as Record<string, unknown>)[k] = v;
    this.calls.set(vendorCallId, cur);
    return { ...cur };
  }
  async getCall(vendorCallId: string) { const c = this.calls.get(vendorCallId); return c ? { ...c } : null; }
  async recentCallsForCaller(callerId: string, since: Date) {
    return [...this.calls.values()].filter((c) => c.callerId === callerId && c.endedAt && c.endedAt >= since)
      .sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime()).map((c) => ({ ...c }));
  }

  async upsertEnquiry(e: EnquiryUpsert) {
    const id = e.id ?? randomUUID();
    const row: EnquiryRow = {
      id, callerId: e.callerId ?? null, channel: e.channel ?? "phone", input: e.input, fit: e.fit, reasonCodes: e.reasonCodes, missingFields: e.missingFields ?? [],
      nextAction: e.nextAction ?? null, flags: e.flags, ruleVersion: e.ruleVersion, language: e.language ?? null, currentState: e.currentState ?? null,
      sourceHeard: e.sourceHeard ?? null, timelineRaw: e.timelineRaw ?? null, designerNote: e.designerNote ?? null,
    };
    this.enquiries.set(id, row);
    return { ...row };
  }
  async getEnquiry(id: string) { const e = this.enquiries.get(id); return e ? { ...e } : null; }

  async recordEvaluation(e: EvaluationInput) {
    this.evaluations.push({ vendorCallId: e.vendorCallId, phase: e.phase, fit: e.fit, reasonCodes: e.reasonCodes, ruleVersion: e.ruleVersion, evaluatedAt: new Date(Date.now() + ++this.seq), enquiryId: e.enquiryId ?? null });
  }
  async latestEvaluation(vendorCallId: string, phase: "live" | "post_call") {
    const m = this.evaluations.filter((x) => x.vendorCallId === vendorCallId && x.phase === phase);
    const last = m[m.length - 1];
    if (!last) return null;
    const { vendorCallId: _v, ...row } = last;
    return row;
  }

  async addFlag(f: FlagInput) {
    const row = { id: randomUUID(), kind: f.kind, severity: f.severity ?? "high", evidence: f.evidence ?? null, detectedBy: f.detectedBy, vendorCallId: f.vendorCallId };
    this.flags.push(row);
    const { vendorCallId: _v, ...out } = row;
    return out;
  }
  async listFlags(vendorCallId: string) { return this.flags.filter((x) => x.vendorCallId === vendorCallId).map(({ vendorCallId: _v, ...r }) => r); }

  async addUsageCosts(vendorCallId: string, rows: CostRow[], at: Date) { this.costs.push({ vendorCallId, rows, at }); }

  async recordEscalation(vendorCallId: string, e: EscalationInput) {
    this.escalations.push({ vendorCallId, reason: e.reason, mode: e.mode, callbackDueAt: e.callbackDueAt ?? null, slaMinutes: e.slaMinutes ?? null });
  }
  async escalationsForCall(vendorCallId: string) { return this.escalations.filter((x) => x.vendorCallId === vendorCallId).map(({ vendorCallId: _v, ...r }) => r); }

  async enqueue(kind: OutboxKind, payload: Record<string, unknown>, dedupeKey: string) {
    if (this.outbox.has(dedupeKey)) return false;
    this.outbox.set(dedupeKey, { id: randomUUID(), kind, payload, dedupeKey, status: "pending", attempts: 0 });
    return true;
  }
  async pendingOutbox(kinds: OutboxKind[], limit: number) { return [...this.outbox.values()].filter((o) => o.status === "pending" && kinds.includes(o.kind)).slice(0, limit).map((o) => ({ ...o })); }
  async markOutbox(id: string, status: "processed" | "failed" | "pending") {
    const o = [...this.outbox.values()].find((x) => x.id === id);
    if (o) { o.status = status; o.attempts += 1; }
  }
}
