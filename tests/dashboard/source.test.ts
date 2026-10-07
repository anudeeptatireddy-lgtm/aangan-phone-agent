import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { InMemoryPostCallRepo } from "@/server/postcall-repo";
import { InMemoryBookingRepo } from "@/server/booking-repo";
import { InMemoryDashboardSource } from "@/server/dashboard-source";
import { PgPostCallRepo } from "@/db/pg-postcall-repo";
import { PgBookingRepo } from "@/db/pg-booking-repo";
import { PgDashboardSource } from "@/db/pg-dashboard-source";
import type { DashboardSource } from "@/core/dashboard/source";
import type { PostCallRepo } from "@/core/postcall/repo";
import type { BookingRepo } from "@/core/booking/repo";
import { CheckFitInput } from "@/core/rules/engine";
import { freshDb } from "../db/helpers";
import { designer } from "../booking/helpers";

const IN = new Date("2026-10-07T05:00:00Z"), OUT = new Date("2026-09-01T05:00:00Z");
const range = [new Date("2026-10-01T00:00:00Z"), new Date("2026-10-08T00:00:00Z")] as const;

async function populate(pc: PostCallRepo) {
  const caller = await pc.upsertCaller({ phone: "+919000000031", name: "Secret Name" });
  const e = await pc.upsertEnquiry({ input: CheckFitInput.parse({ location: "Kothrud", project_type: "home" }), fit: "fit", reasonCodes: [], flags: [], ruleVersion: "v1", callerId: caller.id });
  await pc.upsertCall("in-1", { callerId: caller.id, enquiryId: e.id, rangAt: IN, durationS: 300, outcome: "booked", afterHours: true, costAiInr: 0.24, costVoiceInr: 12, costTotalInr: 12.24, postCallStatus: "processed" });
  await pc.upsertCall("out-1", { rangAt: OUT, durationS: 60, outcome: "not_fit", postCallStatus: "processed" });
  await pc.addFlag({ vendorCallId: "in-1", kind: "price_mention", detectedBy: "scan" });
  await pc.addFlag({ vendorCallId: "out-1", kind: "price_mention", detectedBy: "scan" });
}

function contract(name: string, make: () => Promise<{ src: DashboardSource; pc: PostCallRepo; bk: BookingRepo }>) {
  describe(`DashboardSource: ${name}`, () => {
    it("returns only what falls in the period, with no personal details", async () => {
      const { src, pc, bk } = await make();
      await populate(pc);
      const rows = await src.fetchRows(...range);
      expect(rows.calls).toHaveLength(1);
      expect(rows.calls[0]).toMatchObject({ outcome: "booked", durationS: 300, afterHours: true, costTotalInr: 12.24 });
      expect(rows.enquiries).toEqual([{ fit: "fit" }]);
      expect(rows.flags).toEqual([{ kind: "price_mention", resolved: false }]);
      expect(rows.handoffs).toEqual([]);
      expect(JSON.stringify(rows)).not.toMatch(/Secret Name|\+91/);
      void bk;
    });
  });
}

contract("in-memory", async () => {
  const pc = new InMemoryPostCallRepo("pepper-0123456789ab"), bk = new InMemoryBookingRepo([designer("A", "A")]);
  return { src: new InMemoryDashboardSource(pc, bk), pc, bk };
});

let db: Awaited<ReturnType<typeof freshDb>> | undefined;
contract("Postgres (PGlite)", async () => {
  db ??= await freshDb({ seed: true });
  await db.exec("truncate outbox, crm_links, usage_costs, audit_flags, escalations, rule_evaluations, calls, enquiries, callers restart identity cascade");
  const c = { query: (sql: string, p?: unknown[]) => db!.query(sql, p) as Promise<{ rows: Record<string, unknown>[] }> };
  return { src: new PgDashboardSource(c), pc: new PgPostCallRepo(c, { pepper: "pepper-0123456789ab", encKey: randomBytes(32).toString("hex") }), bk: new PgBookingRepo(c) };
});
