import { describe, it, expect } from "vitest";
import { computeAiCost } from "@/core/postcall/costs";
import { GEMINI_EXTRACTION_MODEL, GEMINI_PRICING, FX_INR_PER_USD } from "@/config/models";

describe("AI cost accounting", () => {
  it("prices tokens from the verified paid-tier rates: $0.30 in / $2.50 out per 1M", () => {
    expect(GEMINI_PRICING[GEMINI_EXTRACTION_MODEL]).toMatchObject({ inputUsdPerM: 0.3, outputUsdPerM: 2.5 });
    const c = computeAiCost({ inputTokens: 6000, outputTokens: 600, thoughtTokens: 0 }, GEMINI_EXTRACTION_MODEL);
    expect(c.rows.find((r) => r.line === "ai_tokens_in")).toMatchObject({ quantity: 6000, currency: "USD" });
    expect(c.totalUsd).toBeCloseTo(0.0033, 6);
    expect(c.totalInr).toBeCloseTo(0.0033 * FX_INR_PER_USD, 4);
  });
  it("thought tokens are billed as output tokens (conservative reading, flagged assumption)", () => {
    const a = computeAiCost({ inputTokens: 1000, outputTokens: 100, thoughtTokens: 0 }, GEMINI_EXTRACTION_MODEL);
    const b = computeAiCost({ inputTokens: 1000, outputTokens: 100, thoughtTokens: 400 }, GEMINI_EXTRACTION_MODEL);
    expect(b.totalUsd - a.totalUsd).toBeCloseTo((400 * 2.5) / 1e6, 8);
    expect(b.rows.find((r) => r.line === "ai_tokens_out")!.quantity).toBe(500);
  });
  it("rows carry the fx rate so the ledger is auditable; amounts add up", () => {
    const c = computeAiCost({ inputTokens: 5000, outputTokens: 500, thoughtTokens: 0 }, GEMINI_EXTRACTION_MODEL);
    expect(c.rows.every((r) => r.fxInrPerUsd === FX_INR_PER_USD && r.provider === "gemini")).toBe(true);
    expect(c.rows.reduce((s, r) => s + r.amountInr, 0)).toBeCloseTo(c.totalInr, 6);
  });
  it("an unknown model is refused rather than priced at zero", () => {
    expect(() => computeAiCost({ inputTokens: 1, outputTokens: 1, thoughtTokens: 0 }, "gemini-mystery")).toThrow(/no pricing/i);
  });
});

describe("the pinned model (config, never an alias)", () => {
  it("is a specific stable id, not latest / preview / experimental", () => {
    expect(GEMINI_EXTRACTION_MODEL).toBe("gemini-3.5-flash-lite");
    expect(GEMINI_EXTRACTION_MODEL).not.toMatch(/latest|preview|exp|-\d{3}$/);
    expect(GEMINI_EXTRACTION_MODEL).toMatch(/^gemini-\d+\.\d+-flash-lite$/);
  });
});
