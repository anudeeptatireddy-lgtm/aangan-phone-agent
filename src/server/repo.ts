import { randomUUID } from "node:crypto";
import { hashPhone, normalizeE164 } from "@/lib/phone";
import type { CallRecord, CallRepo, Caller } from "@/core/repo";

export interface EscalationRecord {
  id: string;
  callerId?: string;
  reason: string;
  mode: string;
  callbackDueAt: string | null;
  alertNikhil: boolean;
  summary?: string;
  createdAt: string;
  slaMinutes?: number;
  queue?: string;
  queueEscalatesTo?: string;
  alertDesignLeadNow?: boolean;
  alertNikhilIfUnackedMin?: number;
}

/** Local-dev / test store. Replaced by Supabase repositories once the schema is approved. */
export class InMemoryRepo implements CallRepo {
  private callers = new Map<string, Caller>(); // by phoneHash
  private calls: CallRecord[] = [];
  escalations: EscalationRecord[] = [];
  webhookEvents: { id: string; type: string; receivedAt: string; status?: string }[] = [];

  constructor(private pepper: string) {}

  upsertCaller(i: { phone: string; name?: string; isExistingClient?: boolean }): Caller {
    const e164 = normalizeE164(i.phone);
    if (!e164) throw new Error("invalid phone");
    const h = hashPhone(e164, this.pepper);
    const prev = this.callers.get(h);
    const c: Caller = { id: prev?.id ?? randomUUID(), phoneHash: h, phoneE164: e164, name: i.name ?? prev?.name,
      isExistingClient: i.isExistingClient ?? prev?.isExistingClient ?? false };
    this.callers.set(h, c);
    return c;
  }
  addCall(c: Omit<CallRecord, "id"> & { id?: string }): CallRecord {
    const rec = { ...c, id: c.id ?? randomUUID() };
    this.calls.push(rec);
    return rec;
  }
  async findCallerByPhone(e164: string) { return this.callers.get(hashPhone(e164, this.pepper)); }
  async listCalls(callerId: string) { return this.calls.filter((c) => c.callerId === callerId); }

  addEscalation(e: Omit<EscalationRecord, "id">): EscalationRecord {
    const rec = { ...e, id: randomUUID() };
    this.escalations.push(rec);
    return rec;
  }
  getEscalation(id: string): EscalationRecord | undefined { return this.escalations.find((e) => e.id === id); }
  updateEscalation(id: string, patch: Partial<EscalationRecord>): EscalationRecord | undefined {
    const e = this.getEscalation(id);
    return e ? Object.assign(e, patch) : undefined;
  }
  /** Idempotent inbox: returns true if the event id was already seen. */
  recordWebhookEvent(id: string, type: string, receivedAt: string): boolean {
    if (this.webhookEvents.some((e) => e.id === id)) return true;
    this.webhookEvents.push({ id, type, receivedAt });
    return false;
  }
  setWebhookStatus(id: string, status: string) { const e = this.webhookEvents.find((x) => x.id === id); if (e) e.status = status; }
  reset() { this.callers.clear(); this.calls = []; this.escalations = []; this.webhookEvents = []; }
}
