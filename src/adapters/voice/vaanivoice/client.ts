// Read-only client for vaanivoice.ai (Vaani AI Research). Endpoints and field names from docs.vaanivoice.ai (docs/vaanivoice-findings.md):
//   GET /api/call_details/{call_id}   -> { transcription, entity, conversation_eval, summary, call_eval_tag }
//   GET /api/call-history?page&page_size -> { data:[{ call_id, call_type, direction, from_number, to_number, Start_time, End_time, duration_ms, call_cost, recording_api }], pagination }
// The OpenAPI file shows call_details with an extra {client} segment; the prose page does not. We try the documented form and fall back.

export interface VaaniCallDetails { transcription: unknown; entity: unknown; summary: string; callEvalTag?: string }
export interface VaaniHistoryRow {
  call_id: string; call_type?: string; direction?: string; call_status?: string; from_number?: string; to_number?: string;
  Start_time?: string; End_time?: string; duration_ms?: number; call_cost?: number; recording_api?: string;
  /** "completed" | "not_processed" | "processing" (Vaani docs). Only a "completed" call has its transcript and entities. */
  post_processing_status?: string;
}
/** What the webhook handler needs from Vaani. The real client implements it; so does the in-memory fake. */
export interface VaaniVoicePort {
  /** null = the call exists but its transcript is not ready yet. Throws when Vaani does not know the call. */
  getCallDetails(callId: string): Promise<VaaniCallDetails | null>;
  findInHistory(callId: string): Promise<VaaniHistoryRow | null>;
  /** History rows that STARTED at or after `since` (any order, no duplicates). Reads as few pages as it can; capped. */
  recentCalls(since: Date, o?: { maxPages?: number }): Promise<VaaniHistoryRow[]>;
}
export interface VaaniVoiceOptions { apiKey: string; clientId?: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }

const NOT_READY = /not available/i;
const SAFE_ID = /^[A-Za-z0-9._-]{3,128}$/;

export class VaaniVoiceClient implements VaaniVoicePort {
  private fetchImpl: typeof fetch;
  private base: string;
  constructor(private o: VaaniVoiceOptions) {
    if (!o.apiKey) throw new Error("VaaniVoiceClient needs an API key");
    this.fetchImpl = o.fetch ?? fetch;
    this.base = (o.baseUrl ?? "https://api.vaanivoice.ai").replace(/\/$/, "");
  }

  private async get(path: string): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 15_000);
    try { return await this.fetchImpl(`${this.base}${path}`, { method: "GET", headers: { "x-api-key": this.o.apiKey }, signal: ctl.signal }); }
    catch (e) { throw new Error(`vaanivoice network error: ${String((e as Error).message).split(this.o.apiKey).join("[key]").slice(0, 120)}`); }
    finally { clearTimeout(timer); }
  }

  /** null = the call exists but its transcript is not ready yet (retry later). */
  async getCallDetails(callId: string): Promise<VaaniCallDetails | null> {
    if (!SAFE_ID.test(callId)) throw new Error("vaanivoice: invalid call id");
    let res = await this.get(`/api/call_details/${callId}`);
    if ([404, 405, 422].includes(res.status) && this.o.clientId) res = await this.get(`/api/call_details/${this.o.clientId}/${callId}`);
    if (!res.ok) throw new Error(`vaanivoice call_details failed: ${res.status}`);
    const j = (await res.json().catch(() => ({}))) as { transcription?: unknown; entity?: unknown; summary?: string; call_eval_tag?: string };
    const t = j.transcription;
    if (t === undefined || t === null || (typeof t === "string" && (!t.trim() || NOT_READY.test(t)))) return null;
    return { transcription: t, entity: j.entity ?? {}, summary: j.summary ?? "", callEvalTag: j.call_eval_tag };
  }

  async findInHistory(callId: string, maxPages = 3): Promise<VaaniHistoryRow | null> {
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.get(`/api/call-history?page=${page}&page_size=50`);
      if (!res.ok) throw new Error(`vaanivoice call-history failed: ${res.status}`);
      const j = (await res.json().catch(() => ({}))) as { data?: VaaniHistoryRow[]; pagination?: { has_next?: boolean } };
      const hit = j.data?.find((r) => r.call_id === callId);
      if (hit) return hit;
      if (!j.pagination?.has_next) return null;
    }
    return null;
  }

  /**
   * The history has no documented sort order and no date filter (docs.vaanivoice.ai, call-history: `page`, `page_size` max 200). So: read page 1, work out
   * from its own timestamps whether the list runs newest-first or oldest-first, then read pages from the recent end until a whole page is older than `since`.
   */
  async recentCalls(since: Date, o: { maxPages?: number } = {}): Promise<VaaniHistoryRow[]> {
    const maxPages = o.maxPages ?? 5, cutoff = since.getTime();
    const fetchPage = async (n: number) => {
      const res = await this.get(`/api/call-history?page=${n}&page_size=200`);
      if (!res.ok) throw new Error(`vaanivoice call-history failed: ${res.status}`);
      const j = (await res.json().catch(() => ({}))) as { data?: VaaniHistoryRow[]; pagination?: { total_pages?: number } };
      return { rows: j.data ?? [], totalPages: Number(j.pagination?.total_pages ?? 1) || 1 };
    };
    const start = (r: VaaniHistoryRow) => Date.parse(r.Start_time ?? "");
    const recent = (rows: VaaniHistoryRow[]) => rows.filter((r) => start(r) >= cutoff);
    const out = new Map<string, VaaniHistoryRow>();
    const take = (rows: VaaniHistoryRow[]) => { for (const r of rows) if (r.call_id) out.set(r.call_id, r); };

    const first = await fetchPage(1);
    take(recent(first.rows));
    if (first.totalPages <= 1) return [...out.values()];
    const t = first.rows.map(start).filter(Number.isFinite);
    const newestFirst = t.length < 2 || t[0]! >= t[t.length - 1]!;
    const pages = newestFirst
      ? Array.from({ length: Math.min(first.totalPages, maxPages) - 1 }, (_, i) => i + 2)
      : Array.from({ length: Math.min(first.totalPages - 1, maxPages) }, (_, i) => first.totalPages - i);
    for (const n of pages) {
      const pg = await fetchPage(n);
      const r = recent(pg.rows);
      take(r);
      if (r.length === 0 && pg.rows.length > 0) break; // a whole page older than the cutoff: everything beyond it is older still
    }
    return [...out.values()];
  }
}
