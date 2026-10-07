import { describe, it, expect } from "vitest";
import { ExtractionSchema, EXTRACTION_JSON_SCHEMA, buildExtractionRequest, toFitInput, emptyExtraction } from "@/core/postcall/extraction";
import { CheckFitInput } from "@/core/rules/engine";
import { RULES_V1 } from "@/core/rules/config.v1";

const CALL = new Date("2026-09-08T10:00:00+05:30");
const sample = () => ({ ...emptyExtraction(), intent: "new_enquiry" as const, location: "Kothrud", project_type: "home" as const, scope: "full_home" as const, bhk: 3,
  carpet_sqft: 1400, deadline: { kind: "month" as const, date: null, month: 3, year: null, festival: null, value: null, unit: null, text: "by March" }, summary: "3BHK full redesign." });

describe("extraction schema", () => {
  it("accepts a complete extraction and rejects bad enums / wrong types / extra keys", () => {
    expect(ExtractionSchema.safeParse(sample()).success).toBe(true);
    expect(ExtractionSchema.safeParse({ ...sample(), project_type: "palace" }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ ...sample(), carpet_sqft: "big" }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ ...sample(), surprise: 1 }).success).toBe(false);
    const { summary: _s, ...missing } = sample();
    expect(ExtractionSchema.safeParse(missing).success).toBe(false);
  });
  it("the JSON schema sent to Gemini matches the zod schema exactly (same keys, all required, strict)", () => {
    const keys = Object.keys(ExtractionSchema.shape).sort();
    expect(Object.keys(EXTRACTION_JSON_SCHEMA.properties).sort()).toEqual(keys);
    expect([...EXTRACTION_JSON_SCHEMA.required].sort()).toEqual(keys);
    expect(EXTRACTION_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(JSON.stringify(EXTRACTION_JSON_SCHEMA)).not.toContain("$schema");
  });
  it("nullable fields use type arrays (the documented way) and enums list the same values as zod", () => {
    const p = EXTRACTION_JSON_SCHEMA.properties as Record<string, { type?: unknown; enum?: string[] }>;
    expect(p.carpet_sqft!.type).toEqual(["number", "null"]);
    expect(p.location!.type).toEqual(["string", "null"]);
    expect([...p.project_type!.enum!].sort()).toEqual([...ExtractionSchema.shape.project_type.options].sort());
    expect(p.project_type!.type).toBe("string"); // enums are never nullable: "unknown" is an explicit member
    expect([...p.intent!.enum!].sort()).toEqual([...ExtractionSchema.shape.intent.options].sort());
  });
  it("every enum the schema offers is accepted by the rules engine's own input schema", () => {
    for (const t of ExtractionSchema.shape.project_type.options.filter((x) => x !== "unknown")) expect(CheckFitInput.safeParse({ project_type: t }).success, t).toBe(true);
    for (const t of ExtractionSchema.shape.scope.options) expect(CheckFitInput.safeParse({ scope: t }).success, t).toBe(true);
  });
});

describe("toFitInput: extraction -> rules engine input (plain code, no model decisions)", () => {
  it("maps fields, drops nulls, and resolves the deadline in code", () => {
    const r = toFitInput(sample(), CALL);
    expect(r.input).toMatchObject({ location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, deadline_date: "2027-03-31" });
    expect(r.input).not.toHaveProperty("tenure");
    expect(CheckFitInput.safeParse(r.input).success).toBe(true);
  });
  it("festival deadlines use the configured calendar date, never a distance the caller stated", () => {
    const e = { ...sample(), deadline: { kind: "festival" as const, date: null, month: null, year: null, festival: "before Diwali", value: null, unit: null, text: "before Diwali, three weeks away" } };
    expect(toFitInput(e, CALL).input.deadline_date).toBe("2026-11-08");
  });
  it("an unresolvable event is reported, not guessed", () => {
    const e = { ...sample(), deadline: { kind: "festival" as const, date: null, month: null, year: null, festival: "Ganesh Chaturthi", value: null, unit: null, text: "before Ganpati" } };
    const r = toFitInput(e, CALL);
    expect(r.input.deadline_date).toBeUndefined();
    expect(r.deadlineIssue).toBe("unknown_event");
  });
  it("carries the volunteered budget, flags and caller details to the right places", () => {
    const r = toFitInput({ ...sample(), budget_inr: 150000, asked_for_price: true, frustrated: true, caller_name: "Priya", caller_email: "p@example.com", language: "hi", referrer: "Vikram Agarwal" }, CALL);
    expect(r.input).toMatchObject({ budget_inr: 150000, price_asked: true, frustrated: true, referrer: "Vikram Agarwal" });
    expect(r).toMatchObject({ callerName: "Priya", callerEmail: "p@example.com", language: "hi" });
  });
  it("'unknown' enum members become absent fields, never guesses", () => {
    const r = toFitInput({ ...sample(), project_type: "unknown", tenure: "unknown", structural_work: "unknown", decision_maker: "unknown" }, CALL);
    for (const k of ["project_type", "tenure", "structural_work"]) expect(r.input).not.toHaveProperty(k);
    expect(CheckFitInput.safeParse(r.input).success).toBe(true);
  });
  it("explicit start / possession dates pass through; month-only never becomes a start date", () => {
    const r = toFitInput({ ...sample(), start_date: "2027-01-01", possession_date: "2026-10-30" }, CALL);
    expect(r.input).toMatchObject({ start_date: "2027-01-01", possession_date: "2026-10-30" });
  });
});

describe("extraction request", () => {
  const turns = [{ speaker: "agent" as const, text: "Namaste, Aangan Studio." }, { speaker: "caller" as const, text: "Hi, 3BHK in Kothrud." }];
  const req = buildExtractionRequest(turns, CALL);
  it("labels speakers and states the call date", () => {
    expect(req.input).toContain("AGENT: Namaste, Aangan Studio.");
    expect(req.input).toContain("CALLER: Hi, 3BHK in Kothrud.");
    expect(req.input).toContain("2026-09-08");
  });
  it("tells the model to extract only, never decide, never infer festival dates, and ignore the assistant's numbers", () => {
    expect(req.system).toMatch(/extract/i);
    expect(req.system).toMatch(/do not decide|never decide/i);
    expect(req.system).toMatch(/festival/i);
    expect(req.system).toMatch(/only .*caller/i);
  });
  it("contains no thresholds, rule config or price figures (hard rule 1 / rule 2)", () => {
    const t = req.system + JSON.stringify(EXTRACTION_JSON_SCHEMA);
    expect(t).not.toMatch(/₹|\blakhs?\b|per\s*sq|pricing\.md/i);
    for (const n of Object.values(RULES_V1.budgetThresholdsInr)) expect(t).not.toContain(String(n));
    expect(t).not.toMatch(/500|3,?000|3,?300|8 weeks|eight weeks/);
  });
});
