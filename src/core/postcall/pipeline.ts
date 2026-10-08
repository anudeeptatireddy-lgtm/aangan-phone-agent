import { log } from "@/lib/log";
import { DEFAULT_HOURS, HoursConfig, isWorkingTime } from "../hours";
import type { BookingRepo } from "../booking/repo";
import { noteLines } from "../booking/note";
import type { EnquiryRecord } from "../enquiry";
import { RULES_V1 } from "../rules/config.v1";
import type { RuleConfig } from "../rules/config";
import { checkFit } from "../rules/engine";
import { scanForMissedComplaint } from "./complaint-scan";
import { computeAiCost, voiceCostRow } from "./costs";
import { checkDisclosure } from "./disclosure";
import { buildExtractionRequest, emptyExtraction, Extraction, ExtractionPort, FitMapping, toFitInput } from "./extraction";
import { planEscalation } from "../escalation";
import { scanForPrice } from "./price-scan";
import type { CallRow, FlagKind, Outcome, PostCallRepo } from "./repo";
import type { CallRecordInput } from "./types";

export interface PipelineDeps {
  repo: PostCallRepo;
  bookings: Pick<BookingRepo, "bookingForEnquiry">;
  /** Optional: without it (e.g. no paid-tier key) the vendor's own entities are all there is, and gaps stay gaps. */
  extractor?: ExtractionPort;
  /** Merge a vendor's own extraction into the model's (vendor values win where valid). */
  refine?: (e: Extraction, rec: CallRecordInput) => Extraction;
  /**
   * live_tools: the voice agent called our tools during the call (a live enquiry and booking exist).
   * prompt_only: it did not; the booking is made by the voice platform (Cal.com) and we decide everything here, afterwards.
   */
  mode?: "live_tools" | "prompt_only";
  /** prompt_only: tried as soon as processing finishes. A failure never fails the call: the queued `call_routing` item is retried by the tick. */
  router?: { routeCall(vendorCallId: string): Promise<unknown> };
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
    // A call we could not read at all (endedReason "failed": the reconciler's record of a call Vaani never made readable) cannot be judged on its opening.
    if (rec.endedReason !== "failed") {
      const disclosure = checkDisclosure(rec.transcript);
      await repo.upsertCall(id, { disclosureOk: disclosure.ok });
      if (!disclosure.ok) await raise("missing_disclosure", `first agent line missing: ${disclosure.missing.join(", ")}`, "disclosure_check");
    }

    for (const t of rec.transcript.filter((x) => x.speaker === "agent")) {
      if (scanForPrice(t.text).length) { await raise("price_mention", t.text, "price_scan"); break; }
    }

    // ---- extraction (retry once; never retry a rejected request) ----
    const req = buildExtractionRequest(rec.transcript, startedAt, { vendorCallId: id });
    let result: { data: Extraction; usage?: Awaited<ReturnType<ExtractionPort["extract"]>>["usage"]; model?: string } | undefined;
    let lastErr = "no transcript";
    if (rec.transcript.length && this.d.extractor) {
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        try { result = await this.d.extractor.extract(req); }
        catch (err) {
          lastErr = String((err as Error).message ?? err);
          if ((err as { code?: string }).code === "rejected") break;
        }
      }
    } else if (rec.transcript.length && this.d.refine) {
      result = { data: { ...emptyExtraction(), summary: rec.vendorSummary ?? "" } }; // vendor entities only; no model call, no model cost
    }
    if (!result) {
      log("error", "post-call extraction failed", { vendor_call_id: id, error: lastErr });
      await raise("extraction_failed", lastErr, "pipeline");
      await repo.upsertCall(id, { postCallStatus: "extraction_failed", outcome: "review", processedAt: now });
      return { status: "extraction_failed", vendorCallId: id, outcome: "review", flags: await this.flagKinds(id) };
    }

    // ---- cost ----
    const cost = result.usage && result.model ? computeAiCost(result.usage, result.model) : { rows: [], totalInr: 0 };
    if (cost.rows.length) await repo.addUsageCosts(id, cost.rows, now);
    if (rec.voiceCostInr !== undefined) {
      await repo.upsertCall(id, { costVoiceInr: rec.voiceCostInr });
      if (rec.durationS && rec.voiceRateInrPerMin) await repo.addUsageCosts(id, [voiceCostRow(rec.durationS, rec.voiceRateInrPerMin)], now); // the ledger the dashboard's cost panel reads
    }

    const e = this.d.refine ? this.d.refine(result.data, rec) : result.data;
    const mapping = toFitInput(e, startedAt);
    if (callerId && (mapping.callerName || mapping.callerEmail || mapping.language)) await repo.updateCaller(callerId, { name: mapping.callerName, email: mapping.callerEmail, language: mapping.language });

    // ---- hard rule 4: did a complaint slip through? ----
    const escalations = await repo.escalationsForCall(id);
    let escalated = escalations.some((x) => x.reason === "complaint" || x.reason === "human_requested");

    // prompt_only: no tool ran during the call, so nobody has been escalated yet. The agent promised a callback; we create it now.
    // (No live transfer exists in this mode, so the plan is the "transfer failed" one: a short SLA in hours, 10am next working day otherwise.)
    if (!escalated && this.d.mode === "prompt_only") {
      const reason = e.intent === "complaint" || e.intent === "existing_client" ? ("complaint" as const) : rec.signals?.wantsPerson ? ("human_requested" as const) : null;
      if (reason) {
        const plan = planEscalation(reason, endedAt, hours, { transferFailed: true });
        await repo.recordEscalation(id, { reason, mode: plan.mode, callbackDueAt: plan.callbackDueAt ? new Date(plan.callbackDueAt) : null, slaMinutes: plan.slaMinutes ?? null,
          queue: plan.queue ?? null, queueEscalatesTo: plan.queueEscalatesTo ?? null });
        escalated = true;
        if (reason === "complaint") {
          await repo.enqueue("design_lead_alert", { kind: "complaint_callback", vendorCallId: id, dueAt: plan.callbackDueAt, slaMinutes: plan.slaMinutes ?? null }, `design_lead_alert:complaint:${id}`);
          if (plan.alertNikhil) await repo.enqueue("nikhil_alert", { flag: "other", vendorCallId: id, severity: "high",
            evidence: `Complaint / existing-client call received after hours. A senior callback was promised by ${plan.callbackDueAt ?? "next working day"}.` }, `nikhil_alert:complaint_after_hours:${id}`);
        }
      }
    }
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
    const promptOnly = this.d.mode === "prompt_only";
    const booking = promptOnly ? null : await this.d.bookings.bookingForEnquiry(enquiryId);
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
    if (promptOnly) {
      if (escalated) return finish("escalated", enquiryId); // asked for a person: the details are saved for them; the front desk calls back
      // The booking (if any) lives in Cal.com and arrives by its own webhook: the router matches it and decides who is told what.
      await repo.enqueue("call_routing", { vendorCallId: id, enquiryId, claimedBooking: rec.signals?.claimedBooking === true }, `call_routing:${id}`);
      const result = await finish("review", enquiryId, { }); // provisional: the router sets the final outcome
      try { await this.d.router?.routeCall(id); } catch (err) { log("error", "post-call: routing attempt failed; the tick will retry", { vendor_call_id: id, error: String(err).slice(0, 200) }); }
      return result;
    }
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
