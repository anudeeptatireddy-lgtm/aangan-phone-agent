import { describe, it, expect } from "vitest";
import { buildDesignerEmail } from "@/core/outbox/designer-email";

const base = { designerName: "Meera", callerName: "Priya", location: "Kothrud", startsAt: new Date("2026-10-08T05:30:00Z"), meetingUrl: "https://app.cal.com/video/abc123", details: "3BHK full home, about 1,400 sq ft.",
  transcript: [{ speaker: "agent" as const, text: "Namaste, Aangan Studio." }, { speaker: "caller" as const, text: "We want to redo the whole flat." }] };

describe("the designer's new-project email", () => {
  it("says there is a new project, carries the meeting link, the time in IST, the details and the transcript", () => {
    const m = buildDesignerEmail(base);
    expect(m.subject).toBe("New project assigned: Priya · Kothrud");
    for (const part of ["Hi Meera", "You have a new project", "https://app.cal.com/video/abc123", "11:00 am IST", "3BHK full home", "Agent: Namaste, Aangan Studio.", "Caller: We want to redo the whole flat."]) expect(m.text, part).toContain(part);
    expect(m.html).toContain('href="https://app.cal.com/video/abc123"');
  });
  it("never invents a link: without one it says so", () => { expect(buildDesignerEmail({ ...base, meetingUrl: null }).text).toContain("No meeting link yet"); });
  it("a call without a transcript says so", () => { expect(buildDesignerEmail({ ...base, transcript: [] }).text).toContain("No transcript was available"); });
  it("everything printed into the HTML is escaped", () => {
    const m = buildDesignerEmail({ ...base, callerName: "<b>x</b>", transcript: [{ speaker: "caller", text: "<script>alert(1)</script>" }] });
    expect(m.html).not.toContain("<script>"); expect(m.html).toContain("&lt;script&gt;");
  });
  it("a redirected mail names who it was really for", () => { expect(buildDesignerEmail({ ...base, forDesigner: "Meera" }).subject).toBe("[for Meera] New project assigned: Priya · Kothrud"); });
});
