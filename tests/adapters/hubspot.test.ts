import { describe, it, expect } from "vitest";
import { HubSpotCrm } from "@/adapters/crm/hubspot";

const TOKEN = "pat-na2-secret-token-value";
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
function make(responses: Response[], o: { pipelineId?: string; dealStageId?: string } = { pipelineId: "p1", dealStageId: "s1" }) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    return r;
  }) as unknown as typeof fetch;
  return { crm: new HubSpotCrm({ token: TOKEN, ...o, fetch: f }), calls };
}
const input = { contact: { email: "p@example.com", phone: "+919000000011", firstName: "Priya", lastName: "Shah" }, deal: { name: "Kothrud 3BHK · Priya Shah", description: "NEW CONSULTATION" } };

describe("HubSpotCrm", () => {
  it("upserts the contact by email, then creates the deal associated to it (type 3), with no amount", async () => {
    const { crm, calls } = make([res(200, { status: "COMPLETE", results: [{ id: "501" }] }), res(201, { id: "901" })]);
    expect(await crm.createDealForEnquiry(input)).toEqual({ contactId: "501", dealId: "901" });
    expect(calls[0]).toMatchObject({ url: "https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert", method: "POST" });
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.body).toEqual({ inputs: [{ id: "p@example.com", idProperty: "email", properties: { email: "p@example.com", phone: "+919000000011", firstname: "Priya", lastname: "Shah" } }] });
    expect(calls[1]!.url).toBe("https://api.hubapi.com/crm/v3/objects/deals");
    expect(calls[1]!.body).toEqual({
      properties: { dealname: "Kothrud 3BHK · Priya Shah", description: "NEW CONSULTATION", pipeline: "p1", dealstage: "s1" },
      associations: [{ to: { id: "501" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }],
    });
    expect(JSON.stringify(calls[1]!.body)).not.toMatch(/amount/i);
  });
  it("without an email the contact is created (not upserted)", async () => {
    const { crm, calls } = make([res(201, { id: "502" }), res(201, { id: "902" })]);
    await crm.createDealForEnquiry({ ...input, contact: { phone: "+919000000011", firstName: "Priya" } });
    expect(calls[0]!.url).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
    expect(calls[0]!.body).toEqual({ properties: { phone: "+919000000011", firstname: "Priya" } });
  });
  it("fails closed when the pipeline or stage id is not configured: no request is made", async () => {
    const { crm, calls } = make([], { pipelineId: "p1" });
    await expect(crm.createDealForEnquiry(input)).rejects.toThrow(/not configured/i);
    expect(calls).toHaveLength(0);
  });
  it("a missing-scope 403 gives a clear error that names the status but not the token or the caller's details", async () => {
    const { crm } = make([res(403, { status: "error", category: "MISSING_SCOPES", message: `scope missing for ${TOKEN} p@example.com` })]);
    const e = await crm.createDealForEnquiry(input).then(() => new Error("no error"), (x) => x as Error);
    expect(e.message).toMatch(/403/);
    expect(e.message).toMatch(/MISSING_SCOPES/);
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain("p@example.com");
  });
  it("a contact response without an id is an error, not a silent success", async () => {
    const { crm } = make([res(200, { results: [] })]);
    await expect(crm.createDealForEnquiry(input)).rejects.toThrow(/contact/i);
  });
});
