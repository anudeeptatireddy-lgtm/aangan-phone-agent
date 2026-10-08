import type { CrmContact, CrmPort, DealSnapshot, StageInfo } from "@/core/ports";

/** In-memory HubSpot stand-in: contacts are upserted by email, deals carry no amount. */
export class FakeCrm implements CrmPort {
  contacts = new Map<string, CrmContact & { id: string }>();
  deals: { id: string; name: string; description: string; contactId: string }[] = [];
  private fail: Error | null = null;
  private failRead: Error | null = null;
  private n = 0;
  private snaps = new Map<string, DealSnapshot>();
  private stageLists = new Map<string, StageInfo[]>();
  /** Every readDeals call's list of ids, and how many times the stage list was asked for (tests). */
  reads: string[][] = [];
  stageLookups = 0;
  constructor(private o: { startStageId?: string; pipelineId?: string } = {}) {}
  failNextRead(message = "fake hubspot read failure") { this.failRead = new Error(message); }
  setStages(pipelineId: string, stages: StageInfo[]) { this.stageLists.set(pipelineId, stages); }
  /** What a designer did in HubSpot: move the deal, set or clear the amount (a string, as HubSpot sends it), change the currency. */
  setDeal(dealId: string, p: { stageId?: string; amount?: string | number | null; currency?: string | null }) {
    const cur = this.snaps.get(dealId); if (!cur) throw new Error(`no such deal ${dealId}`);
    this.snaps.set(dealId, { ...cur, ...(p.stageId !== undefined ? { stageId: p.stageId } : {}), ...(p.amount !== undefined ? { amount: p.amount === null ? null : Number(p.amount) } : {}), ...(p.currency !== undefined ? { currency: p.currency } : {}) });
  }
  /** Tests: a deal that exists in HubSpot but was not created through this fake. */
  setDealRaw(d: DealSnapshot) { this.snaps.set(d.dealId, d); }
  removeDeal(dealId: string) { this.snaps.delete(dealId); }
  failNext(message = "fake hubspot failure") { this.fail = new Error(message); }

  async createDealForEnquiry(i: { contact: CrmContact; deal: { name: string; description: string } }) {
    if (this.fail) { const e = this.fail; this.fail = null; throw e; }
    const key = i.contact.email ?? `anon-${++this.n}`;
    const existing = this.contacts.get(key);
    const contact = existing ?? { ...i.contact, id: `c${++this.n}` };
    this.contacts.set(key, { ...contact, ...i.contact, id: contact.id });
    const deal = { id: `d${++this.n}`, name: i.deal.name, description: i.deal.description, contactId: contact.id };
    this.deals.push(deal);
    this.snaps.set(deal.id, { dealId: deal.id, pipelineId: this.o.pipelineId ?? null, stageId: this.o.startStageId ?? null, amount: null, currency: null });
    return { dealId: deal.id, contactId: contact.id };
  }

  async readDeals(ids: string[]) {
    if (this.failRead) { const e = this.failRead; this.failRead = null; throw e; }
    this.reads.push([...ids]);
    const deals = ids.flatMap((id) => (this.snaps.has(id) ? [{ ...this.snaps.get(id)! }] : []));
    return { deals, missing: ids.filter((id) => !this.snaps.has(id)) };
  }
  async dealStages(pipelineId: string) { this.stageLookups++; return [...(this.stageLists.get(pipelineId) ?? [])]; }
  async dealPipelines() { return [...this.stageLists.keys()].map((id) => ({ id, label: id })); }
}
