import { GEMINI_EXTRACTION_MODEL } from "@/config/models";
import { ExtractionPort, ExtractionRequest, ExtractionResult, ExtractionSchema, EXTRACTION_JSON_SCHEMA } from "@/core/postcall/extraction";

// Request/response shapes verified against https://ai.google.dev/api/interactions-api (see docs/gemini-findings.md).

export type ExtractionErrorCode = "upstream_unavailable" | "rejected" | "invalid_output";
export class ExtractionError extends Error {
  constructor(public code: ExtractionErrorCode, message: string) { super(message); this.name = "ExtractionError"; }
}

export interface GeminiOptions {
  apiKey: string;
  /** Hard rule 6: the free tier uses content to improve Google's products. A billing-enabled key must be confirmed explicitly. */
  paidTierConfirmed: boolean;
  model?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

export class GeminiExtractor implements ExtractionPort {
  private model: string;
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private timeoutMs: number;
  private maxRetries: number;
  private apiKey: string;

  constructor(o: GeminiOptions) {
    if (!o.apiKey) throw new Error("GeminiExtractor needs an API key");
    if (!o.paidTierConfirmed) throw new Error("Refusing to send caller data to Gemini: a PAID-tier key must be confirmed (GEMINI_PAID_TIER_CONFIRMED=true). The free tier uses content to improve Google's products.");
    this.model = o.model ?? GEMINI_EXTRACTION_MODEL;
    if (/latest|preview|exp/.test(this.model)) throw new Error(`Model must be a pinned stable id, not "${this.model}"`);
    this.apiKey = o.apiKey;
    this.fetchImpl = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.maxRetries = o.maxRetries ?? 2;
  }

  async extract(req: ExtractionRequest): Promise<ExtractionResult> {
    const body = JSON.stringify({
      model: this.model,
      system_instruction: req.system,
      input: req.input,
      store: false, // do not retain caller data on Google's side
      response_format: { type: "text", mime_type: "application/json", schema: EXTRACTION_JSON_SCHEMA },
      generation_config: { max_output_tokens: 4000, seed: 7, thinking_level: "minimal" },
    });

    let lastTransient = false;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(1000 * 2 ** (attempt - 1));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, body, signal: ctl.signal });
      } catch {
        lastTransient = true; // network error or timeout
        continue;
      } finally { clearTimeout(timer); }

      if (TRANSIENT.has(res.status)) { lastTransient = true; continue; }
      if (!res.ok) throw new ExtractionError("rejected", `Gemini rejected the request (HTTP ${res.status})`); // never echo the body: it may contain the key
      return this.parse(await res.json().catch(() => null));
    }
    throw new ExtractionError("upstream_unavailable", lastTransient ? "Gemini unavailable after retries" : "Gemini request failed");
  }

  private parse(json: unknown): ExtractionResult {
    const j = json as { status?: string; steps?: { type?: string; content?: { type?: string; text?: string }[] }[]; usage?: Record<string, number> } | null;
    if (!j || j.status !== "completed") throw new ExtractionError("invalid_output", `Interaction not completed (status: ${j?.status ?? "none"})`);
    const text = (j.steps ?? []).filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    if (!text) throw new ExtractionError("invalid_output", "No model output text");
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new ExtractionError("invalid_output", "Model output was not valid JSON"); }
    const parsed = ExtractionSchema.safeParse(raw);
    if (!parsed.success) throw new ExtractionError("invalid_output", `Model output failed the schema: ${parsed.error.issues.map((i) => i.path.join(".")).slice(0, 5).join(", ")}`);
    const u = j.usage ?? {};
    return { data: parsed.data, model: this.model, usage: { inputTokens: u.total_input_tokens ?? 0, outputTokens: u.total_output_tokens ?? 0, thoughtTokens: u.total_thought_tokens ?? 0 } };
  }
}
