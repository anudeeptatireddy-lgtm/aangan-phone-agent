import { GEMINI_EXTRACTION_MODEL } from "@/config/models";
import type { Extraction, ExtractionPort, ExtractionRequest, ExtractionResult } from "@/core/postcall/extraction";
import { ExtractionError } from "./gemini";

/** Scripted extractor for tests and local runs: returns canned extractions by vendor call id and can fail on demand. */
export class FakeExtractor implements ExtractionPort {
  byCallId = new Map<string, Extraction>();
  calls: ExtractionRequest[] = [];
  private failures: ExtractionError[] = [];
  usage = { inputTokens: 5000, outputTokens: 500, thoughtTokens: 0 };

  set(vendorCallId: string, e: Extraction) { this.byCallId.set(vendorCallId, e); }
  failNext(code: ExtractionError["code"] = "upstream_unavailable", times = 1) { for (let i = 0; i < times; i++) this.failures.push(new ExtractionError(code, `fake ${code}`)); }

  async extract(req: ExtractionRequest): Promise<ExtractionResult> {
    this.calls.push(req);
    const f = this.failures.shift();
    if (f) throw f;
    const e = req.meta?.vendorCallId ? this.byCallId.get(req.meta.vendorCallId) : undefined;
    if (!e) throw new ExtractionError("invalid_output", "fake extractor has no extraction for this call");
    return { data: e, usage: this.usage, model: GEMINI_EXTRACTION_MODEL };
  }
}
