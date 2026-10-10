import { describe, it, expect } from "vitest";
import { chooseData } from "@/app/dashboard/data-choice";

describe("which data the dashboard opens on", () => {
  it("an explicit choice always wins", () => {
    expect(chooseData("demo", 5, 40)).toBe("demo");
    expect(chooseData("demo", 0, 0)).toBe("demo");
    expect(chooseData("live", 0, 40)).toBe("live");   // the Live button on an empty live database stays on live
  });
  it("no choice and a real history exists (10 or more real calls): live", () => { expect(chooseData(undefined, 10, 40)).toBe("live"); expect(chooseData(undefined, 200, 40)).toBe("live"); });
  it("no choice, only a handful of real calls (a few tests) and demo data loaded: opens on the demo so the page is not near-empty", () => { for (const n of [0, 1, 8, 9]) expect(chooseData(undefined, n, 40)).toBe("demo"); });
  it("no choice, nothing at all: live (the empty state)", () => { expect(chooseData(undefined, 0, 0)).toBe("live"); });
  it("anything else in the URL is treated as no choice", () => { expect(chooseData("garbage", 0, 40)).toBe("demo"); expect(chooseData("garbage", 20, 40)).toBe("live"); });
});
