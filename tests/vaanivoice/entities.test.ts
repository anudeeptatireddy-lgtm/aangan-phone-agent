import { describe, it, expect } from "vitest";
import { mergeVaaniEntities, parseRupees, normalizeEntities } from "@/adapters/voice/vaanivoice/entities";
import { emptyExtraction } from "@/core/postcall/extraction";

const merge = (entity: Record<string, unknown>, base = emptyExtraction()) => mergeVaaniEntities(base, entity);

describe("normalizeEntities", () => {
  it("treats NA, N/A, none, null and blanks as missing", () => {
    expect(normalizeEntities({ a: "NA", b: "N/A", c: "  ", d: null, e: "null", f: "Kothrud", g: "unknown" })).toEqual({ f: "Kothrud", g: "unknown" });
  });
});

describe("mergeVaaniEntities: Vaani wins where its value is valid, the base (Gemini) fills the gaps", () => {
  it("simple categorical fields", () => {
    const e = merge({ caller_name: "Priya Shah", locality: "Kothrud", project_type: "home", bhk: "3 BHK", carpet_area_sqft: "1,400", intent: "new_enquiry", language: "Marathi",
      referral_source: "Instagram", referrer_name: "Vikram Agarwal", owners_attend: "yes", is_rental: "yes", landlord_consent: "no", asked_price: "yes", caller_email: "Priya@Example.com" });
    expect(e).toMatchObject({ caller_name: "Priya Shah", location: "Kothrud", project_type: "home", bhk: 3, carpet_sqft: 1400, intent: "new_enquiry", language: "mr",
      source_heard: "Instagram", referrer: "Vikram Agarwal", owners_attending: true, tenure: "rented", landlord_consent: false, asked_for_price: true, caller_email: "priya@example.com" });
  });
  it("Vaani overrides Gemini when both have a value", () => {
    const base = { ...emptyExtraction(), location: "Baner", bhk: 2 };
    expect(merge({ locality: "Kothrud", bhk: "3" }, base)).toMatchObject({ location: "Kothrud", bhk: 3 });
  });
  it("a missing or unusable Vaani value leaves Gemini's value alone", () => {
    const base = { ...emptyExtraction(), location: "Baner", bhk: 2, project_type: "office" as const, owners_attending: true };
    expect(merge({ locality: "NA", bhk: "a few", project_type: "spaceship", owners_attend: "unknown" }, base)).toMatchObject({ location: "Baner", bhk: 2, project_type: "office", owners_attending: true });
  });
  it("asked_price is only ever raised, never cleared (a missed price question is worse than a false one)", () => {
    expect(merge({ asked_price: "no" }, { ...emptyExtraction(), asked_for_price: true }).asked_for_price).toBe(true);
  });
  it("is_complaint=yes makes the intent a complaint whatever else was said", () => {
    expect(merge({ intent: "new_enquiry", is_complaint: "yes" }).intent).toBe("complaint");
    expect(merge({ intent: "existing_client", is_complaint: "no" }).intent).toBe("existing_client");
  });
  it("service_wanted: design only is advisory (not a fit); both leaves the scope to the other sources", () => {
    expect(merge({ service_wanted: "design_only" }).scope).toBe("advisory_only");
    expect(merge({ service_wanted: "design_and_execution" }, { ...emptyExtraction(), scope: "full_home" }).scope).toBe("full_home");
    expect(merge({ service_wanted: "execution_only" }).notes).toMatch(/execution only/i);
  });
  it("scope text is only used when nothing better is known", () => {
    expect(merge({ scope: "full home" }).scope).toBe("full_home");
    expect(merge({ scope: "office fitout" }).scope).toBe("office_fitout");
    expect(merge({ scope: "full home" }, { ...emptyExtraction(), scope: "partial_home" }).scope).toBe("partial_home");
  });
  it("current state keywords", () => {
    expect(merge({ current_state: "lived-in" }).current_state).toBe("lived_in");
    expect(merge({ current_state: "bare shell" }).current_state).toBe("bare");
    expect(merge({ current_state: "awaiting possession" }).current_state).toBe("awaiting_possession");
  });
  it("a spoken deadline becomes a structured one only when it is clear", () => {
    expect(merge({ completion_deadline: "by March" }).deadline).toMatchObject({ kind: "month", month: 3, text: "by March" });
    expect(merge({ completion_deadline: "in 6 weeks" }).deadline).toMatchObject({ kind: "relative", value: 6, unit: "weeks" });
    expect(merge({ completion_deadline: "before Diwali" }).deadline).toMatchObject({ kind: "festival", festival: "Diwali" });
    expect(merge({ completion_deadline: "as soon as possible" }).deadline).toBeNull();
    expect(merge({ completion_deadline: "I may need it, market is slow" }).deadline).toBeNull();
    expect(merge({ completion_deadline: "before end of Jan 2027" }).deadline).toMatchObject({ kind: "month", month: 1, year: 2027 });
    const base = { ...emptyExtraction(), deadline: { kind: "date" as const, date: "2027-03-31", month: null, year: null, festival: null, value: null, unit: null, text: "31 March" } };
    expect(merge({ completion_deadline: "by April" }, base).deadline).toMatchObject({ kind: "month", month: 4 });
  });
  it("budget is read only when plainly numeric, and never overrides Gemini's", () => {
    expect(merge({ budget_volunteered: "15 lakh" }).budget_inr).toBe(1_500_000);
    expect(merge({ budget_volunteered: "around 40 lakhs" }).budget_inr).toBe(4_000_000);
    expect(merge({ budget_volunteered: "1.5 crore" }).budget_inr).toBe(15_000_000);
    expect(merge({ budget_volunteered: "flexible" }).budget_inr).toBeNull();
    expect(merge({ budget_volunteered: "15 lakh" }, { ...emptyExtraction(), budget_inr: 2_000_000 }).budget_inr).toBe(2_000_000);
  });
  it("a malformed email is ignored", () => {
    expect(merge({ caller_email: "priya at example dot com" }).caller_email).toBeNull();
  });
  it("wants_person is surfaced for routing", () => {
    expect(merge({ wants_person: "yes" }).complaint_signals).toEqual([]);
  });
});

describe("parseRupees", () => {
  it.each([["15 lakh", 1_500_000], ["2.5 lac", 250_000], ["50 thousand", 50_000], ["80k", 80_000], ["3 crore", 30_000_000], ["1500000", 1_500_000], ["Rs. 12,00,000", 1_200_000]])("%s", (s, n) => expect(parseRupees(s)).toBe(n));
  it.each(["flexible", "", "a few lakh", "NA"])("%s -> null", (s) => expect(parseRupees(s)).toBeNull());
});
