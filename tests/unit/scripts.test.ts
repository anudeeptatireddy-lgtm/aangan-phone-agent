import { describe, it, expect } from "vitest";
import { SCRIPTS, renderScript, scriptKeyForReason } from "@/core/scripts";

const PRICEY = /₹|\brs\.?\s*\d|\binr\b|\blakhs?\b|\blacs?\b|\bcrores?\b|per\s*(sq|square)|लाख|करोड़|रुपये|रुपए|कोटी|रुपया/i;

describe("approved caller-facing scripts", () => {
  const all = Object.entries(SCRIPTS).flatMap(([k, byLocale]) => Object.entries(byLocale).map(([loc, s]) => ({ k, loc, s })));
  it("every script exists in English, Hindi and Marathi", () => {
    for (const byLocale of Object.values(SCRIPTS)) expect(Object.keys(byLocale).sort()).toEqual(["en", "hi", "mr"]);
  });
  it("no script contains a price, rate, rupee or lakh word (hard rule 1)", () => {
    for (const { k, loc, s } of all) expect(s.text, `${k}/${loc}`).not.toMatch(PRICEY);
  });
  it("the price explanation contains no digits at all, in any language", () => {
    for (const loc of ["en", "hi", "mr"] as const) expect(SCRIPTS.price_explanation[loc].text).not.toMatch(/[0-9०-९]/);
  });
  it("native-review status is tracked; HI/MR price explanation is 'approved_pending_native_check'", () => {
    expect(SCRIPTS.price_explanation.hi.status).toBe("approved_pending_native_check");
    expect(SCRIPTS.price_explanation.mr.status).toBe("approved_pending_native_check");
    expect(SCRIPTS["not_fit.area"].en.status).toBe("approved");
    expect(SCRIPTS["not_fit.area"].hi.status).toBe("draft_pending_native_review");
  });
  it("owner-approved wording for 'I want a person' and failed transfers (EN approved, HI/MR pending native review)", () => {
    expect(SCRIPTS.human_requested_in_hours.en).toEqual({ text: "Of course. I'm connecting you to our front desk now.", status: "approved" });
    expect(SCRIPTS.complaint_transfer_failed.en.text).toBe("I couldn't connect you just now. I've alerted our senior team, and a senior person will call you back within 15 minutes.");
    expect(SCRIPTS.human_requested_transfer_failed.en.text).toBe("I couldn't connect you just now. I've asked our front desk to call you back within 30 minutes.");
    expect(SCRIPTS.robot_confirm.en.text).toBe("Yes, I'm Aangan's virtual assistant. I can help you book a consultation, or connect you to a person. Whichever you prefer.");
    for (const k of ["human_requested_in_hours", "human_requested_transfer_failed", "human_requested_after_hours", "complaint_transfer_failed", "robot_confirm"] as const) {
      expect(SCRIPTS[k].en.status, k).toBe("approved");
      expect(SCRIPTS[k].hi.status, k).toBe("draft_pending_native_review");
      expect(SCRIPTS[k].mr.status, k).toBe("draft_pending_native_review");
    }
  });
  it("after-hours person script renders the morning callback phrase", () => {
    expect(renderScript("human_requested_after_hours", "en", { day: "Thursday" })).toContain("so they call you on Thursday morning, or I can book your consultation myself right now. Which would you prefer?");
    expect(renderScript("human_requested_after_hours", "en", { when: "today" })).toContain("call you this morning");
    expect(renderScript("human_requested_after_hours", "hi", { day: "Thursday" })).toContain("गुरुवार को सुबह");
    expect(renderScript("human_requested_after_hours", "mr", { day: "Thursday" })).toContain("गुरुवारी सकाळी");
  });
  it("never promises Nikhil by name", () => {
    for (const { k, loc, s } of all) expect(s.text, `${k}/${loc}`).not.toMatch(/nikhil|निखिल/i);
  });
  it("maps reason codes to script keys", () => {
    expect(scriptKeyForReason("area_outside_service")).toBe("not_fit.area");
    expect(scriptKeyForReason("timeline_too_short")).toBe("not_fit.timeline");
  });
  it("renders the callback day (today / weekday name) per language", () => {
    expect(renderScript("expect_call", "en", { when: "today" })).toContain("today");
    expect(renderScript("expect_call", "en", { when: "day", day: "Thursday" })).toContain("on Thursday");
    expect(renderScript("complaint_after_hours", "en", { day: "Thursday" })).toContain("by 10am on Thursday");
    expect(renderScript("expect_call", "hi", { when: "day", day: "Thursday" })).toContain("गुरुवार");
    expect(renderScript("expect_call", "mr", { when: "today" })).toContain("आज");
  });
});
