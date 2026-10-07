import { log } from "@/lib/log";
import { DEFAULT_HOURS, HoursConfig, isWorkingTime } from "../hours";
import type { BookingRepo } from "../booking/repo";
import { noteLines } from "../booking/note";
import type { EnquiryRecord } from "../enquiry";
import { RULES_V1 } from "../rules/config.v1";
import type { RuleConfig } from "../rules/config";
import { checkFit } from "../rules/engine";
import { scanForMissedComplaint } from "./complaint-scan";
import { computeAiCost } from "./costs";
import { checkDisclosure } from "./disclosure";
import { buildExtractionRequest, ExtractionPort, FitMapping, toFitInput } from "./extraction";
import { scanForPrice } from "./price-scan";
import type { CallRow, FlagKind, Outcome, PostCallRepo } from "./repo";
import type { CallRecordInput } from "./types";

export interface PipelineDeps {
  repo: PostCallRepo;
  bookings: Pick<BookingRepo, "bookingForEnquiry">;
  extractor: ExtractionPort;
  now: () => Date;
  designerNames?: string[];
  rules?: RuleConfig;
  hours?: HoursConfig;
  retentionDays?: number;     // recordings are deleted after this many days (owner decision: 90)
}

export interface PostCallResult {
  status: "processed" | "extraction_failed" | "already_processed";
  vendorCallId: string;
  enquiryId?: string;
  outcome?: Outcome;
  flags: FlagKind[];
  costInr?: number;
}

const CONTINUATION_WINDOW_MS = 30 * 60_000;
const DAY = 86_400_000;

export class PostCallPipeline {
  constructor(private d: PipelineDeps) {}

  async process(rec: CallRecordInput): Promise<PostCallResult> {
    const { repo } = this.d;
    const id = rec.vendorCallId;
    const existing = await repo.getCall(id);
    if (existing?.postCallStatus === "processed") return { status: "already_processed", vendorCallId: id, outcome: existing.outcome ?? undefined, enquiryId: existing.enquiryId ?? undefined, flags: await this.flagKinds(id) };

    const now = this.d.now();
    const hours = this.d.hours ?? DEFAULT_HOURS;
    const endedAt = new Date(rec.endedAt);
    const startedAt = new Date(rec.rangAt ?? rec.answeredAt ?? endedAt.getTime() - (rec.durationS ?? 0) * 1000);

    // ---- who called, and the call row ----
    let callerId = existing?.callerId ?? null;
    if (!callerId && rec.callerPhone) callerId = (await repo.upsertCaller({ phone: rec.callerPhone })).id;
    await repo.upsertCall(id, {
      callerId, rangAt: rec.rangAt ? new Date(rec.rangAt) : undefined, answeredAt: rec.answeredAt ? new Date(rec.answeredAt) : undefined, endedAt,
      durationS: rec.durationS, endedReason: rec.endedReason, transcript: rec.transcript, recordingRef: rec.recordingRef,
      recordingExpiresAt: new Date(endedAt.getTime() + (this.d.retentionDays ?? 90) * DAY), afterHours: !isWorkingTime(startedAt, hours),
    });

    if (rec.endedReason === "missed") {
      await repo.upsertCall(id, { outcome: "missed", postCallStatus: "processed", processedAt: now });
      return { status: "processed", vendorCallId: id, outcome: "missed", flags: await this.flagKinds(id) };
    }

    const raised = new Set<FlagKind>((await repo.listFlags(id)).map((f) => f.kind));
    const raise = async (kind: FlagKind, evidence: string, by: string, opts: { nikhil?: boolean } = {}) => {
      if (raised.has(kind)) return; // re-processing never duplicates a flag
      raised.add(kind);
      const ev = evidence.slice(0, 300);
      await repo.addFlag({ vendorCallId: id, kind, severity: "high", evidence: ev, detectedBy: by });
      const payload = { flag: kind, vendorCallId: id, evidence: ev, severity: "high" };
      await repo.enqueue("owner_alert", payload, `owner_alert:${kind}:${id}`);
      if (opts.nikhil) await repo.enqueue("nikhil_alert", payload, `nikhil_alert:${kind}:${id}`);
    };

    // ---- deterministic scans first: they never depend on the model ----
    const disclosure = checkDisclosure(rec.transcript);
    await repo.upsertCall(id, { disclosureOk: disclosure.ok });
    if (!disclosure.ok) await raise("missing_disclosure", `first agent line missing: ${disclosure.missing.join(", ")}`, "disclosure_check");

    for (const t of rec.transcript.filter((x) => x.speaker === "agent")) {
      if (scanForPrice(t.text).length) { await raise("price_mention", t.text, "price_scan"); break; }
    }

    // ---- extraction (retry once; never retry a rejected request) ----
    const req = buildExtractionRequest(rec.transcript, startedAt, { vendorCallId: id });
    let result: Awaited<ReturnType<ExtractionPort["extract"]>> | undefined;
    let lastErr = "no transcript";
    if (rec.transcript.length) {
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        try { result = await this.d.extractor.extract(req); }
        catch (err) {
          lastErr = String((err as Error).message ?? err);
          if ((err as { code?: string }).code === "rejected") break;
        }
      }
    }
    if (!result) {
      log("error", "post-call extraction failed", { vendor_call_id: id, error: lastErr });
      await raise("extraction_failed", lastErr, "pipeline");
      await repo.upsertCall(id, { postCallStatus: "extraction_failed", outcome: "review", processedAt: now });
      return { status: "extraction_failed", vendorCallId: id, outcome: "review", flags: await this.flagKinds(id) };
    }

    // ---- cost ----
    const cost = computeAiCost(result.usage, result.model);
    await repo.addUsageCosts(id, cost.rows, now);

    const e = result.data;
    const mapping = toFitInput(e, startedAt);
    if (callerId && (mapping.callerName || mapping.callerEmail || mapping.language)) await repo.updateCaller(callerId, { name: mapping.callerName, email: mapping.callerEmail, language: mapping.language });

    // ---- hard rule 4: did a complaint slip through? ----
    const escalations = await repo.escalationsForCall(id);
    const escalated = escalations.some((x) => x.reason === "complaint" || x.reason === "human_requested");
    const slip = scanForMissedComplaint({ turns: rec.transcript, escalated, intent: e.intent, designerNames: this.d.designerNames });
    if (slip.missed) await raise("missed_complaint", slip.evidence ?? "complaint signals", "complaint_scan", { nikhil: true });

    const finish = async (outcome: Outcome, enquiryId?: string, extra: Partial<CallRow> = {}): Promise<PostCallResult> => {
      const prev = await repo.getCall(id);
      const voice = prev?.costVoiceInr ?? 0;
      await repo.upsertCall(id, { outcome, intent: e.intent, summary: e.summary, postCallStatus: "processed", processedAt: now, costAiInr: cost.totalInr, costTotalInr: cost.totalInr + voice, ...extra });
      return { status: "processed", vendorCallId: id, enquiryId, outcome, flags: await this.flagKinds(id), costInr: cost.totalInr };
    };

    // ---- calls that are not new enquiries never become leads ----
    if (slip.missed || e.intent === "complaint" || e.intent === "existing_client") return finish(escalated ? "escalated" : "review");
    if (e.intent === "other") return finish("closed_other");

    // ---- the enquiry: continue the live one, or the one from a dropped call within 30 minutes, or start one ----
    const live = existing?.enquiryId ? await repo.getEnquiry(existing.enquiryId) : null;
    let parent: CallRow | undefined;
    if (callerId) {
      const recent = await repo.recentCallsForCaller(callerId, new Date(startedAt.getTime() - CONTINUATION_WINDOW_MS));
      parent = recent.find((c) => c.vendorCallId !== id && c.endedReason === "dropped");
    }
    const hasContent = !!(mapping.input.location || mapping.input.project_type || (mapping.input.scope && mapping.input.scope !== "unspecified") || mapping.input.carpet_sqft || mapping.input.bhk || mapping.input.deadline_date);
    const enquiryId = live?.id ?? parent?.enquiryId ?? (hasContent ? crypto.randomUUID() : undefined);
    if (parent) await repo.upsertCall(id, { parentCallId: parent.id });
    if (!enquiryId) return finish(rec.endedReason === "dropped" ? "dropped" : "review");

    const post = checkFit(mapping.input, startedAt, this.d.rules ?? RULES_V1);
    const liveEval = await repo.latestEvaluation(id, "live");
    const base = live ?? undefined;
    const flags = [...new Set([...(base?.flags ?? post.flags), ...(mapping.deadlineIssue ? ["deadline_unresolved"] : [])])];

    // The LIVE result is authoritative (it decided what the caller was told); the post-call run is the audit.
    const keepLive = !!(base && liveEval);
    const booking = await this.d.bookings.bookingForEnquiry(enquiryId);
    const authoritativeFit = keepLive ? base!.fit : post.result;

    let designerNote: string | undefined;
    if (booking) {
      const rec2: EnquiryRecord = { id: enquiryId, callerName: mapping.callerName, input: (keepLive ? base!.input : mapping.input) as EnquiryRecord["input"], fit: authoritativeFit, reasonCodes: [], flags, createdAt: now.toISOString() };
      designerNote = noteLines({ enquiry: rec2, start: booking.startsAt, mode: booking.mode, principalRequested: false, callSeconds: rec.durationS, summary: mapping.summary }).join("\n");
    }

    const saved = await repo.upsertEnquiry({
      id: enquiryId, callerId: callerId ?? base?.callerId ?? null,
      input: keepLive ? base!.input : (mapping.input as never), fit: authoritativeFit, reasonCodes: keepLive ? base!.reasonCodes : post.reason_codes,
      missingFields: keepLive ? base!.missingFields : post.missing_fields, nextAction: keepLive ? base!.nextAction ?? undefined : post.next_action,
      flags, ruleVersion: keepLive ? base!.ruleVersion : post.rule_version, language: mapping.language ?? base?.language ?? undefined,
      currentState: mapping.currentState ?? base?.currentState ?? undefined, sourceHeard: mapping.sourceHeard ?? base?.sourceHeard ?? undefined,
      timelineRaw: mapping.timelineRaw ?? base?.timelineRaw ?? undefined, designerNote,
    });
    await repo.recordEvaluation({ vendorCallId: id, enquiryId, phase: "post_call", input: mapping.input, fit: post.result, reasonCodes: post.reason_codes, ruleVersion: post.rule_version, callDate: startedAt });
    if (parent && !parent.enquiryId) await repo.upsertCall(parent.vendorCallId, { enquiryId });
    await repo.upsertCall(id, { enquiryId });

    if (liveEval && liveEval.fit !== post.result)
      await raise("rule_disagreement", `live: ${liveEval.fit} [${liveEval.reasonCodes.join(", ")}] · post-call: ${post.result} [${post.reason_codes.join(", ")}]`, "rules_audit");

    // ---- what happens next (delivered by the outbox workers) ----
    if (saved.fit === "fit") await repo.enqueue("hubspot_deal", { enquiryId, vendorCallId: id, bookingId: booking?.id ?? null }, `hubspot_deal:${enquiryId}`);
    const email = booking?.callerEmail ?? mapping.callerEmail;
    if (booking && email) await repo.enqueue("confirmation_email", { bookingId: booking.id, enquiryId, email, name: mapping.callerName ?? null, startsAt: booking.startsAt.toISOString() }, `confirmation_email:${booking.id}`);

    if (booking && designerNote) await repo.enqueue("designer_note_update", { enquiryId, bookingId: booking.id }, `designer_note_update:${booking.id}`);

    const outcome: Outcome = booking ? "booked" : escalated ? "escalated" : rec.endedReason === "dropped" ? "dropped" : saved.fit === "not_fit" ? "not_fit" : "review";
    return finish(outcome, enquiryId, { enquiryId });
  }

  private async flagKinds(vendorCallId: string): Promise<FlagKind[]> { return (await this.d.repo.listFlags(vendorCallId)).map((f) => f.kind); }
}

export type { FitMapping };
