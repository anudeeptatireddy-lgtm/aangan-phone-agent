import type { CrmContact, CrmPort } from "@/core/ports";

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

  /** Error text from HubSpot may echo what we sent (emails, phone numbers): keep only the status and category. */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 15_000);
    try {
      const res = await this.fetchImpl(`${BASE}${path}`, {
        method: "POST", headers: { authorization: `Bearer ${this.o.token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal,
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
}
