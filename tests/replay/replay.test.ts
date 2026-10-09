import { describe, it, expect } from "vitest";
import { buildCases, runAll, runCase, summarise, type CaseResult } from "./harness";

let results: CaseResult[] = [];
describe("replay harness: the 20 phone calls, the 10 hard cases, and the price gate", () => {
  it("runs every case", async () => { results = await runAll(); expect(results.length).toBe(buildCases().length); });

  it("has the shape the research plan asks for: 20 phone calls, 10 hard cases, a self-test of the price gate", () => {
    const cases = buildCases();
    expect(cases.filter((c) => c.group === "phone").map((c) => c.id)).toEqual(Array.from({ length: 20 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`));
    expect(cases.filter((c) => c.group === "hard").map((c) => c.hardCase)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cases.filter((c) => c.group === "gate").length).toBeGreaterThanOrEqual(8);
  });

  it("every phone call and hard case passes", () => {
    const bad = results.filter((r) => r.case.group !== "gate" && !r.ok).map((r) => `${r.case.id}: ${r.checks.filter((k) => !k.ok).map((k) => `${k.name} (${k.detail})`).join("; ")}`);
    expect(bad).toEqual([]);
  });

  it("THE GATE: the scripted agent never says a price-related number in any call (a leak fails the run)", () => {
    expect(summarise(results).priceLeaks).toEqual([]);
  });

  it("the gate can fail: every planted price violation (English, Hindi, Marathi, Hinglish, ranges, rates, a read-back budget) is caught", () => {
    const gate = results.filter((r) => r.case.group === "gate");
    expect(gate.length).toBeGreaterThanOrEqual(8);
    expect(gate.filter((r) => !r.observed.flags.includes("price_mention")).map((r) => r.case.id)).toEqual([]);
  });

  it("a replay that is wrong DOES fail: the harness is not a rubber stamp", async () => {
    const t01 = buildCases().find((c) => c.id === "T01")!;
    const wrong = await runCase({ ...t01, expect: { ...t01.expect, outcome: "not_fit", fit: "not_fit", booked: false } });
    expect(wrong.ok).toBe(false);
  });

  it("a price leak in an otherwise good call FAILS the whole run (the go-live gate)", async () => {
    const t01 = buildCases().find((c) => c.id === "T01")!;
    const leaky = await runCase({ ...t01, calls: [{ ...t01.calls[0]!, agentLines: ["Namaste, Aangan Studio. I'm Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?", "A 3BHK like that usually costs around 12 lakh.", "I have Thursday 8 October, 11:00 am. Booked."] }] });
    expect(leaky.ok).toBe(false);
    expect(leaky.observed.flags).toContain("price_mention");
    const s = summarise([...results.filter((r) => r.case.id !== "T01" || r.case.group !== "phone"), leaky]);
    expect(s.pass).toBe(false);
    expect(s.priceLeaks).toContain("T01");
  });
});
