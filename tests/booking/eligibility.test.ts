import { describe, it, expect } from "vitest";
import { isEligible, matchesArea } from "@/core/booking/eligibility";
import { pickInOrder } from "@/core/booking/rotation";
import type { Designer } from "@/core/booking/types";

const d = (o: Partial<Designer> = {}): Designer => ({ id: "d1", name: "A", areas: ["kothrud", "baner"], projectTypes: ["home", "office"], calendarId: "cal-1",
  telegramChatId: 1, isPrincipal: false, isDesignLead: false, active: true, lastAssignedAt: null, maxPerDay: null, ...o });

describe("matchesArea", () => {
  it("matches a locality inside a longer location string", () => expect(matchesArea("Kothrud, Dahanukar Colony", ["kothrud"])).toBe(true));
  it("rejects other localities", () => expect(matchesArea("Hadapsar", ["kothrud", "baner"])).toBe(false));
  it("a designer with no area list covers everywhere; a bare city name matches any designer", () => {
    expect(matchesArea("Hadapsar", [])).toBe(true);
    expect(matchesArea("Pune", ["kothrud"])).toBe(true);
    expect(matchesArea(undefined, ["kothrud"])).toBe(true);
  });
});

describe("isEligible", () => {
  it("active, in area, handles the type", () => expect(isEligible(d(), { location: "Baner", project_type: "home" })).toBe(true));
  it("inactive designers never", () => expect(isEligible(d({ active: false }), { location: "Baner", project_type: "home" })).toBe(false));
  it("wrong area or type", () => {
    expect(isEligible(d(), { location: "Hadapsar", project_type: "home" })).toBe(false);
    expect(isEligible(d({ projectTypes: ["home"] }), { location: "Baner", project_type: "office" })).toBe(false);
  });
  it("studio counts as an office", () => expect(isEligible(d({ projectTypes: ["office"] }), { location: "Baner", project_type: "studio" })).toBe(true));
  it("no calendar id => cannot check free/busy => not eligible", () => expect(isEligible(d({ calendarId: null }), { location: "Baner", project_type: "home" })).toBe(false));
  it("principal requested => only principals", () => {
    expect(isEligible(d(), { location: "Baner", project_type: "home" }, { principalOnly: true })).toBe(false);
    expect(isEligible(d({ isPrincipal: true }), { location: "Baner", project_type: "home" }, { principalOnly: true })).toBe(true);
  });
});

describe("rotation: least recently assigned first", () => {
  it("never-assigned designers go first, then oldest assignment, ties by name then id", () => {
    const list = [
      d({ id: "3", name: "C", lastAssignedAt: new Date("2026-10-05T10:00:00Z") }),
      d({ id: "1", name: "A", lastAssignedAt: new Date("2026-10-06T10:00:00Z") }),
      d({ id: "2", name: "B", lastAssignedAt: null }),
      d({ id: "4", name: "A", lastAssignedAt: null }),
    ];
    expect(pickInOrder(list).map((x) => `${x.name}${x.id}`)).toEqual(["A4", "B2", "C3", "A1"]);
  });
  it("does not mutate its input", () => {
    const list = [d({ id: "2", name: "B" }), d({ id: "1", name: "A" })];
    pickInOrder(list);
    expect(list.map((x) => x.id)).toEqual(["2", "1"]);
  });
});
