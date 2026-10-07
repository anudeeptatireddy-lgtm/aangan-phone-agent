import { describe, it, expect } from "vitest";
import { VaaniVoiceClient } from "@/adapters/voice/vaanivoice/client";

const KEY = "vaani_secretkey0123456789";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
function make(handlers: ((url: string) => Response)[], o: { clientId?: string } = {}) {
  const urls: string[] = []; const headers: Record<string, string>[] = [];
  const f = (async (url: string, init: RequestInit) => { urls.push(url); headers.push(init.headers as Record<string, string>); const h = handlers.shift(); if (!h) throw new Error("unexpected " + url); return h(url); }) as unknown as typeof fetch;
  return { c: new VaaniVoiceClient({ apiKey: KEY, fetch: f, ...o }), urls, headers };
}
const DETAILS = { transcription: "AGENT: Hi\n\n USER: Hello", entity: { locality: "Kothrud" }, summary: "A call.", call_eval_tag: "x" };

describe("getCallDetails", () => {
  it("GETs /api/call_details/{id} with X-API-Key", async () => {
    const { c, urls, headers } = make([() => json(DETAILS)]);
    const d = await c.getCallDetails("call-1");
    expect(urls[0]).toBe("https://api.vaanivoice.ai/api/call_details/call-1");
    expect(headers[0]!["x-api-key"]).toBe(KEY);
    expect(d).toMatchObject({ transcription: DETAILS.transcription, entity: { locality: "Kothrud" }, summary: "A call." });
  });
  it("falls back to the OpenAPI form with the client id when the documented path is refused", async () => {
    const { c, urls } = make([() => json({}, 404), () => json(DETAILS)], { clientId: "client-9" });
    expect((await c.getCallDetails("call-1"))!.summary).toBe("A call.");
    expect(urls[1]).toBe("https://api.vaanivoice.ai/api/call_details/client-9/call-1");
  });
  it("returns null while the transcript is still being prepared (so the caller can retry later)", async () => {
    const { c } = make([() => json({ transcription: "Transcript is not available for further evaluations.", entity: {}, summary: "" })]);
    expect(await c.getCallDetails("call-1")).toBeNull();
  });
  it("errors name the status but never the key", async () => {
    const { c } = make([() => new Response(`bad ${KEY}`, { status: 500 })]);
    const e = await c.getCallDetails("call-xyz").then(() => new Error("none"), (x) => x as Error);
    expect(e.message).toMatch(/500/);
    expect(e.message).not.toContain(KEY);
  });
  it("rejects a call id that is not a plain token (no path tricks)", async () => {
    const { c, urls } = make([]);
    await expect(c.getCallDetails("../agents")).rejects.toThrow(/call id/);
    expect(urls).toHaveLength(0);
  });
});

describe("findInHistory", () => {
  const row = (id: string) => ({ call_id: id, call_type: "Inbound", direction: "Incoming", from_number: "+919000000001", to_number: "+911234567890", Start_time: "2026-10-07T05:00:00Z", End_time: "2026-10-07T05:05:00Z", duration_ms: 300000, call_cost: 12, recording_api: "https://x/stream/" + id });
  it("pages until it finds the call", async () => {
    const { c, urls } = make([() => json({ data: [row("a")], pagination: { has_next: true } }), () => json({ data: [row("b")], pagination: { has_next: false } })]);
    expect(await c.findInHistory("b")).toMatchObject({ call_id: "b", from_number: "+919000000001", duration_ms: 300000 });
    expect(urls[0]).toContain("/api/call-history?page=1&page_size=50");
  });
  it("null when it is not there, and gives up after the page limit", async () => {
    const { c } = make([() => json({ data: [row("a")], pagination: { has_next: false } })]);
    expect(await c.findInHistory("zzz")).toBeNull();
    const many = make([1, 2, 3, 4].map(() => () => json({ data: [], pagination: { has_next: true } })));
    expect(await many.c.findInHistory("zzz", 2)).toBeNull();
    expect(many.urls).toHaveLength(2);
  });
});
