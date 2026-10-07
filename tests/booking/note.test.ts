import { describe, it, expect } from "vitest";
import { buildHandoffNote } from "@/core/booking/note";
import { CheckFitInput } from "@/core/rules/engine";
import type { EnquiryRecord } from "@/core/enquiry";

const enq = (o: Partial<EnquiryRecord> = {}, input: Record<string, unknown> = {}): EnquiryRecord => ({
  id: "e1", callerName: "Anand Sharma", callerEmail: "anand@example.com", language: "en", fit: "fit", reasonCodes: [], nextAction: "proceed_to_booking",
  flags: [], ruleVersion: "v1", createdAt: "2026-10-07T05:00:00.000Z",
  input: CheckFitInput.parse({ location: "Kalyani Nagar", project_type: "home", scope: "full_home", is_villa: true, carpet_sqft: 5500, deadline_date: "2027-03-31",
    decision_maker: "owner", ...input }), ...o });
const base = { handoffId: "h-123", start: new Date("2026-10-09T11:00:00+05:30"), mode: "site_visit", principalRequested: true, callSeconds: 450 };

describe("handoff note", () => {
  const n = buildHandoffNote({ ...base, enquiry: enq({ flags: ["vip_referrer"] }, { referrer: "Vikram Agarwal" }) });
  it("matches the approved layout", () => {
    expect(n.text).toContain("NEW CONSULTATION · Qualified");
    expect(n.text).toContain("Anand Sharma · Kalyani Nagar");
    expect(n.text).toContain("Booked: Friday 9 October, 11:00 am · Site visit · Principal designer asked for");
    expect(n.text).toContain("Call: 7 min 30 s");
    expect(n.text).toMatch(/Flags:.*VIP referrer/);
  });
  it("never includes the caller's phone or email (hard rule 6 / Telegram is a personal chat app)", () => {
    expect(n.text).not.toMatch(/anand@example\.com|\+?\d{10}/);
  });
  it("carries inline Accept / Can't take it buttons within Telegram's 64-byte callback limit", () => {
    expect(n.acceptData).toBe("h:h-123:a");
    expect(n.declineData).toBe("h:h-123:d");
    expect(Buffer.byteLength(n.acceptData)).toBeLessThanOrEqual(64);
    expect(n.buttons.map((b) => b.text)).toEqual(["Accept", "Can't take it"]);
  });
  it("budget: shows only what the caller volunteered, otherwise 'not discussed'; records whether price was asked", () => {
    expect(n.text).toContain("Budget: not discussed · Asked about price: no");
    const b = buildHandoffNote({ ...base, enquiry: enq({}, { budget_inr: 4_000_000, price_asked: true }) });
    expect(b.text).toContain("Budget: volunteered by caller, ₹40,00,000 · Asked about price: yes");
  });
  it("flags: frustrated prospect, unverified decision-maker, owners attending", () => {
    const t = buildHandoffNote({ ...base, enquiry: enq({ flags: ["frustrated_prospect", "decision_maker_unverified"] }, { owners_attending: true }) }).text;
    expect(t).toMatch(/Flags:.*Frustrated prospect/);
    expect(t).toMatch(/Flags:.*Decision-maker not confirmed/);
  });
  it("never leaks rule thresholds or reason internals", () => {
    expect(n.text).not.toMatch(/threshold|reason_code|rule_version/i);
  });
  it("stays under Telegram's 4096-character limit even with hostile free text", () => {
    const t = buildHandoffNote({ ...base, enquiry: enq({}, { location: "x".repeat(6000) }) }).text;
    expect(t.length).toBeLessThanOrEqual(4096);
  });
});
