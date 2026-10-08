import { describe, it, expect, beforeAll } from "vitest";
import { september, SEP, World } from "../dashboard/fixture";
import { funnel, pipelineValue } from "@/db/dash-metrics";
import { designerStats } from "@/db/dash-calls";
import { CrmStageSync } from "@/core/crm/stage-sync";
import { PgPostCallRepo } from "@/db/pg-postcall-repo";
import { PgBookingRepo } from "@/db/pg-booking-repo";
import { FakeCrm } from "@/adapters/crm/fake";
import { PEPPER, ENC_KEY } from "../dashboard/fixture";

// The point of the whole sync: after a designer moves a deal in HubSpot, the dashboard's later funnel steps, the quote values and the designers' page have data.
let w: World; let ids: Record<string, string>;
const q = { ...SEP, demo: false };
const stage = (f: Awaited<ReturnType<typeof funnel>>, k: string) => f.stages.find((s) => s.key === k)!;

beforeAll(async () => {
  ({ w, ids } = await september());
  // start from "nothing has reached us yet": every deal at 'new', no amounts, no consultation held
  await w.db.query("update crm_links set stage='new', deal_amount_inr=null, synced_at='2026-09-01T00:00:00Z'");
  await w.db.query("update bookings set status='confirmed' where status='attended'");
}, 120_000);

describe("before the sync: honest 'no data yet'", () => {
  it("stages 8-10 have no source, and the pipeline has no values", async () => {
    const f = await funnel(w.db, q);
    for (const k of ["held", "quoted", "won"]) expect(stage(f, k)).toMatchObject({ hasData: false, count: null });
    expect((await pipelineValue(w.db, q)).hasData).toBe(false);
  });
});

describe("after the designers moved their deals in HubSpot and the tick read them", () => {
  it("the funnel, the quote values and the designers' page fill in, from the Postgres tables", async () => {
    const links = (await w.db.query("select enquiry_id, hubspot_deal_id from crm_links")).rows as { enquiry_id: string; hubspot_deal_id: string }[];
    const dealOf = (enq: string) => links.find((l) => l.enquiry_id === enq)!.hubspot_deal_id;
    const crm = new FakeCrm({ startStageId: "S1" });
    for (const l of links) crm.setDealRaw({ dealId: l.hubspot_deal_id, pipelineId: "P1", stageId: "S1", amount: null, currency: null });
    crm.setDeal(dealOf(ids.E1!), { stageId: "S9", amount: "1200000.00", currency: "INR" });   // closed won
    crm.setDeal(dealOf(ids.E2!), { stageId: "S3", amount: "800000" });                          // quote sent
    crm.setDeal(dealOf(ids.E4!), { stageId: "S2" });                                            // consultation done
    crm.setStages("P1", [{ id: "S1", label: "Enquiry", closed: false, probability: 0.1 }, { id: "S2", label: "Consultation done", closed: false, probability: 0.3 },
      { id: "S3", label: "Quote sent", closed: false, probability: 0.6 }, { id: "S9", label: "Closed won", closed: true, probability: 1 }]);
    const sync = new CrmStageSync({ repo: new PgPostCallRepo(w.db, { pepper: PEPPER, encKey: ENC_KEY }), bookings: new PgBookingRepo(w.db), crm, now: () => new Date("2026-10-07T06:00:00Z"),
      stageMap: { S2: "consult_held", S3: "quote_sent" }, startStageId: "S1", pipelineId: "P1" });

    expect(await sync.run()).toMatchObject({ checked: 3, updated: 3, unmapped: 0 });

    const f = await funnel(w.db, q);
    expect([stage(f, "held"), stage(f, "quoted"), stage(f, "won")].map((s) => [s.hasData, s.count])).toEqual([[true, 3], [true, 2], [true, 1]]);
    expect(await pipelineValue(w.db, q)).toEqual({ hasData: true, wonValueInr: 1_200_000, wonCount: 1, quotedValueInr: 800_000, quotedCount: 1, totalValueInr: 2_000_000 });
    const d = await designerStats(w.db, q);
    expect(d.find((x) => x.name === "Asha")).toMatchObject({ consultations: 1, quotes: 1, wins: 1 });
    expect(d.find((x) => x.name === "Bela")).toMatchObject({ consultations: 2, quotes: 1, wins: 0 });
    expect((await w.db.query("select status from bookings where id=$1", [ids.B1])).rows[0]).toEqual({ status: "attended" });
  });
  it("reading again changes nothing, and a deal that stays put is not counted twice", async () => {
    const before = (await w.db.query("select enquiry_id, stage, deal_amount_inr, stage_changed_at from crm_links order by enquiry_id")).rows;
    const crm = new FakeCrm(); crm.setStages("P1", []);
    const sync = new CrmStageSync({ repo: new PgPostCallRepo(w.db, { pepper: PEPPER, encKey: ENC_KEY }), bookings: new PgBookingRepo(w.db), crm, now: () => new Date("2026-10-07T07:00:00Z"), stageMap: {}, pipelineId: "P1" });
    expect(await sync.run()).toMatchObject({ checked: 2, updated: 0, missing: 2 });  // the won deal is not due for 6 hours; this fake knows none of the other two: noted, nothing changed
    expect((await w.db.query("select enquiry_id, stage, deal_amount_inr, stage_changed_at from crm_links order by enquiry_id")).rows).toEqual(before);
  });
  it("demo deals are never read by the live sync", async () => {
    await w.demo(true);
    const e = await w.enquiry({ fit: "fit" }); await w.crm(e, "new", null, "demo-deal");
    await w.db.query("update crm_links set synced_at='2020-01-01' where hubspot_deal_id='demo-deal'");
    await w.demo(false);
    const due = await new PgPostCallRepo(w.db, { pepper: PEPPER, encKey: ENC_KEY }).dueCrmLinks(new Date("2026-10-07T09:00:00Z"), 100);
    expect(due.map((x) => x.dealId)).not.toContain("demo-deal");
  });
});
