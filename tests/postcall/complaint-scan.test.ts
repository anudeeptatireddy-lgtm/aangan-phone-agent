import { describe, it, expect } from "vitest";
import { scanForMissedComplaint } from "@/core/postcall/complaint-scan";
import type { CallTurn } from "@/core/postcall/types";

const caller = (text: string): CallTurn => ({ speaker: "caller", text });
const base = { designerNames: ["Aryan", "Meera"], escalated: false, intent: "new_enquiry" as const };

describe("complaint slipped through the live routing?", () => {
  it("T09-style existing-client complaint that was qualified instead of escalated -> flagged", () => {
    const r = scanForMissedComplaint({ ...base, turns: [caller("My project has been going for three months and my designer hasn't replied in five days. My designer is Aryan.")] });
    expect(r.missed).toBe(true);
    expect(r.evidence).toMatch(/my (project|designer)/i);
  });
  it("the same call, correctly escalated -> not flagged", () => {
    expect(scanForMissedComplaint({ ...base, escalated: true, turns: [caller("My designer hasn't replied in five days.")] }).missed).toBe(false);
  });
  it("the model's own intent counts too (complaint / existing_client)", () => {
    expect(scanForMissedComplaint({ ...base, intent: "complaint", turns: [caller("Hello")] }).missed).toBe(true);
    expect(scanForMissedComplaint({ ...base, intent: "existing_client", turns: [caller("Hello")] }).missed).toBe(true);
  });
  it("evidence leads with the caller's own words, and notes the model's label when both agree", () => {
    const r = scanForMissedComplaint({ ...base, intent: "complaint", turns: [caller("My designer hasn't replied in five days.")] });
    expect(r.evidence).toContain("My designer hasn't replied");
    expect(r.evidence).toContain("model intent: complaint");
  });
  it("Hinglish and Marathi complaint words", () => {
    expect(scanForMissedComplaint({ ...base, turns: [caller("mujhe shikayat karni hai")] }).missed).toBe(true);
    expect(scanForMissedComplaint({ ...base, turns: [caller("माझी तक्रार आहे")] }).missed).toBe(true);
  });
  it("a frustrated PROSPECT (T16) is not a complaint", () => {
    expect(scanForMissedComplaint({ ...base, turns: [caller("I called on Monday about a project. Someone said they'd get back to me. It's been two days.")] }).missed).toBe(false);
  });
  it("only the CALLER's words are scanned; the agent saying 'my designer' is irrelevant", () => {
    expect(scanForMissedComplaint({ ...base, turns: [{ speaker: "agent", text: "Your designer will already know." }, caller("Yes please")] }).missed).toBe(false);
  });
  it("a plain new enquiry is fine", () => {
    expect(scanForMissedComplaint({ ...base, turns: [caller("We have a 3BHK in Kothrud and want to redo the whole thing")] }).missed).toBe(false);
  });
});
