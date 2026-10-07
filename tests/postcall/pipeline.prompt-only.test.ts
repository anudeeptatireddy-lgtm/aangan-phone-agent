import { describe, it, expect } from "vitest";
import { InMemoryPostCallRepo } from "@/server/postcall-repo";
import { InMemoryBookingRepo } from "@/server/booking-repo";
import { FakeExtractor } from "@/adapters/llm/fake";
import { PostCallPipeline } from "@/core/postcall/pipeline";
import { mergeVaaniEntities } from "@/adapters/voice/vaanivoice/entities";
import type { CallRecordInput } from "@/core/postcall/types";
import { a, c, cleanTurns, ext, OPEN, record } from "./pipeline.helpers";

const NOW = new Date("2026-10-07T06:20:00Z"); // Wed 11:50 IST (in hours)
const NIGHT = new Date("2026-10-07T16:30:00Z"); // Wed 22:00 IST (after hours)

function make(o: { extractor?: boolean; now?: Date; entity?: Record<string, unknown> } = {}) {
  const repo = new InMemoryPostCallRepo("pepper-0123456789ab");
  const extractor = new FakeExtractor();
  const entity = o.entity ?? {};
  const pipeline = new PostCallPipeline({
    repo, bookings: new InMemoryBookingRepo([]), extractor: o.extractor === false ? undefined : extractor, mode: "prompt_only", now: () => o.now ?? NOW,
    refine: (e) => mergeVaaniEntities(e, entity),
  });
  return { repo, extractor, pipeline };
}
const rec = (id: string, o: Partial<CallRecordInput> = {}) => record(id, { vendor: "vaanivoice", ...o });
const kinds = (r: InMemoryPostCallRepo) => [...r.outbox.values()].map((x) => x.kind).sort();

describe("prompt_only: a new enquiry", () => {
  it("is saved, then handed to the router; no deal, email or note is queued from here, and the outcome is provisional", async () => {
    const t = make();
    t.extractor.set("p1", ext());
    const r = await t.pipeline.process(rec("p1"));
    expect(r).toMatchObject({ status: "processed", outcome: "review" });
    expect(kinds(t.repo)).toEqual(["call_routing"]);
    expect([...t.repo.outbox.values()][0]!.payload).toMatchObject({ vendorCallId: "p1", enquiryId: r.enquiryId });
    const enq = (await t.repo.getEnquiry(r.enquiryId!))!;
    expect(enq).toMatchObject({ fit: "fit", ruleVersion: "v1" });
    expect(await t.repo.latestEvaluation("p1", "post_call")).toMatchObject({ fit: "fit" });
    expect(await t.repo.latestEvaluation("p1", "live")).toBeNull(); // no live rules run exists in this mode
  });
  it("Vaani's entities win over the model's, and the rules run on the merged result", async () => {
    const t = make({ entity: { locality: "Kothrud", bhk: "3", carpet_area_sqft: "1400", project_type: "home" } });
    t.extractor.set("p2", ext({ location: "Baner", bhk: 2 }));
    const r = await t.pipeline.process(rec("p2"));
    expect((await t.repo.getEnquiry(r.enquiryId!))!.input).toMatchObject({ location: "Kothrud", bhk: 3 });
  });
  it("works with no model at all: only the vendor's entities, no AI cost", async () => {
    const t = make({ extractor: false, entity: { locality: "Kothrud", project_type: "home", scope: "full home", bhk: "3", carpet_area_sqft: "1400", completion_deadline: "by March", intent: "new_enquiry" } });
    const r = await t.pipeline.process(rec("p3", { vendorSummary: "3BHK in Kothrud." }));
    expect(r.status).toBe("processed");
    expect(t.repo.costs).toHaveLength(0);
    const enq = (await t.repo.getEnquiry(r.enquiryId!))!;
    expect(enq.input).toMatchObject({ location: "Kothrud", scope: "full_home", bhk: 3 });
    expect((await t.repo.getCall("p3"))!.summary).toBe("3BHK in Kothrud.");
  });
  it("with neither a model nor entities there is nothing to process: extraction_failed, flagged", async () => {
    const repo = new InMemoryPostCallRepo("pepper-0123456789ab");
    const pipeline = new PostCallPipeline({ repo, bookings: new InMemoryBookingRepo([]), mode: "prompt_only", now: () => NOW });
    expect((await pipeline.process(rec("p4"))).status).toBe("extraction_failed");
  });
  it("stores the estimated voice cost and includes it in the total", async () => {
    const t = make();
    t.extractor.set("p5", ext());
    await t.pipeline.process(rec("p5", { voiceCostInr: 38.2 }));
    const call = (await t.repo.getCall("p5"))!;
    expect(call.costVoiceInr).toBe(38.2);
    expect(call.costTotalInr).toBeCloseTo(38.2 + call.costAiInr!, 6);
  });
  it("the price scan still flags a price said by the agent, and alerts the owner (known limitation: prompt-only cannot block it live)", async () => {
    const t = make();
    t.extractor.set("p6", ext());
    const turns = [...cleanTurns(), a("It would be around 15 lakh for a 3BHK.")];
    const r = await t.pipeline.process(rec("p6", { transcript: turns }));
    expect(r.flags).toContain("price_mention");
    expect([...t.repo.outbox.values()].some((o) => o.kind === "owner_alert" && (o.payload as { flag?: string }).flag === "price_mention")).toBe(true);
  });
});

describe("prompt_only: complaints and existing clients (hard rule 4)", () => {
  const complaintTurns = [a(OPEN), c("I'm calling about my flat that Meera is designing. Work stopped two weeks ago and nobody replies."), a("I'm sorry this has happened. I've flagged it to our senior team, and a senior person will call you back.")];
  it("in hours: records a callback escalation with a 15-minute SLA, tells the design lead, and never raises 'missed complaint'", async () => {
    const t = make({ entity: { is_complaint: "yes", intent: "existing_client" } });
    t.extractor.set("c1", ext({ intent: "complaint" }));
    const r = await t.pipeline.process(rec("c1", { transcript: complaintTurns }));
    expect(r).toMatchObject({ outcome: "escalated" });
    expect(r.flags).not.toContain("missed_complaint");
    expect(await t.repo.escalationsForCall("c1")).toEqual([expect.objectContaining({ reason: "complaint", mode: "callback_sla", slaMinutes: 15 })]);
    expect(kinds(t.repo)).toEqual(["design_lead_alert"]);
    expect(kinds(t.repo)).not.toContain("call_routing");
  });
  it("after hours: callback promised for 10am next working day, and Nikhil is alerted", async () => {
    const t = make({ now: NIGHT, entity: { is_complaint: "yes" } });
    t.extractor.set("c2", ext({ intent: "complaint" }));
    const r = await t.pipeline.process(rec("c2", { transcript: complaintTurns, rangAt: "2026-10-07T16:20:00Z", answeredAt: "2026-10-07T16:20:03Z", endedAt: "2026-10-07T16:29:00Z" }));
    expect(r.outcome).toBe("escalated");
    const esc = (await t.repo.escalationsForCall("c2"))[0]!;
    expect(esc).toMatchObject({ reason: "complaint", mode: "callback_promised" });
    expect(esc.callbackDueAt!.toISOString()).toBe("2026-10-08T04:30:00.000Z"); // Thursday 10:00 IST
    expect(kinds(t.repo)).toEqual(["design_lead_alert", "nikhil_alert"]);
  });
  it("an existing client who is not complaining is still never qualified as a lead", async () => {
    const t = make({ entity: { intent: "existing_client" } });
    t.extractor.set("c3", ext({ intent: "existing_client" }));
    const r = await t.pipeline.process(rec("c3"));
    expect(r.outcome).toBe("escalated");
    expect(kinds(t.repo)).not.toContain("call_routing");
  });
  it("a caller who asked for a person goes to the front-desk queue", async () => {
    const t = make();
    t.extractor.set("c4", ext());
    const r = await t.pipeline.process(rec("c4", { signals: { wantsPerson: true } }));
    expect(r.outcome).toBe("escalated");
    expect(await t.repo.escalationsForCall("c4")).toEqual([expect.objectContaining({ reason: "human_requested", mode: "callback_sla" })]);
    expect(kinds(t.repo)).toEqual([]);                 // no routing, no booking path: a person decides
    expect((await t.repo.getEnquiry(r.enquiryId!))).not.toBeNull(); // but what they told us is kept
  });
  it("re-processing the same call never duplicates the escalation or the alerts", async () => {
    const t = make({ entity: { is_complaint: "yes" } });
    t.extractor.set("c5", ext({ intent: "complaint" }));
    await t.pipeline.process(rec("c5", { transcript: complaintTurns }));
    await t.pipeline.process(rec("c5", { transcript: complaintTurns }));
    expect(await t.repo.escalationsForCall("c5")).toHaveLength(1);
    expect(kinds(t.repo)).toEqual(["design_lead_alert"]);
  });
});
