import type { CrmContact, CrmPort } from "@/core/ports";

/** In-memory HubSpot stand-in: contacts are upserted by email, deals carry no amount. */
export class FakeCrm implements CrmPort {
  contacts = new Map<string, CrmContact & { id: string }>();
  deals: { id: string; name: string; description: string; contactId: string }[] = [];
  private fail: Error | null = null;
  private n = 0;
  failNext(message = "fake hubspot failure") { this.fail = new Error(message); }

  async createDealForEnquiry(i: { contact: CrmContact; deal: { name: string; description: string } }) {
    if (this.fail) { const e = this.fail; this.fail = null; throw e; }
    const key = i.contact.email ?? `anon-${++this.n}`;
    const existing = this.contacts.get(key);
    const contact = existing ?? { ...i.contact, id: `c${++this.n}` };
    this.contacts.set(key, { ...contact, ...i.contact, id: contact.id });
    const deal = { id: `d${++this.n}`, name: i.deal.name, description: i.deal.description, contactId: contact.id };
    this.deals.push(deal);
    return { dealId: deal.id, contactId: contact.id };
  }
}
