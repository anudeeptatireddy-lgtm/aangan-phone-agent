import { describe, it, expect } from "vitest";
import { periodTitle, previousName, vs, inr, inrShort, pct, mins, dur, plural, scopeName, outcomeWord, langName } from "../../src/app/dashboard/format";

describe("period wording", () => {
  it("a whole calendar month is named, anything else is a range", () => {
    expect(periodTitle("2026-09-01", "2026-09-30")).toBe("September 2026");
    expect(periodTitle("2026-02-01", "2026-02-28")).toBe("February 2026");
    expect(periodTitle("2026-09-01", "2026-09-29")).toBe("1 Sep to 29 Sep 2026");
    expect(periodTitle("2026-09-10", "2026-09-10")).toBe("10 Sep to 10 Sep 2026");
    expect(periodTitle("2025-12-20", "2026-01-10")).toBe("20 Dec 2025 to 10 Jan 2026");
  });
  it("the comparison is named 'August' for a month and 'the 7 days before' otherwise", () => {
    const ist = (d: string) => new Date(`${d}T00:00:00+05:30`);
    expect(previousName({ prev: { kind: "month", from: ist("2026-08-01"), to: ist("2026-09-01") } })).toBe("August");
    expect(previousName({ prev: { kind: "days", from: ist("2026-09-03"), to: ist("2026-09-10") } })).toBe("the 7 days before");
  });
});

describe("vs: how a number moved", () => {
  it("up, down and same, with a tone only where a direction is clearly better", () => {
    expect(vs(10, 6)).toEqual({ text: "up 4", tone: "" });
    expect(vs(6, 10)).toEqual({ text: "down 4", tone: "" });
    expect(vs(5, 5)).toEqual({ text: "same", tone: "" });
    expect(vs(300, 400, { better: "lower", fmt: (n) => inr(n, 0) })).toEqual({ text: "down ₹100", tone: "better" });
    expect(vs(500, 400, { better: "lower" })).toMatchObject({ tone: "worse" });
    expect(vs(0, 2, { better: "higher" })).toMatchObject({ tone: "worse" });
  });
  it("says nothing when either side is missing", () => {
    expect(vs(null, 3)).toEqual({ text: "", tone: "" });
    expect(vs(3, undefined)).toEqual({ text: "", tone: "" });
  });
});

describe("plain words", () => {
  it("money, percentages and durations", () => {
    expect(inr(1234567.5)).toBe("₹12,34,567.5");
    expect(inrShort(8_400_000)).toBe("₹84.0 lakh");
    expect(inrShort(32_400_000)).toBe("₹3.24 crore");
    expect(inr(null)).toBe("n/a");
    expect(pct(0.9751)).toBe("97.5%"); expect(pct(1)).toBe("100%"); expect(pct(null)).toBe("n/a");
    expect(mins(0.4)).toBe("under a minute"); expect(mins(17.4)).toBe("17 min"); expect(mins(null)).toBe("n/a");
    expect(dur(252)).toBe("4 min 12 s"); expect(dur(9)).toBe("9 s");
  });
  it("plurals and system words become Nikhil's words", () => {
    expect(plural(1, "call")).toBe("1 call"); expect(plural(3, "call")).toBe("3 calls");
    expect(scopeName("unspecified")).toBe("Not said"); expect(scopeName(null)).toBe("Not said"); expect(scopeName("full_home")).toBe("Full home");
    expect(outcomeWord("review")).toBe("Needs a person"); expect(outcomeWord("closed_other")).toBe("Not an enquiry"); expect(outcomeWord("missed")).toBe("Missed");
    expect(langName("hi")).toBe("Hindi"); expect(langName(null)).toBeNull();
  });
});

describe("the dashboard never shows the system's own words", () => {
  it("none of the internal terms appears in any page or component text", async () => {
    const { execSync } = await import("node:child_process");
    const files = execSync("find src/app/dashboard -name '*.tsx'").toString().split("\n").filter(Boolean);
    const { readFileSync } = await import("node:fs");
    const banned = /\b(outbox|router health|handoff|extraction|webhook|SLA|pushed|price leaks?)\b/i;
    for (const f of files) {
      // only the words a reader sees: JSX text and string literals, not identifiers or comments
      const visible = [...readFileSync(f, "utf8").matchAll(/>([^<>{}\n][^<>{}]*)</g)].map((m) => m[1]!).concat([...readFileSync(f, "utf8").matchAll(/(?:title|sub|hint|placeholder|aria-label)="([^"]+)"/g)].map((m) => m[1]!));
      for (const t of visible) expect(t, f).not.toMatch(banned);
    }
  });
});
