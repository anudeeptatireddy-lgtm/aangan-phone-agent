import { describe, it, expect } from "vitest";
import { resolveFestival, FESTIVAL_DATES } from "@/core/festivals";
import { checkFit, CheckFitInput } from "@/core/rules/engine";

const ist = (iso: string) => new Date(`${iso}+05:30`);

describe("festival_dates: never trust a festival's distance as the caller states it", () => {
  it("Diwali 2026 = 8 November (config)", () => {
    expect(FESTIVAL_DATES.find((f) => f.key === "diwali")).toMatchObject({ date: "2026-11-08" });
  });
  it("resolves 'before Diwali' on 8 Sep and reads it back exactly as approved", () => {
    const r = resolveFestival("I want it done before Diwali", ist("2026-09-08T10:00:00"), "en");
    expect(r).toMatchObject({ resolved: true, key: "diwali", date: "2026-11-08", days_from_now: 61 });
    expect(r.resolved && r.readback).toBe("Diwali is on 8 November, so about nine weeks from now. Is that your deadline?");
  });
  it("matches Hindi / Marathi / alternate spellings", () => {
    for (const t of ["दिवाली से पहले", "दिवाळी आधी", "before Deepavali"]) expect(resolveFestival(t, ist("2026-09-08T10:00:00"), "en").resolved, t).toBe(true);
  });
  it("localised readback", () => {
    const hi = resolveFestival("दिवाली से पहले", ist("2026-09-08T10:00:00"), "hi");
    expect(hi.resolved && hi.readback).toContain("नवंबर");
    const mr = resolveFestival("दिवाळी आधी", ist("2026-09-08T10:00:00"), "mr");
    expect(mr.resolved && mr.readback).toContain("नोव्हेंबर");
  });
  it("short distances are read back in days; singular week", () => {
    const r = resolveFestival("before diwali", ist("2026-10-30T10:00:00"), "en");
    expect(r.resolved && r.readback).toBe("Diwali is on 8 November, so about 9 days from now. Is that your deadline?");
  });
  it("a festival not in the table is not resolved (agent must ask for a calendar date)", () => {
    expect(resolveFestival("before Ganesh Chaturthi", ist("2026-09-08T10:00:00"), "en")).toMatchObject({ resolved: false, reason: "unknown_event" });
    expect(resolveFestival("I want a 3BHK redo", ist("2026-09-08T10:00:00"), "en")).toMatchObject({ resolved: false, reason: "no_event" });
  });
  it("a date already passed is not resolved", () => {
    expect(resolveFestival("before diwali", ist("2026-11-20T10:00:00"), "en")).toMatchObject({ resolved: false, reason: "date_passed" });
  });
  it("the real calendar changes the T07 outcome: on 8 Sep the confirmed date passes, on 20 Oct it does not", () => {
    const base = { location: "Kothrud", project_type: "home" as const, scope: "partial_home" as const, rooms_count: 2 };
    const run = (call: string) => {
      const d = ist(`${call}T10:00:00`);
      const f = resolveFestival("before Diwali", d, "en");
      if (!f.resolved) throw new Error("unresolved");
      return checkFit(CheckFitInput.parse({ ...base, deadline_date: f.date }), d).result;
    };
    expect(run("2026-09-08")).toBe("fit");
    expect(run("2026-10-20")).toBe("not_fit");
  });
});
