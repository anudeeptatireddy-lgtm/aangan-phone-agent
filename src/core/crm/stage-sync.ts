import { log } from "@/lib/log";
import type { CrmPort, StageInfo } from "../ports";
import type { BookingRepo } from "../booking/repo";
import type { PostCallRepo } from "../postcall/repo";

// The designers work in HubSpot: they move a deal to "consultation done", send a quote, win or lose it. This copies that progress into our own tables (crm_links)
// so the dashboard's later funnel steps, the quote values and the designers' page have a source. HubSpot is read, never written (except the deals we create).
export const CRM_STAGES = ["new", "consult_booked", "consult_held", "quote_sent", "won", "lost"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];
export type StageMap = Record<string, CrmStage>;
export const OPEN_INTERVAL_MS = 5 * 60_000;           // an open deal is read this often
export const CLOSED_INTERVAL_MS = 6 * 3_600_000;      // a won or lost deal, this often (a deal can be reopened)
const BATCH = 100;                                    // deals per tick; the adapter splits them into HubSpot batches
const HELD = new Set<CrmStage>(["consult_held", "quote_sent", "won"]);

/** HUBSPOT_STAGE_MAP: a JSON object of HubSpot stage id -> one of our six stages. Only the studio knows what its own stages mean. */
export function parseStageMap(raw: string | undefined): StageMap {
  if (!raw || !raw.trim()) return {};
  let j: unknown;
  try { j = JSON.parse(raw); } catch { throw new Error("HUBSPOT_STAGE_MAP must be valid JSON, for example {\"1234\":\"quote_sent\"}"); }
  if (typeof j !== "object" || j === null || Array.isArray(j)) throw new Error("HUBSPOT_STAGE_MAP must be a JSON object of stage id to stage name");
  for (const [id, v] of Object.entries(j)) if (!(CRM_STAGES as readonly string[]).includes(String(v))) throw new Error(`HUBSPOT_STAGE_MAP: stage ${id} must be one of ${CRM_STAGES.join(", ")}`);
  return j as StageMap;
}

/** Which of our stages a HubSpot stage is. The studio's mapping wins; then HubSpot's own closed-won (probability 1.0) / closed-lost (0.0); then the start stage is "new". Otherwise null. */
export function mapStage(i: { stageId: string | null; info?: StageInfo; map: StageMap; startStageId?: string }): CrmStage | null {
  if (!i.stageId) return null;
  const explicit = i.map[i.stageId];
  if (explicit) return explicit;
  if (i.info?.closed && i.info.probability === 1) return "won";
  if (i.info?.closed && i.info.probability === 0) return "lost";
  if (i.startStageId && i.stageId === i.startStageId) return "new";
  return null;
}

export interface StageSyncDeps {
  repo: PostCallRepo;
  bookings: Pick<BookingRepo, "markConsultationHeld">;
  crm: CrmPort;
  now: () => Date;
  stageMap: StageMap;
  startStageId?: string;
  pipelineId?: string;
}
export interface StageSyncResult { checked: number; updated: number; unchanged: number; unmapped: number; missing: number; foreignCurrency: number; skipped?: string }

export class CrmStageSync {
  private stageCache: { at: number; byId: Map<string, StageInfo> } | null = null;
  constructor(private d: StageSyncDeps) {}

  private async stageInfo(): Promise<Map<string, StageInfo>> {
    const now = this.d.now().getTime();
    if (this.stageCache && now - this.stageCache.at < 3_600_000) return this.stageCache.byId;
    const list = this.d.pipelineId ? await this.d.crm.dealStages(this.d.pipelineId) : [];
    this.stageCache = { at: now, byId: new Map(list.map((s) => [s.id, s])) };
    return this.stageCache.byId;
  }

  async run(): Promise<StageSyncResult> {
    const out: StageSyncResult = { checked: 0, updated: 0, unchanged: 0, unmapped: 0, missing: 0, foreignCurrency: 0 };
    const now = this.d.now();
    const due = await this.d.repo.dueCrmLinks(now, BATCH);
    if (!due.length) return out;

    let read: Awaited<ReturnType<CrmPort["readDeals"]>>, info = new Map<string, StageInfo>();
    try {
      read = await this.d.crm.readDeals(due.map((l) => l.dealId));
      // HubSpot's stage list is needed only to recognise closed won / lost; skipped when the studio's own map covers every stage seen
      if (read.deals.some((x) => x.stageId && !this.d.stageMap[x.stageId] && x.stageId !== this.d.startStageId)) info = await this.stageInfo();
    } catch (e) {
      // Nothing is marked as read, so the next tick retries. Say so once a day instead of failing every minute.
      const why = String((e as Error).message).slice(0, 100);
      log("error", "hubspot sync: HubSpot could not be read", { error: why });
      await this.d.repo.enqueue("owner_alert", { flag: "other", vendorCallId: "hubspot-sync", severity: "high",
        evidence: `HubSpot could not be read (${why}). Deal stages and quote values on the dashboard are not updating. A missing permission (scope) on the HubSpot app is the usual cause.` },
        `owner_alert:hubspot_sync_down:${new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)}`);
      return { ...out, skipped: "hubspot_unavailable" };
    }

    const byDeal = new Map(read.deals.map((x) => [x.dealId, x]));
    for (const link of due) {
      out.checked++;
      const snap = byDeal.get(link.dealId);
      if (!snap) { out.missing++; await this.d.repo.recordDealSync(link.enquiryId, { at: now }); continue; }

      const stage = mapStage({ stageId: snap.stageId, info: snap.stageId ? info.get(snap.stageId) : undefined, map: this.d.stageMap, startStageId: this.d.startStageId });
      if (!stage && snap.stageId) {
        out.unmapped++;
        const label = info.get(snap.stageId)?.label ?? (await this.labelOf(snap.stageId));
        await this.d.repo.enqueue("owner_alert", { flag: "other", vendorCallId: "hubspot-stage", severity: "high",
          evidence: `Deals are in the HubSpot stage "${label}" (id ${snap.stageId}), which is not mapped, so their progress is not counted. Add it to HUBSPOT_STAGE_MAP as a stage id and one of: ${CRM_STAGES.join(", ")}.` },
          `owner_alert:hubspot_stage_unmapped:${snap.stageId}`);
      }

      // Amounts are stored in rupees. Another currency is ignored (never converted); a blank amount never wipes the one we have.
      let amountInr: number | undefined;
      if (snap.amount !== null) { if (!snap.currency || snap.currency.toUpperCase() === "INR") amountInr = snap.amount; else out.foreignCurrency++; }

      const changed = (stage && stage !== link.stage) || (amountInr !== undefined && amountInr !== link.dealAmountInr);
      await this.d.repo.recordDealSync(link.enquiryId, { at: now, ...(stage ? { stage } : {}), ...(amountInr !== undefined ? { amountInr } : {}) });
      if (stage && HELD.has(stage)) await this.d.bookings.markConsultationHeld(link.enquiryId);
      if (changed) out.updated++; else out.unchanged++;
    }
    return out;
  }

  private async labelOf(stageId: string): Promise<string> {
    try { return (await this.stageInfo()).get(stageId)?.label ?? stageId; } catch { return stageId; }
  }
}
