import { FX_INR_PER_USD, GEMINI_PRICING } from "@/config/models";

/** Voice minutes for one call, priced at the dashboard's per-minute rate. An ESTIMATE: the vendor's own cost field has no documented unit. */
export function voiceCostRow(durationS: number, ratePerMinInr: number): CostRow {
  const minutes = Math.round((durationS / 60) * 100) / 100;
  return { line: "voice_minutes", provider: "vaanivoice", quantity: minutes, unit: "minute", unitCost: ratePerMinInr, currency: "INR", fxInrPerUsd: null, amountInr: Math.round(minutes * ratePerMinInr * 100) / 100, source: "computed" };
}

export interface TokenUsage { inputTokens: number; outputTokens: number; thoughtTokens: number }
export interface CostRow {
  line: "ai_tokens_in" | "ai_tokens_out" | "voice_minutes";
  provider: "gemini" | "vaanivoice";
  quantity: number;
  unit: "token" | "minute";
  unitCost: number;            // per unit, in `currency`
  currency: "USD" | "INR";
  fxInrPerUsd: number | null;
  amountInr: number;
  source: "computed";
}

/** Thought tokens are billed as output tokens (conservative reading of Google's pricing; flagged in docs/gemini-findings.md). */
export function computeAiCost(u: TokenUsage, model: string): { rows: CostRow[]; totalUsd: number; totalInr: number } {
  const p = GEMINI_PRICING[model];
  if (!p) throw new Error(`No pricing configured for model ${model}`);
  const outTokens = u.outputTokens + u.thoughtTokens;
  const mk = (line: CostRow["line"], quantity: number, perM: number): CostRow => {
    const unitCost = perM / 1e6;
    return { line, provider: "gemini", quantity, unit: "token", unitCost, currency: "USD", fxInrPerUsd: FX_INR_PER_USD, amountInr: quantity * unitCost * FX_INR_PER_USD, source: "computed" };
  };
  const rows = [mk("ai_tokens_in", u.inputTokens, p.inputUsdPerM), mk("ai_tokens_out", outTokens, p.outputUsdPerM)];
  const totalInr = rows.reduce((s, r) => s + r.amountInr, 0);
  return { rows, totalUsd: totalInr / FX_INR_PER_USD, totalInr };
}
