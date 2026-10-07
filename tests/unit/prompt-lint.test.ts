import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Hard rule 1: the agent prompt must carry no price-related figures or vocabulary of amounts.
const prompt = readFileSync("agent/prompt.md", "utf8");

describe("agent/prompt.md", () => {
  it("contains no rupee amounts, lakh/crore, or per-sq-ft rates", () => {
    expect(prompt).not.toMatch(/₹|\brs\.?\s*\d|\binr\b|\blakhs?\b|\blacs?\b|\bcrores?\b|per\s*(sq|square)|\/\s*sq/i);
  });
  it("has the mandatory disclosure line (hard rule 3)", () => {
    expect(prompt).toMatch(/virtual assistant/i);
    expect(prompt).toMatch(/recorded/i);
  });
  it("tells the agent never to call outbound (hard rule 5) and to use tools for decisions (hard rule 2)", () => {
    expect(prompt).toMatch(/never (dial|call out|place outbound)/i);
    expect(prompt).toMatch(/check_fit/);
  });
  it("never references pricing.md", () => expect(prompt).not.toMatch(/pricing\.md/i));
});
