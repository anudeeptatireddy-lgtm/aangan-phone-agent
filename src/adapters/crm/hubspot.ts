import type { CrmContact, CrmPort, DealSnapshot, StageInfo } from "@/core/ports";

// Endpoints and bodies verified against developers.hubspot.com (docs/vendor-findings-s5.md): contacts batch upsert by email,
// deals create with an inline association (HUBSPOT_DEFINED type 3 = deal to contact). The deal NEVER carries an amount.
export interface HubSpotOptions {
  token: string;
  pipelineId?: string;
  dealStageId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const BASE = "https://api.hubapi.com";

export class HubSpotCrm implements CrmPort {
  private fetchImpl: typeof fetch;
  constructor(private o: HubSpotOptions) {
    if (!o.token) throw new Error("HubSpotCrm needs an access token");
    this.fetchImpl = o.fetch ?? fetch;
  }

  private post<T>(path: string, body: unknown): Promise<T> { return this.request<T>("POST", path, body); }

  /** Error text from HubSpot may echo what we sent (emails, phone numbers): keep only the status and category. */
  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 15_000);
    try {
      const res = await this.fetchImpl(`${BASE}${path}`, {
        method, headers: { authorization: `Bearer ${this.o.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: ctl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as { category?: string } & T;
      if (!res.ok) throw new Error(`hubspot ${path} failed: ${res.status}${json.category ? ` ${json.category}` : ""}`);
      return json;
    } catch (e) {
      const m = (e as Error).message.split(this.o.token).join("[token]");
      throw new Error(m.startsWith("hubspot ") ? m : `hubspot ${path} network error: ${m.slice(0, 120)}`);
    } finally { clearTimeout(timer); }
  }

  private contactProps(c: CrmContact) {
    const p: Record<string, string> = {};
    if (c.email) p.email = c.email;
    if (c.phone) p.phone = c.phone;
    if (c.firstName) p.firstname = c.firstName;
    if (c.lastName) p.lastname = c.lastName;
    return p;
  }

  async createDealForEnquiry(i: { contact: CrmContact; deal: { name: string; description: string } }) {
    if (!this.o.pipelineId || !this.o.dealStageId) throw new Error("HubSpot is not configured: HUBSPOT_PIPELINE_ID and HUBSPOT_DEAL_STAGE_ID are required");
    const props = this.contactProps(i.contact);
    let contactId: string | undefined;
    if (i.contact.email) {
      const r = await this.post<{ results?: { id?: string }[] }>("/crm/v3/objects/contacts/batch/upsert", { inputs: [{ id: i.contact.email, idProperty: "email", properties: props }] });
      contactId = r.results?.[0]?.id;
    } else {
      contactId = (await this.post<{ id?: string }>("/crm/v3/objects/contacts", { properties: props })).id;
    }
    if (!contactId) throw new Error("hubspot: contact response had no id");

    const deal = await this.post<{ id?: string }>("/crm/v3/objects/deals", {
      properties: { dealname: i.deal.name, description: i.deal.description, pipeline: this.o.pipelineId, dealstage: this.o.dealStageId },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
    });
    if (!deal.id) throw new Error("hubspot: deal response had no id");
    return { dealId: deal.id, contactId };
  }

  // ---- reading back what the designers did (docs: developers.hubspot.com, deals batch read and pipelines; the response is HubSpot's standard v3 object list) ----
  async readDeals(dealIds: string[]): Promise<{ deals: DealSnapshot[]; missing: string[] }> {
    const deals: DealSnapshot[] = [];
    for (let i = 0; i < dealIds.length; i += 50) {
      const chunk = dealIds.slice(i, i + 50);
      const r = await this.post<{ results?: { id?: string; properties?: Record<string, string | null> }[] }>("/crm/v3/objects/deals/batch/read",
        { properties: ["dealstage", "pipeline", "amount", "deal_currency_code"], inputs: chunk.map((id) => ({ id })) }); // 200 or 207: the deals that were read are in `results`
      for (const x of r.results ?? []) {
        if (!x.id) continue;
        const p = x.properties ?? {};
        const n = p.amount === null || p.amount === undefined || String(p.amount).trim() === "" ? NaN : Number(p.amount);
        deals.push({ dealId: x.id, pipelineId: p.pipeline ?? null, stageId: p.dealstage ?? null, amount: Number.isFinite(n) ? n : null, currency: p.deal_currency_code || null });
      }
    }
    const got = new Set(deals.map((d) => d.dealId));
    return { deals, missing: dealIds.filter((id) => !got.has(id)) };
  }

  async dealStages(pipelineId: string): Promise<StageInfo[]> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(pipelineId)) throw new Error("hubspot: invalid pipeline id");
    const r = await this.request<{ results?: { id?: string; stageId?: string; label?: string; metadata?: { isClosed?: string | boolean; probability?: string | number } }[] }>("GET", `/crm/v3/pipelines/deals/${pipelineId}/stages`);
    return (r.results ?? []).flatMap((s) => {
      const id = s.id ?? s.stageId; // the docs show both names
      if (!id) return [];
      const prob = s.metadata?.probability === undefined ? NaN : Number(s.metadata.probability);
      const closed = s.metadata?.isClosed === undefined ? null : String(s.metadata.isClosed) === "true";
      return [{ id, label: s.label ?? id, closed, probability: Number.isFinite(prob) ? prob : null }];
    });
  }

  async dealPipelines(): Promise<{ id: string; label: string }[]> {
    const r = await this.request<{ results?: { id?: string; label?: string }[] }>("GET", "/crm/v3/pipelines/deals");
    return (r.results ?? []).flatMap((p) => (p.id ? [{ id: p.id, label: p.label ?? p.id }] : []));
  }
}
