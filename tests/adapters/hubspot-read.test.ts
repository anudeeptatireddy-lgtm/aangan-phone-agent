import { describe, it, expect } from "vitest";
import { HubSpotCrm } from "@/adapters/crm/hubspot";

const TOKEN = "pat-na2-secret-token-value";
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
function make(responses: Response[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses.shift(); if (!r) throw new Error("no more responses"); return r;
  }) as unknown as typeof fetch;
  return { crm: new HubSpotCrm({ token: TOKEN, pipelineId: "p1", dealStageId: "s1", fetch: f }), calls };
}
const deal = (id: string, p: Record<string, string | null>) => ({ id, properties: { dealstage: "s1", pipeline: "p1", amount: null, deal_currency_code: null, ...p } });

describe("HubSpotCrm.readDeals (batch read, as documented at developers.hubspot.com)", () => {
  it("POSTs /crm/v3/objects/deals/batch/read with the deal ids and the four properties we use, with the bearer token", async () => {
    const { crm, calls } = make([res(200, { status: "COMPLETE", results: [deal("901", { dealstage: "s2", amount: "2600000.00", deal_currency_code: "INR" })] })]);
    const r = await crm.readDeals(["901"]);
    expect(calls[0]).toMatchObject({ url: "https://api.hubapi.com/crm/v3/objects/deals/batch/read", method: "POST" });
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.body).toEqual({ properties: ["dealstage", "pipeline", "amount", "deal_currency_code"], inputs: [{ id: "901" }] });
    expect(r.deals).toEqual([{ dealId: "901", pipelineId: "p1", stageId: "s2", amount: 2_600_000, currency: "INR" }]);
    expect(r.missing).toEqual([]);
  });
  it("parses amounts (a string) safely: blank, missing or non-numeric amounts are null, never zero or NaN", async () => {
    const { crm } = make([res(200, { results: [deal("1", { amount: "" }), deal("2", {}), deal("3", { amount: "n/a" }), deal("4", { amount: "1500.50" })] })]);
    expect((await crm.readDeals(["1", "2", "3", "4"])).deals.map((d) => d.amount)).toEqual([null, null, null, 1500.5]);
  });
  it("ids HubSpot did not return are reported as missing (a deleted deal), not as an error", async () => {
    const { crm } = make([res(200, { results: [deal("901", {})] })]);
    expect((await crm.readDeals(["901", "902"])).missing).toEqual(["902"]);
  });
  it("a partly-failed batch (207) is accepted: the deals that were read are used", async () => {
    const { crm } = make([res(207, { status: "COMPLETE", results: [deal("901", {})], errors: [{ status: "error", category: "OBJECT_NOT_FOUND", context: { ids: ["902"] } }] })]);
    const r = await crm.readDeals(["901", "902"]);
    expect(r.deals).toHaveLength(1); expect(r.missing).toEqual(["902"]);
  });
  it("reads in batches of 50, in order, however many deals there are", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => String(i + 1));
    const { crm, calls } = make([res(200, { results: [] }), res(200, { results: [] }), res(200, { results: [] })]);
    await crm.readDeals(ids);
    expect(calls.map((c) => (c.body as { inputs: unknown[] }).inputs.length)).toEqual([50, 50, 20]);
  });
  it("nothing to read means no request", async () => {
    const { crm, calls } = make([]);
    expect(await crm.readDeals([])).toEqual({ deals: [], missing: [] }); expect(calls).toHaveLength(0);
  });
  it("a refusal is an error naming the status and HubSpot's category, never the token", async () => {
    const { crm } = make([res(403, { status: "error", category: "MISSING_SCOPES", message: `no ${TOKEN}` })]);
    const e = await crm.readDeals(["1"]).then(() => new Error("none"), (x) => x as Error);
    expect(e.message).toMatch(/403.*MISSING_SCOPES/); expect(e.message).not.toContain(TOKEN);
  });
});

describe("HubSpotCrm.dealStages", () => {
  it("GETs the pipeline's stages and reads HubSpot's own metadata (strings in the API) as booleans and numbers", async () => {
    const { crm, calls } = make([res(200, { results: [
      { id: "s1", label: "Enquiry", displayOrder: 0, metadata: { isClosed: "false", probability: "0.2" } },
      { id: "s9", label: "Closed won", displayOrder: 5, metadata: { isClosed: "true", probability: "1.0" } },
      { stageId: "s8", label: "Closed lost", metadata: { isClosed: "true", probability: "0.0" } }] })]);
    const st = await crm.dealStages("p1");
    expect(calls[0]).toMatchObject({ url: "https://api.hubapi.com/crm/v3/pipelines/deals/p1/stages", method: "GET" });
    expect(st).toEqual([{ id: "s1", label: "Enquiry", closed: false, probability: 0.2 }, { id: "s9", label: "Closed won", closed: true, probability: 1 }, { id: "s8", label: "Closed lost", closed: true, probability: 0 }]); // the docs show both `id` and `stageId`
  });
  it("a stage with no metadata is still listed, with unknowns", async () => {
    const { crm } = make([res(200, { results: [{ id: "s2", label: "Odd" }] })]);
    expect(await crm.dealStages("p1")).toEqual([{ id: "s2", label: "Odd", closed: null, probability: null }]);
  });
  it("only a safe pipeline id is put in the URL", async () => {
    const { crm, calls } = make([]);
    await expect(crm.dealStages("../../x")).rejects.toThrow(/pipeline id/i); expect(calls).toHaveLength(0);
  });
});

describe("HubSpotCrm.dealPipelines", () => {
  it("lists the account's deal pipelines (id, label) so the right one can be chosen", async () => {
    const { crm, calls } = make([res(200, { results: [{ id: "default", label: "Sales Pipeline", displayOrder: 0 }, { id: "77", label: "Interiors" }] })]);
    expect(await crm.dealPipelines()).toEqual([{ id: "default", label: "Sales Pipeline" }, { id: "77", label: "Interiors" }]);
    expect(calls[0]).toMatchObject({ url: "https://api.hubapi.com/crm/v3/pipelines/deals", method: "GET" });
  });
});
