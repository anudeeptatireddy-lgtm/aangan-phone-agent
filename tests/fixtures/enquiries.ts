// Structured readings of the 40 September 2026 transcripts in docs/enquiries/ (what extraction should produce).
// Expected classes: phone T01-T20 from the brief; W/F confirmed by the project owner (rule_versions v1 answers, A10).
// call_date is the IST date of the enquiry. Month-only deadlines = last day of the stated month.
import type { Intent } from "@/core/routing/route-call";

export interface Fixture {
  id: string;
  channel: "phone" | "whatsapp" | "form";
  call_date: string;
  input: Record<string, unknown>;
  expected: { result: "fit" | "not_fit" | "unclear"; reasons?: string[]; flags?: string[]; next_action?: string };
  note?: string;
}

const T = (id: string, call_date: string, input: Record<string, unknown>, expected: Fixture["expected"], note?: string): Fixture =>
  ({ id, channel: "phone", call_date, input, expected, note });
const W = (id: string, call_date: string, input: Record<string, unknown>, expected: Fixture["expected"], note?: string): Fixture =>
  ({ id, channel: "whatsapp", call_date, input, expected, note });
const F = (id: string, call_date: string, input: Record<string, unknown>, expected: Fixture["expected"], note?: string): Fixture =>
  ({ id, channel: "form", call_date, input, expected, note });

export const FIXTURES: Fixture[] = [
  // ---- phone ----
  T("T01", "2026-09-02", { location: "Kothrud, Dahanukar Colony", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, tenure: "owned", deadline_date: "2027-03-31", decision_maker: "owner", referrer: "Shruti Joshi" }, { result: "fit", next_action: "proceed_to_booking" }),
  T("T02", "2026-09-03", { location: "Wakad", project_type: "home", scope: "full_home", bhk: 2, carpet_sqft: 950, deadline_date: "2026-11-30", price_asked: true }, { result: "fit", flags: ["price_asked", "decision_maker_unverified"] }, "moves in November; asked for a price twice"),
  T("T03", "2026-09-03", { location: "Nashik", project_type: "home", scope: "single_room" }, { result: "not_fit", reasons: ["area_outside_service"] }),
  T("T04", "2026-09-04", { project_type: "home", scope: "advisory_only", exploring_only: true }, { result: "not_fit", reasons: ["advisory_only"] }, "no location given; not_fit still wins"),
  T("T05", "2026-09-05", { location: "Koregaon Park", project_type: "home", scope: "full_home", bhk: 4, carpet_sqft: 2400, deadline_date: "2027-02-28", referrer: "Vikram Agarwal" }, { result: "fit", flags: ["vip_referrer"] }),
  T("T06", "2026-09-05", { location: "Baner", project_type: "office", scope: "office_fitout", carpet_sqft: 800, deadline_date: "2026-12-31", decision_maker: "owner" }, { result: "fit" }),
  T("T07", "2026-09-08", { project_type: "home", scope: "partial_home", rooms_count: 2, deadline_date: "2026-09-29" }, { result: "not_fit", reasons: ["timeline_too_short"], next_action: "offer_later_start" },
    "Transcript says Diwali is 'about three weeks away' (=> 29 Sep). The research PDF dates Diwali 8 Nov 2026 (8+ weeks), which would PASS the 8-week rule. Source inconsistency flagged to the owner; fixture follows the transcript."),
  // T08: missed call 10:47pm, no content — nothing to test.
  // T09: escalation, routed by routeCall (see enquiries.fixtures.test.ts).
  T("T10", "2026-09-11", { location: "Kharadi", project_type: "home", scope: "partial_home", rooms_count: 2, bhk: 1, carpet_sqft: 550, budget_inr: 150_000 }, { result: "unclear", reasons: ["budget_below_scope"], next_action: "human_review" }, "budget stated as 1 to 1.5 lakh maximum; upper figure used"),
  T("T11", "2026-09-12", { location: "Baner", project_type: "home", scope: "partial_home", rooms_count: 3, bhk: 2, tenure: "rented", landlord_consent: true, structural_work: "none" }, { result: "fit" }),
  T("T12", "2026-09-15", { location: "Kalyani Nagar", project_type: "home", scope: "full_home", is_villa: true, carpet_sqft: 5500, deadline_date: "2027-03-31", decision_maker: "owner" }, { result: "fit" }),
  T("T13", "2026-09-16", { location: "Aundh", project_type: "home", scope: "partial_home", rooms_count: 3, bhk: 3, carpet_sqft: 1100, price_asked: true }, { result: "fit", flags: ["price_asked"] }),
  T("T14", "2026-09-17", { location: "Hadapsar", project_type: "home", scope: "full_home", bhk: 3, decision_maker: "family_on_behalf", owners_attending: true }, { result: "fit" }),
  T("T15", "2026-09-18", { location: "Undri", project_type: "home", scope: "full_home", bhk: 2, carpet_sqft: 875, possession_date: "2026-10-30", decision_maker: "owner" }, { result: "fit" }, "possession in ~6 weeks is a start date, not a deadline"),
  T("T16", "2026-09-19", { location: "Viman Nagar", project_type: "home", scope: "full_home", bhk: 3, frustrated: true }, { result: "fit", flags: ["frustrated_prospect"] }, "transcript has no scope; a live call re-asks it. Full home assumed per the brief's expected class."),
  T("T17", "2026-09-22", { location: "Pimple Saudagar", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1050, deadline_date: "2027-03-31" }, { result: "fit" }, "two calls merged into one record"),
  T("T18", "2026-09-23", { project_type: "office", scope: "office_fitout", carpet_sqft: 180 }, { result: "not_fit", reasons: ["size_too_small"] }, "coworking pod"),
  T("T19", "2026-09-24", { location: "Koregaon Park", project_type: "restaurant" }, { result: "not_fit", reasons: ["type_not_served"] }),
  T("T20", "2026-09-25", { location: "Magarpatta", project_type: "home", scope: "full_home", bhk: 2, carpet_sqft: 900, start_date: "2027-01-01", decision_maker: "owner", owners_attending: true }, { result: "fit" }),
  // ---- WhatsApp ----
  W("W01", "2026-09-04", { location: "Viman Nagar", project_type: "home", scope: "full_home", bhk: 4, carpet_sqft: 1800, referrer: "Sonali Patel" }, { result: "fit" }),
  W("W02", "2026-09-08", { project_type: "home", bhk: 2, price_asked: true }, { result: "unclear", next_action: "ask_caller" }, "'how much per sq ft for a 2bhk' and nothing else"),
  W("W03", "2026-09-12", { location: "Pimple Nilakh", project_type: "home", scope: "full_home", bhk: 3 }, { result: "fit" }),
  W("W04", "2026-09-15", { location: "Chinchwad", project_type: "office", scope: "office_fitout", carpet_sqft: 1200, deadline_date: "2027-01-31" }, { result: "fit" }),
  W("W05", "2026-09-20", { location: "Baner", project_type: "home", bhk: 2 }, { result: "unclear", next_action: "ask_caller" }, "scope never stated"),
  W("W06", "2026-09-17", { location: "Koregaon Park", project_type: "home", scope: "full_home", bhk: 3, possession_date: "2026-10-15", referrer: "Ashok Bhosale" }, { result: "fit" }),
  W("W07", "2026-09-05", { location: "Kothrud", project_type: "gym", carpet_sqft: 2500 }, { result: "not_fit", reasons: ["type_not_served"] }),
  W("W08", "2026-09-10", { location: "Aundh", project_type: "home", scope: "full_home", bhk: 2, carpet_sqft: 850, frustrated: true }, { result: "fit", flags: ["frustrated_prospect"] }),
  W("W09", "2026-09-25", { location: "Aundh", project_type: "home", scope: "partial_home", rooms_count: 2, bhk: 3 }, { result: "fit" }, "full execution confirmed"),
  W("W10", "2026-09-22", { location: "Hinjewadi", project_type: "home", bhk: 3, exploring_only: true }, { result: "unclear" }),
  // ---- web form ----
  F("F01", "2026-09-01", { location: "Kalyani Nagar, Pune", project_type: "home", scope: "full_home", bhk: 2, carpet_sqft: 920, deadline_date: "2027-02-28", owners_attending: true, decision_maker: "owner" }, { result: "fit" }),
  F("F02", "2026-09-04", { location: "Baner, Pune", project_type: "home", scope: "partial_home", rooms_count: 2, bhk: 3, carpet_sqft: 1100 }, { result: "fit" }),
  F("F03", "2026-09-06", { location: "Talegaon Dabhade, near Pune", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, budget_inr: 2_000_000 }, { result: "unclear", reasons: ["edge_location"] }),
  F("F04", "2026-09-09", { location: "Pune", price_asked: true }, { result: "unclear", next_action: "ask_caller" }, "'please call me', cost question"),
  F("F05", "2026-09-11", { location: "Hinjewadi Phase 1, Pune", project_type: "office", scope: "office_fitout", carpet_sqft: 2200, deadline_date: "2027-01-15", budget_inr: 8_000_000, decision_maker: "employee" }, { result: "fit", flags: ["decision_maker_unverified"] }),
  F("F06", "2026-09-14", { location: "NIBM Road, Pune", project_type: "home", scope: "full_home", bhk: 4, carpet_sqft: 1950, start_date: "2027-02-01", budget_inr: 4_000_000 }, { result: "fit" }),
  F("F07", "2026-09-16", { location: "Pune", price_asked: true }, { result: "unclear" }, "wants a per sq ft rate emailed"),
  F("F08", "2026-09-18", { location: "Wakad, Pune", project_type: "home", scope: "partial_home", rooms_count: 2, bhk: 2, carpet_sqft: 875, deadline_date: "2026-10-09", budget_inr: 500_000 }, { result: "not_fit", reasons: ["timeline_too_short"], next_action: "offer_later_start" }),
  F("F09", "2026-09-20", { location: "Kondhwa, Pune", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1150, deadline_date: "2027-03-31" }, { result: "fit" }),
  F("F10", "2026-09-26", { location: "Aundh, Pune", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1300, budget_inr: 2_200_000, owners_attending: true, decision_maker: "owner" }, { result: "fit" }),
];

// T09: existing client, no reply from designer for 5 days (escalate).
export const T09 = {
  utterance: "I need to speak to someone right now. My project has been going for three months and my designer hasn't replied in five days. This is not acceptable. My designer is Aryan. Flat in Viman Nagar.",
  intent: "unknown" as Intent,
  designerNames: ["Aryan"],
};
