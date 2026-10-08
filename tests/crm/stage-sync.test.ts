import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryPostCallRepo } from "@/server/postcall-repo";
import { InMemoryBookingRepo } from "@/server/booking-repo";
import { FakeCrm } from "@/adapters/crm/fake";
import { CrmStageSync, OPEN_INTERVAL_MS, CLOSED_INTERVAL_MS } from "@/core/crm/stage-sync";
import { CheckFitInput } from "@/core/rules/engine";
import { designer } from "../booking/helpers";

const MIN = 60_000;
const T0 = new Date("2026-10-07T05:00:00Z");
const MAP = { S2: "consult_held", S3: "quote_sent" } as const;
let repo: InMemoryPostCallRepo, bookings: InMemoryBookingRepo, crm: FakeCrm, clock: { t: Date }, sync: CrmStageSync;

beforeEach(() => {
  repo = new InMemoryPostCallRepo("pepper-0123456789ab"); bookings = new InMemoryBookingRepo([designer("A", "A")]); clock = { t: T0 };
  crm = new FakeCrm({ startStageId: "S1" });
  crm.setStages("P1", [{ id: "S1", label: "Enquiry", closed: false, probability: 0.1 }, { id: "S2", label: "Consultation done", closed: false, probability: 0.3 }, { id: "S3", label: "Quote sent", closed: false, probability: 0.6 },
    { id: "S4", label: "Closed won", closed: true, probability: 1 }, { id: "S5", label: "Closed lost", closed: true, probability: 0 }, { id: "S7", label: "Site measurement", closed: false, probability: 0.4 }]);
  sync = new CrmStageSync({ repo, bookings, crm, now: () => clock.t, stageMap: { ...MAP }, startStageId: "S1", pipelineId: "P1" });
});

/** An enquiry with a HubSpot deal (created at T0) and a confirmed booking. */
async function deal(n = 1) {
  const e = await repo.upsertEnquiry({ input: CheckFitInput.parse({ location: "Kothrud", project_type: "home" }), fit: "fit", reasonCodes: [], flags: [], ruleVersion: "v1" });
  const r = await crm.createDealForEnquiry({ contact: { email: `p${n}@example.com` }, deal: { name: `Deal ${n}`, description: "x" } });
  await repo.saveCrmLink(e.id, r, T0);
  const h = await bookings.createHold({ enquiryId: e.id, designerId: "A", startsAt: new Date(T0.getTime() + 86_400_000 + n * 7_200_000), endsAt: new Date(T0.getTime() + 86_400_000 + n * 7_200_000 + 3_600_000), idempotencyKey: `k${n}`, mode: "site_visit" });
  if (!h.ok) throw new Error("hold");
  await bookings.confirm(h.booking.id, `cal-${n}`);
  return { enquiryId: e.id, dealId: r.dealId, bookingId: h.booking.id };
}
const at = (min: number) => { clock.t = new Date(T0.getTime() + min * MIN); };
const state = (id: string) => repo.getCrmLinkState(id);
const alerts = () => [...repo.outbox.values()].filter((o) => o.kind === "owner_alert");

describe("when a deal is read", () => {
  it("not before 5 minutes after it was created or last read, and then exactly once", async () => {
    await deal();
    at(4);
    expect(await sync.run()).toMatchObject({ checked: 0 });
    expect(crm.reads).toEqual([]);
    at(5);
    expect(await sync.run()).toMatchObject({ checked: 1, unchanged: 1 });
    expect(crm.reads).toHaveLength(1);
    at(8);
    expect(await sync.run()).toMatchObject({ checked: 0 });          // read at minute 5: next at 10
    expect(OPEN_INTERVAL_MS).toBe(5 * MIN); expect(CLOSED_INTERVAL_MS).toBe(6 * 60 * MIN);
  });
  it("all due deals are read in ONE request, oldest first, at most 100 a tick", async () => {
    for (let i = 1; i <= 3; i++) await deal(i);
    at(6);
    await sync.run();
    expect(crm.reads).toHaveLength(1);
    expect(crm.reads[0]).toHaveLength(3);
  });
  it("a deal that nobody has touched stays at 'new' and its read time moves on", async () => {
    const x = await deal(); at(5);
    expect(await sync.run()).toMatchObject({ updated: 0, unchanged: 1 });
    expect(await state(x.enquiryId)).toMatchObject({ stage: "new", syncedAt: clock.t });
  });
});

describe("what a designer does in HubSpot shows up here", () => {
  it("moving a deal to the studio's 'consultation done' stage sets consult_held, stamps the time, and marks the booking attended", async () => {
    const x = await deal(); crm.setDeal(x.dealId, { stageId: "S2" }); at(5);
    expect(await sync.run()).toMatchObject({ updated: 1 });
    expect(await state(x.enquiryId)).toMatchObject({ stage: "consult_held", stageChangedAt: clock.t });
    expect((await bookings.getBooking(x.bookingId))!.status).toBe("attended");
  });
  it("a quote with an amount sets quote_sent and the amount (in rupees)", async () => {
    const x = await deal(); crm.setDeal(x.dealId, { stageId: "S3", amount: "2600000.00", currency: "INR" }); at(5);
    await sync.run();
    expect(await state(x.enquiryId)).toMatchObject({ stage: "quote_sent", dealAmountInr: 2_600_000 });
    expect((await bookings.getBooking(x.bookingId))!.status).toBe("attended"); // a quote means the consultation happened
  });
  it("closed won / closed lost need no configuration: HubSpot's own probability (1.0 / 0.0) decides", async () => {
    const w = await deal(1), l = await deal(2);
    crm.setDeal(w.dealId, { stageId: "S4", amount: "900000" }); crm.setDeal(l.dealId, { stageId: "S5" }); at(5);
    await sync.run();
    expect(await state(w.enquiryId)).toMatchObject({ stage: "won", dealAmountInr: 900_000 });
    expect(await state(l.enquiryId)).toMatchObject({ stage: "lost" });
  });
  it("a designer can move a deal BACK: the stage follows HubSpot, it is not forward-only", async () => {
    const x = await deal(); crm.setDeal(x.dealId, { stageId: "S3", amount: "100" }); at(5); await sync.run();
    crm.setDeal(x.dealId, { stageId: "S2" }); at(10); await sync.run();
    expect(await state(x.enquiryId)).toMatchObject({ stage: "consult_held" });
  });
  it("the same stage read again does not move 'stage changed at'", async () => {
    const x = await deal(); crm.setDeal(x.dealId, { stageId: "S3" }); at(5); await sync.run();
    const first = (await state(x.enquiryId))!.stageChangedAt; at(10); await sync.run();
    expect((await state(x.enquiryId))!.stageChangedAt).toEqual(first);
  });
  it("a blank amount never wipes the one we have; an amount in another currency is ignored (and counted), never converted", async () => {
    const x = await deal(); crm.setDeal(x.dealId, { stageId: "S3", amount: "500000" }); at(5); await sync.run();
    crm.setDeal(x.dealId, { amount: null }); at(10); await sync.run();
    expect((await state(x.enquiryId))!.dealAmountInr).toBe(500_000);
    crm.setDeal(x.dealId, { amount: "9999", currency: "USD" }); at(15);
    expect(await sync.run()).toMatchObject({ foreignCurrency: 1 });
    expect((await state(x.enquiryId))!.dealAmountInr).toBe(500_000);
  });
  it("a deal with no currency set is taken as rupees", async () => {
    const x = await deal(); crm.setDeal(x.dealId, { stageId: "S3", amount: "250000", currency: null }); at(5); await sync.run();
    expect((await state(x.enquiryId))!.dealAmountInr).toBe(250_000);
  });
  it("won and lost deals are read every 6 hours, not every 5 minutes", async () => {
    const x = await deal(); crm.setDeal(x.dealId, { stageId: "S4" }); at(5); await sync.run();
    crm.reads.length = 0; at(60); expect(await sync.run()).toMatchObject({ checked: 0 });
    at(5 + 360); expect(await sync.run()).toMatchObject({ checked: 1 });
  });
  it("a deal deleted in HubSpot is noted and left as it was", async () => {
    const x = await deal(); crm.removeDeal(x.dealId); at(5);
    expect(await sync.run()).toMatchObject({ missing: 1, updated: 0 });
    expect(await state(x.enquiryId)).toMatchObject({ stage: "new", syncedAt: clock.t });
  });
});

describe("a HubSpot stage nobody mapped", () => {
  it("keeps the stage we had, and tells the owner ONCE per stage, naming the stage by its label and how to fix it", async () => {
    const a = await deal(1), b = await deal(2);
    crm.setDeal(a.dealId, { stageId: "S7" }); crm.setDeal(b.dealId, { stageId: "S7" }); at(5);
    expect(await sync.run()).toMatchObject({ unmapped: 2, updated: 0 });
    expect((await state(a.enquiryId))!.stage).toBe("new");
    at(10); await sync.run();
    const al = alerts();
    expect(al).toHaveLength(1);
    expect(String(al[0]!.payload.evidence)).toMatch(/Site measurement/); expect(String(al[0]!.payload.evidence)).toMatch(/HUBSPOT_STAGE_MAP/);
    expect(String(al[0]!.payload.evidence)).not.toMatch(/Deal 1|p1@example|₹|\d{5,}/);   // never a deal name, an email or an amount
    expect([...repo.outbox.values()].some((o) => o.kind === "nikhil_alert")).toBe(false);
  });
});

describe("when HubSpot cannot be read", () => {
  it("nothing is marked read (so it is retried next tick), nothing crashes, and the owner hears once a day", async () => {
    const x = await deal(); crm.failNextRead("hubspot /crm/v3/objects/deals/batch/read failed: 403 MISSING_SCOPES"); at(5);
    const r = await sync.run();
    expect(r).toMatchObject({ skipped: "hubspot_unavailable", checked: 0, updated: 0 });
    expect((await state(x.enquiryId))!.syncedAt).toEqual(T0);
    crm.failNextRead("again"); at(6); await sync.run(); crm.failNextRead("again"); at(7); await sync.run();
    expect(alerts()).toHaveLength(1);
    expect(String(alerts()[0]!.payload.evidence)).toMatch(/403 MISSING_SCOPES/);
    at(8); expect(await sync.run()).toMatchObject({ checked: 1 });           // back up: caught up at once
    clock.t = new Date(T0.getTime() + 26 * 60 * MIN); crm.failNextRead("down"); await sync.run();
    expect(alerts()).toHaveLength(2);                                         // a new day, a new alert
  });
  it("without a pipeline id the studio's own mapping and HubSpot's closed stages still... need no pipeline lookup unless a stage is unknown", async () => {
    const s2 = new CrmStageSync({ repo, bookings, crm, now: () => clock.t, stageMap: { ...MAP }, startStageId: "S1" }); // no pipelineId
    const x = await deal(); crm.setDeal(x.dealId, { stageId: "S3" }); at(5);
    expect(await s2.run()).toMatchObject({ updated: 1 });
    expect(crm.stageLookups).toBe(0);
  });
});
