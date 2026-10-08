import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// docs/vaani-data-points.json is the exact body to PATCH onto the Vaani agent (PATCH /api/agent/{agent_id}/analysis). The names MUST be the keys
// src/adapters/voice/vaanivoice/entities.ts reads, or those fields silently stay empty. This test keeps the two from drifting apart.
const body = JSON.parse(readFileSync("docs/vaani-data-points.json", "utf8")) as { extraction: { data_collection: { enabled: boolean; data_points: { name: string; prompt: string; values?: string[]; nullable?: boolean }[] } } };
const points = body.extraction.data_collection.data_points;
const source = readFileSync("src/adapters/voice/vaanivoice/entities.ts", "utf8");
const readByCode = new Set([...source.matchAll(/\bv\.([a-z_]+)\b/g)].map((m) => m[1]!).concat([...source.matchAll(/\blow\("([a-z_]+)"\)/g)].map((m) => m[1]!)));

describe("Vaani data points", () => {
  it("are exactly the fields the code reads (23), no more and no fewer", () => {
    expect(new Set(points.map((p) => p.name))).toEqual(readByCode);
    expect(points).toHaveLength(23);
  });
  it("follow Vaani's documented shape: name <= 30 chars, a prompt, optional values and nullable", () => {
    expect(body.extraction.data_collection.enabled).toBe(true);
    for (const p of points) {
      expect(p.name, p.name).toMatch(/^[a-z][a-z_]{0,29}$/);
      expect(p.prompt.length, p.name).toBeGreaterThan(20);
      expect(Object.keys(p).every((k) => ["name", "prompt", "values", "nullable"].includes(k)), p.name).toBe(true);
    }
    expect(new Set(points.map((p) => p.name)).size).toBe(points.length);
  });
  it("the allowed values are ones the code understands", () => {
    const by = Object.fromEntries(points.map((p) => [p.name, p.values]));
    expect(by.project_type).toEqual(["home", "office", "other"]);
    expect(by.intent).toEqual(["new_enquiry", "existing_client", "other"]);
    for (const k of ["is_complaint", "owners_attend", "is_rental", "landlord_consent", "asked_price", "booked_consultation", "wants_person"]) expect(by[k], k).toEqual(["yes", "no"]);
    expect(by.service_wanted).toEqual(["design_and_execution", "design_only", "execution_only"]);
    expect(by.language).toEqual(["English", "Hindi", "Marathi"]);
  });
  it("the booking claim fields are never nullable (an unanswered claim must read as 'no')", () => {
    for (const k of ["booked_consultation", "wants_person", "is_complaint", "asked_price"]) expect(points.find((p) => p.name === k)!.nullable, k).toBe(false);
  });
  it("hard rule 1: no instruction contains a money figure, and the budget field only ever takes what the CALLER said", () => {
    for (const p of points) expect(p.prompt, p.name).not.toMatch(/₹|\brs\.?\s*\d|\d\s*(lakh|lac|crore)|per\s*sq/i);
    expect(points.find((p) => p.name === "budget_volunteered")!.prompt).toMatch(/CALLER/);
    expect(points.find((p) => p.name === "budget_volunteered")!.prompt).toMatch(/NEVER a figure spoken by the assistant/);
  });
});
