import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { checkFit, CheckFitInput } from "@/core/rules/engine";
import { RULES_V1 } from "@/core/rules/config.v1";
import { routeCall } from "@/core/routing/route-call";
import { FIXTURES, T09 } from "../fixtures/enquiries";

const run = (f: (typeof FIXTURES)[number]) =>
  checkFit(CheckFitInput.parse(f.input), new Date(`${f.call_date}T12:00:00+05:30`), RULES_V1);

describe("go-live gate: rules engine over the 40 September enquiries", () => {
  it("all 40 transcripts exist in docs/enquiries/", () => {
    const ids = [...Array(20)].flatMap((_, i) => {
      const n = String(i + 1).padStart(2, "0");
      return [`T${n}`, ...(i < 10 ? [`W${n}`, `F${n}`] : [])];
    });
    expect(ids).toHaveLength(40);
    for (const id of ids) expect(existsSync(`docs/enquiries/${id}.md`), id).toBe(true);
  });

  describe.each(FIXTURES)("$id ($channel)", (f) => {
    const r = run(f);
    it(`is ${f.expected.result}`, () => expect(r.result, JSON.stringify(r)).toBe(f.expected.result));
    if (f.expected.reasons) it("has the expected reason codes", () => expect(r.reason_codes).toEqual(expect.arrayContaining(f.expected.reasons!)));
    if (f.expected.flags) it("has the expected flags", () => expect(r.flags).toEqual(expect.arrayContaining(f.expected.flags!)));
    if (f.expected.next_action) it("has the expected next action", () => expect(r.next_action).toBe(f.expected.next_action));
    it("never leaks a budget or threshold", () => expect(JSON.stringify(r)).not.toMatch(/\b(150000|2000000|8000000|4000000|2200000|500000|200000|400000|600000|800000|1200000)\b|lakh|₹/i));
  });

  it("T09 escalates (router, not the fit engine)", () => {
    expect(routeCall({ isExistingClient: false, ...T09 }).route).toBe("escalate_complaint");
  });
  it("T08 is a missed call: nothing to test", () => expect(existsSync("docs/enquiries/T08.md")).toBe(true));

  it("tallies match the brief: T01-T20 = 12 fit / 5 not_fit / 1 unclear (+T09 escalate, T08 missed)", () => {
    const t = FIXTURES.filter((f) => f.channel === "phone").map(run);
    expect(t.filter((r) => r.result === "fit")).toHaveLength(12);
    expect(t.filter((r) => r.result === "not_fit")).toHaveLength(5);
    expect(t.filter((r) => r.result === "unclear")).toHaveLength(1);
  });
  it("tallies match the owner's WhatsApp/form table: 12 fit / 2 not_fit / 6 unclear", () => {
    const wf = FIXTURES.filter((f) => f.channel !== "phone").map(run);
    expect(wf.filter((r) => r.result === "fit")).toHaveLength(12);
    expect(wf.filter((r) => r.result === "not_fit")).toHaveLength(2);
    expect(wf.filter((r) => r.result === "unclear")).toHaveLength(6);
  });
});
