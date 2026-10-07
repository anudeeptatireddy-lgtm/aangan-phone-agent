// Pinned models and prices. Facts verified against Google's raw docs on 2026-10-07 (docs/gemini-findings.md). Never an alias.
export const GEMINI_EXTRACTION_MODEL = "gemini-3.5-flash-lite";

export interface ModelPricing { inputUsdPerM: number; outputUsdPerM: number; verifiedOn: string; source: string }
export const GEMINI_PRICING: Record<string, ModelPricing> = {
  "gemini-3.5-flash-lite": { inputUsdPerM: 0.3, outputUsdPerM: 2.5, verifiedOn: "2026-10-07", source: "https://ai.google.dev/gemini-api/docs/pricing (paid tier)" },
  "gemini-3.1-flash-lite": { inputUsdPerM: 0.25, outputUsdPerM: 1.5, verifiedOn: "2026-10-07", source: "https://ai.google.dev/gemini-api/docs/pricing (paid tier)" },
};

/** Assumption from the research plan (₹88 to the dollar). Update with the real rate when finance confirms one. */
export const FX_INR_PER_USD = 88;
