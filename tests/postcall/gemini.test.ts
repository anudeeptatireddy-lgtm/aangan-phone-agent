import { describe, it, expect, vi } from "vitest";
import { GeminiExtractor, ExtractionError } from "@/adapters/llm/gemini";
import { buildExtractionRequest, emptyExtraction } from "@/core/postcall/extraction";
import { GEMINI_EXTRACTION_MODEL } from "@/config/models";

const KEY = "AIzaFAKEKEYFORTESTS0123456789abcdefgh";
const CALL = new Date("2026-09-08T10:00:00+05:30");
const turns = [{ speaker: "agent" as const, text: "Namaste." }, { speaker: "caller" as const, text: "3BHK in Kothrud" }];
const req = buildExtractionRequest(turns, CALL);
const extraction = { ...emptyExtraction(), intent: "new_enquiry", location: "Kothrud", summary: "3BHK enquiry." };
const okBody = (data: unknown = extraction) => ({ id: "v1_x", model: GEMINI_EXTRACTION_MODEL, object: "interaction", status: "completed",
  steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(data) }] }],
  usage: { total_input_tokens: 5200, total_output_tokens: 410, total_thought_tokens: 30, total_cached_tokens: 0, total_tokens: 5640 } });
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const make = (fetchImpl: typeof fetch, o: Partial<ConstructorParameters<typeof GeminiExtractor>[0]> = {}) =>
  new GeminiExtractor({ apiKey: KEY, paidTierConfirmed: true, fetch: fetchImpl, sleep: async () => {}, ...o });

describe("GeminiExtractor (request/response shapes verified against Google's Interactions API reference)", () => {
  it("sends the documented request: endpoint, key header, pinned model, JSON schema, store:false", async () => {
    const f = vi.fn(async () => res(200, okBody()));
    await make(f as unknown as typeof fetch).extract(req);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(GEMINI_EXTRACTION_MODEL);
    expect(body.store).toBe(false);                                   // caller data is not retained by Google (hard rule 6)
    expect(body.response_format).toMatchObject({ type: "text", mime_type: "application/json" });
    expect(body.response_format.schema.additionalProperties).toBe(false);
    expect(body.system_instruction).toBe(req.system);
    expect(body.input).toBe(req.input);
    expect(body.generation_config).toMatchObject({ seed: expect.any(Number), max_output_tokens: expect.any(Number), thinking_level: "minimal" });
  });
  it("parses the model_output text, validates it, and reports token usage (thought tokens separately)", async () => {
    const r = await make((async () => res(200, okBody())) as unknown as typeof fetch).extract(req);
    expect(r.data.location).toBe("Kothrud");
    expect(r.usage).toEqual({ inputTokens: 5200, outputTokens: 410, thoughtTokens: 30 });
    expect(r.model).toBe(GEMINI_EXTRACTION_MODEL);
  });
  it("retries transient failures (429/5xx) with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockResolvedValueOnce(res(429, { error: "rate" })).mockResolvedValueOnce(res(503, { error: "down" })).mockResolvedValueOnce(res(200, okBody()));
    const r = await make(f as unknown as typeof fetch, { sleep: async (ms) => { sleeps.push(ms); } }).extract(req);
    expect(r.data.location).toBe("Kothrud");
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });
  it("gives up after the retries are used", async () => {
    const f = vi.fn(async () => res(503, { error: "down" }));
    await expect(make(f as unknown as typeof fetch).extract(req)).rejects.toMatchObject({ code: "upstream_unavailable" });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("does not retry client errors (bad key / bad request)", async () => {
    for (const status of [400, 401, 403]) {
      const f = vi.fn(async () => res(status, { error: { message: `key ${KEY} rejected` } }));
      await expect(make(f as unknown as typeof fetch).extract(req)).rejects.toMatchObject({ code: "rejected" });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
  it("the API key never appears in an error", async () => {
    const f = vi.fn(async () => res(401, { error: { message: `bad key ${KEY}` } }));
    try { await make(f as unknown as typeof fetch).extract(req); throw new Error("should fail"); }
    catch (e) { expect(String(e)).not.toContain(KEY); expect(JSON.stringify(e)).not.toContain(KEY); expect(e).toBeInstanceOf(ExtractionError); }
  });
  it("rejects invalid JSON, schema violations and non-completed interactions", async () => {
    const bad = (data: unknown) => make((async () => res(200, data)) as unknown as typeof fetch).extract(req);
    await expect(bad({ ...okBody(), steps: [{ type: "model_output", content: [{ type: "text", text: "not json" }] }] })).rejects.toMatchObject({ code: "invalid_output" });
    await expect(bad(okBody({ ...extraction, project_type: "palace" }))).rejects.toMatchObject({ code: "invalid_output" });
    await expect(bad({ ...okBody(), status: "failed" })).rejects.toMatchObject({ code: "invalid_output" });
    await expect(bad({ ...okBody(), steps: [] })).rejects.toMatchObject({ code: "invalid_output" });
  });
  it("refuses to run unless a PAID-tier key is confirmed (free tier trains on data: hard rule 6)", () => {
    expect(() => new GeminiExtractor({ apiKey: KEY, paidTierConfirmed: false })).toThrow(/paid/i);
    expect(() => new GeminiExtractor({ apiKey: "", paidTierConfirmed: true })).toThrow(/key/i);
  });
  it("times out a hung request instead of waiting forever", async () => {
    const f = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_r, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    await expect(make(f as unknown as typeof fetch, { timeoutMs: 20 }).extract(req)).rejects.toMatchObject({ code: "upstream_unavailable" });
  });
});
