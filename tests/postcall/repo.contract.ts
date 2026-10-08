import { describe, it, expect, beforeEach } from "vitest";
import type { PostCallRepo } from "@/core/postcall/repo";
import { CheckFitInput } from "@/core/rules/engine";
import { computeAiCost } from "@/core/postcall/costs";
import { GEMINI_EXTRACTION_MODEL } from "@/config/models";

const d = (iso: string) => new Date(iso);
const enquiry = (o: Record<string, unknown> = {}) => ({
  input: CheckFitInput.parse({ location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, deadline_date: "2027-03-31", decision_maker: "owner",
    owners_attending: true, budget_inr: 150000, price_asked: true, referrer: "Vikram Agarwal", tenure: "rented", landlord_consent: true, structural_work: "none", ...o }),
  fit: "fit" as const, reasonCodes: [], flags: ["vip_referrer", "price_asked"], ruleVersion: "v1",
});

/** The same behavioural contract runs against the in-memory repo, a real Postgres (PGlite) and the local Supabase. */
export function postCallRepoContract(name: string, make: () => Promise<PostCallRepo>) {
  describe(`PostCallRepo contract: ${name}`, () => {
    let repo: PostCallRepo;
    beforeEach(async () => { repo = await make(); }, 60_000);

    it("callers are unique per phone; name/email/language fill in without being overwritten by blanks", async () => {
      const a = await repo.upsertCaller({ phone: "+919000000011", name: "Priya" });
      const b = await repo.upsertCaller({ phone: "+919000000011", email: "p@example.com" });
      const c = await repo.upsertCaller({ phone: "+919000000012" });
      expect(b.id).toBe(a.id);
      expect(c.id).not.toBe(a.id);
    });

    it("callerContact returns the caller's details including the real phone number (decrypted), or null", async () => {
      const a = await repo.upsertCaller({ phone: "+919000000017", name: "Priya", email: "p@example.com" });
      expect(await repo.callerContact(a.id)).toEqual({ phone: "+919000000017", name: "Priya", email: "p@example.com" });
      const b = await repo.upsertCaller({ phone: "+919000000018" });
      expect(await repo.callerContact(b.id)).toEqual({ phone: "+919000000018", name: null, email: null });
      expect(await repo.callerContact("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    it("a CRM link is stored once per enquiry (a retry after a half-finished sync finds it)", async () => {
      const e = await repo.upsertEnquiry(enquiry());
      expect(await repo.getCrmLink(e.id)).toBeNull();
      await repo.saveCrmLink(e.id, { contactId: "c-1", dealId: "d-1" });
      await repo.saveCrmLink(e.id, { contactId: "c-1", dealId: "d-1" });
      expect(await repo.getCrmLink(e.id)).toEqual({ contactId: "c-1", dealId: "d-1" });
    });

    it("updateCaller fills details by id without erasing existing ones", async () => {
      const a = await repo.upsertCaller({ phone: "+919000000016", name: "Priya" });
      await repo.updateCaller(a.id, { email: "p@example.com", language: "hi" });
      await repo.updateCaller(a.id, {});
      await expect(repo.updateCaller("00000000-0000-0000-0000-000000000000", { name: "x" })).resolves.toBeUndefined();
    });

    it("a call is created once per vendor call id and patched incrementally", async () => {
      const c1 = await repo.upsertCall("vc-1", { callerId: null, rangAt: d("2026-10-07T05:00:00Z") });
      expect(c1).toMatchObject({ vendorCallId: "vc-1", postCallStatus: "pending", outcome: null });
      const c2 = await repo.upsertCall("vc-1", { endedAt: d("2026-10-07T05:05:00Z"), durationS: 300, transcript: [{ speaker: "agent", text: "Namaste" }, { speaker: "caller", text: "Hi" }], afterHours: false });
      expect(c2.id).toBe(c1.id);
      const got = (await repo.getCall("vc-1"))!;
      expect(got.rangAt!.toISOString()).toBe("2026-10-07T05:00:00.000Z");   // earlier fields survive later patches
      expect(got.durationS).toBe(300);
      expect(got.transcript).toEqual([{ speaker: "agent", text: "Namaste" }, { speaker: "caller", text: "Hi" }]);
      expect(await repo.getCall("nope")).toBeNull();
    });

    it("stores outcome, status, summary, costs and recording expiry", async () => {
      await repo.upsertCall("vc-2", { outcome: "booked", intent: "new_enquiry", disclosureOk: true, postCallStatus: "processed", processedAt: d("2026-10-07T06:00:00Z"),
        summary: "3BHK enquiry.", costAiInr: 0.29, costTotalInr: 0.29, recordingRef: "rec/1", recordingExpiresAt: d("2027-01-05T05:00:00Z"), endedReason: "completed" });
      expect(await repo.getCall("vc-2")).toMatchObject({ outcome: "booked", intent: "new_enquiry", disclosureOk: true, postCallStatus: "processed", summary: "3BHK enquiry.", recordingRef: "rec/1", endedReason: "completed" });
      const got = (await repo.getCall("vc-2"))!;
      expect(got.costAiInr).toBeCloseTo(0.29, 4);
      expect(got.recordingExpiresAt!.toISOString()).toBe("2027-01-05T05:00:00.000Z");
    });

    it("an enquiry round-trips its full rule input, result, flags and rule version", async () => {
      const caller = await repo.upsertCaller({ phone: "+919000000013", name: "Girish" });
      const e = await repo.upsertEnquiry({ ...enquiry(), callerId: caller.id, nextAction: "proceed_to_booking", language: "en", currentState: "bare", sourceHeard: "Instagram", timelineRaw: "by March" });
      expect(e.id).toBeTruthy();
      const got = (await repo.getEnquiry(e.id))!;
      expect(got).toMatchObject({ callerId: caller.id, fit: "fit", ruleVersion: "v1", nextAction: "proceed_to_booking", language: "en", currentState: "bare", sourceHeard: "Instagram", timelineRaw: "by March" });
      expect([...got.flags].sort()).toEqual(["price_asked", "vip_referrer"]); // a set: jsonb does not keep order
      expect(got.input).toMatchObject({ location: "Kothrud", bhk: 3, carpet_sqft: 1400, budget_inr: 150000, deadline_date: "2027-03-31", tenure: "rented", landlord_consent: true, referrer: "Vikram Agarwal", price_asked: true });
    });
    it("updating an enquiry by id changes it in place (same id)", async () => {
      const e = await repo.upsertEnquiry(enquiry());
      const u = await repo.upsertEnquiry({ ...enquiry({ location: "Baner" }), id: e.id, fit: "unclear", reasonCodes: ["edge_location"], designerNote: "NEW CONSULTATION" });
      expect(u.id).toBe(e.id);
      expect(await repo.getEnquiry(e.id)).toMatchObject({ fit: "unclear", reasonCodes: ["edge_location"], designerNote: "NEW CONSULTATION" });
      expect((await repo.getEnquiry(e.id))!.input.location).toBe("Baner");
    });
    it("an enquiry can be created with a caller-chosen id (the live enquiry keeps its id)", async () => {
      const id = crypto.randomUUID();
      expect((await repo.upsertEnquiry({ ...enquiry(), id })).id).toBe(id);
      expect(await repo.getEnquiry(id)).not.toBeNull();
      expect(await repo.getEnquiry(crypto.randomUUID())).toBeNull();
    });

    it("recentCallsForCaller returns only that caller's calls since the cutoff, newest first", async () => {
      const a = await repo.upsertCaller({ phone: "+919000000014" });
      const b = await repo.upsertCaller({ phone: "+919000000015" });
      await repo.upsertCall("old", { callerId: a.id, endedAt: d("2026-10-07T04:00:00Z"), endedReason: "completed" });
      await repo.upsertCall("drop", { callerId: a.id, endedAt: d("2026-10-07T05:00:00Z"), endedReason: "dropped" });
      await repo.upsertCall("other", { callerId: b.id, endedAt: d("2026-10-07T05:01:00Z") });
      await repo.upsertCall("newer", { callerId: a.id, endedAt: d("2026-10-07T05:10:00Z"), endedReason: "completed" });
      const r = await repo.recentCallsForCaller(a.id, d("2026-10-07T04:30:00Z"));
      expect(r.map((c) => c.vendorCallId)).toEqual(["newer", "drop"]);
    });

    it("keeps live and post-call evaluations apart and returns the latest per phase", async () => {
      const e = await repo.upsertEnquiry(enquiry());
      await repo.upsertCall("vc-3", {});
      await repo.recordEvaluation({ vendorCallId: "vc-3", enquiryId: e.id, phase: "live", input: { a: 1 }, fit: "fit", reasonCodes: [], ruleVersion: "v1", callDate: d("2026-10-07T05:00:00Z") });
      await repo.recordEvaluation({ vendorCallId: "vc-3", enquiryId: e.id, phase: "post_call", input: { a: 2 }, fit: "unclear", reasonCodes: ["edge_location"], ruleVersion: "v1", callDate: d("2026-10-07T05:00:00Z") });
      await repo.recordEvaluation({ vendorCallId: "vc-3", enquiryId: e.id, phase: "live", input: { a: 3 }, fit: "not_fit", reasonCodes: ["timeline_too_short"], ruleVersion: "v1", callDate: d("2026-10-07T05:00:00Z") });
      expect(await repo.latestEvaluation("vc-3", "live")).toMatchObject({ fit: "not_fit", reasonCodes: ["timeline_too_short"], ruleVersion: "v1" });
      expect(await repo.latestEvaluation("vc-3", "post_call")).toMatchObject({ fit: "unclear", reasonCodes: ["edge_location"] });
      expect(await repo.latestEvaluation("nope", "live")).toBeNull();
    });

    it("audit flags are recorded with evidence and listed per call", async () => {
      await repo.upsertCall("vc-4", {});
      await repo.addFlag({ vendorCallId: "vc-4", kind: "price_mention", severity: "high", evidence: "around 15 lakh", detectedBy: "price_scan" });
      await repo.addFlag({ vendorCallId: "vc-4", kind: "missing_disclosure", detectedBy: "disclosure_check" });
      const f = await repo.listFlags("vc-4");
      expect(f.map((x) => x.kind).sort()).toEqual(["missing_disclosure", "price_mention"]);
      expect(f.find((x) => x.kind === "price_mention")).toMatchObject({ severity: "high", evidence: "around 15 lakh", detectedBy: "price_scan" });
      expect(await repo.listFlags("none")).toEqual([]);
    });

    it("records AI token costs in the ledger without error", async () => {
      await repo.upsertCall("vc-5", {});
      const c = computeAiCost({ inputTokens: 5000, outputTokens: 500, thoughtTokens: 0 }, GEMINI_EXTRACTION_MODEL);
      await expect(repo.addUsageCosts("vc-5", c.rows, d("2026-10-07T06:00:00Z"))).resolves.toBeUndefined();
    });

    it("records escalations against the call", async () => {
      await repo.upsertCall("vc-6", {});
      await repo.recordEscalation("vc-6", { reason: "complaint", mode: "live_transfer" });
      await repo.recordEscalation("vc-6", { reason: "human_requested", mode: "callback_sla", callbackDueAt: d("2026-10-07T06:15:00Z"), slaMinutes: 15, queue: "front_desk", queueEscalatesTo: "design_lead" });
      const es = await repo.escalationsForCall("vc-6");
      expect(es.map((e) => e.reason).sort()).toEqual(["complaint", "human_requested"]);
      expect(es.find((e) => e.reason === "human_requested")).toMatchObject({ mode: "callback_sla", slaMinutes: 15 });
      expect(await repo.escalationsForCall("none")).toEqual([]);
    });

    it("outbox: enqueue is idempotent on the dedupe key; pending items can be claimed and marked", async () => {
      expect(await repo.enqueue("owner_alert", { text: "x" }, "k1")).toBe(true);
      expect(await repo.enqueue("owner_alert", { text: "x" }, "k1")).toBe(false);
      await repo.enqueue("hubspot_deal", { enquiryId: "e" }, "k2");
      const pend = await repo.pendingOutbox(["owner_alert"], 10);
      expect(pend).toHaveLength(1);
      expect(pend[0]).toMatchObject({ kind: "owner_alert", payload: { text: "x" }, status: "pending", dedupeKey: "k1" });
      await repo.markOutbox(pend[0]!.id, "processed");
      expect(await repo.pendingOutbox(["owner_alert"], 10)).toHaveLength(0);
      expect(await repo.pendingOutbox(["hubspot_deal"], 10)).toHaveLength(1);
      const bad = (await repo.pendingOutbox(["hubspot_deal"], 10))[0]!;
      await repo.markOutbox(bad.id, "pending", "try again");   // a failed attempt that will be retried
      const retry = (await repo.pendingOutbox(["hubspot_deal"], 10))[0]!;
      expect(retry).toMatchObject({ id: bad.id, attempts: 1 });
      await repo.markOutbox(bad.id, "failed", "boom");         // given up
      expect(await repo.pendingOutbox(["hubspot_deal"], 10)).toHaveLength(0);
    });

    describe("CRM links (the HubSpot deal for an enquiry, and what we last read from it)", () => {
      const link = async (at: string) => {
        const e = await repo.upsertEnquiry(enquiry());
        await repo.saveCrmLink(e.id, { contactId: "c1", dealId: "d1" }, d(at));
        return e.id;
      };
      it("a new link starts at stage 'new', is read at once by neither side of the clock until 5 minutes have passed, and is then due", async () => {
        const id = await link("2026-10-07T05:00:00Z");
        expect(await repo.dueCrmLinks(d("2026-10-07T05:04:59Z"), 10)).toEqual([]);
        expect(await repo.dueCrmLinks(d("2026-10-07T05:05:00Z"), 10)).toEqual([{ enquiryId: id, dealId: "d1", stage: "new", dealAmountInr: null }]);
      });
      it("saving a link twice keeps the first (a retried deal job never makes a second link)", async () => {
        const id = await link("2026-10-07T05:00:00Z");
        await repo.saveCrmLink(id, { contactId: "c2", dealId: "d2" }, d("2026-10-07T06:00:00Z"));
        expect(await repo.getCrmLink(id)).toEqual({ contactId: "c1", dealId: "d1" });
      });
      it("recordDealSync stores the stage and amount, stamps when the stage CHANGED, and a later read of the same stage does not move that time", async () => {
        const id = await link("2026-10-07T05:00:00Z");
        await repo.recordDealSync(id, { at: d("2026-10-07T06:00:00Z"), stage: "quote_sent", amountInr: 2_600_000 });
        expect(await repo.getCrmLinkState(id)).toMatchObject({ stage: "quote_sent", dealAmountInr: 2_600_000, stageChangedAt: d("2026-10-07T06:00:00Z"), syncedAt: d("2026-10-07T06:00:00Z") });
        await repo.recordDealSync(id, { at: d("2026-10-07T07:00:00Z"), stage: "quote_sent" });
        expect(await repo.getCrmLinkState(id)).toMatchObject({ stage: "quote_sent", dealAmountInr: 2_600_000, stageChangedAt: d("2026-10-07T06:00:00Z"), syncedAt: d("2026-10-07T07:00:00Z") });
      });
      it("leaving stage and amount out leaves them alone (an unknown stage or a blank amount never wipes what we know); null clears an amount", async () => {
        const id = await link("2026-10-07T05:00:00Z");
        await repo.recordDealSync(id, { at: d("2026-10-07T06:00:00Z"), stage: "won", amountInr: 100 });
        await repo.recordDealSync(id, { at: d("2026-10-07T07:00:00Z") });
        expect(await repo.getCrmLinkState(id)).toMatchObject({ stage: "won", dealAmountInr: 100, syncedAt: d("2026-10-07T07:00:00Z") });
        await repo.recordDealSync(id, { at: d("2026-10-07T08:00:00Z"), amountInr: null });
        expect((await repo.getCrmLinkState(id))!.dealAmountInr).toBeNull();
      });
      it("open deals are read every 5 minutes, won and lost deals every 6 hours; the longest-unread comes first; the limit holds", async () => {
        const open = await link("2026-10-07T05:00:00Z");
        const won = await repo.upsertEnquiry(enquiry()); await repo.saveCrmLink(won.id, { contactId: "c", dealId: "dw" }, d("2026-10-07T05:00:00Z"));
        await repo.recordDealSync(won.id, { at: d("2026-10-07T05:00:00Z"), stage: "won" });
        const t = d("2026-10-07T05:10:00Z");
        expect((await repo.dueCrmLinks(t, 10)).map((x) => x.enquiryId)).toEqual([open]);
        expect((await repo.dueCrmLinks(d("2026-10-07T11:00:00Z"), 10)).map((x) => x.enquiryId).sort()).toEqual([open, won.id].sort());
        expect(await repo.dueCrmLinks(d("2026-10-07T11:00:00Z"), 1)).toHaveLength(1);
      });
    });
  });
}
