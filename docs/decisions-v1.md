# Decisions v1 (rule_versions v1) — approved by the project owner, founder's office, 2026-10-07
**Nikhil's sign-off is still required before production.** Implemented in `src/core/rules/config.v1.ts` (typed, versioned) and
`src/core/rules/engine.ts`. Budget thresholds were set by the founder's office, not taken from pricing.md; they live in
config only and are never put in a prompt, script, log or tool response.

## A. Rules
| # | Decision | Where |
|---|---|---|
| 1 | Approved locality registry (served / edge / excluded); Kharadi added; **anything not on it → unclear**. Talegaon = edge → unclear. Nashik, Mumbai, Lonavala = not_fit. A bare "Pune"/"PCMC" is accepted; "Unknown-name, Pune" is not. | `config.v1.ts` `localities` |
| 2 | **≥ 8 weeks from call date to the caller's completion deadline** (not start date). On timeline not_fit the agent offers a later start; if accepted it captures the new deadline and re-runs `check_fit`. `details.earliest_workable_deadline` = call date + 8 weeks. | engine `timeline` |
| 3 | Volunteered budget below threshold → **unclear** (never decline). One room 2L, two rooms 4L, 1BHK 4L, 2BHK 6L, 3BHK 8L, 4BHK/villa 12L, office < 1,000 × carpet sq ft. Budget is consumed in code, never echoed. | `budgetThresholdsInr` |
| 4 | Commercial size: < 500 not_fit; 500–3,000 fit; 3,001–3,300 unclear; > 3,300 not_fit. Residential: no size rule. | `size` |
| 5 | Ask on the call; owners won't attend → unclear. Unknown decision-maker → fit + flag `decision_maker_unverified`. | engine `decisionMaker` |
| 6 | Rentals only: structural work → first offer a reversible design (`offer_reversible_design`); not_fit only if the caller insists. Landlord consent unknown → ask; not obtained → unclear. Owned homes: structural work allowed. | engine `rental` |
| 7 | Studios → fit (office type); retail → not_fit; 1BHK full home → fit; wardrobe-only → not_fit; **clinics → unclear; kitchen-only → unclear**. | `types`, engine `scope` |
| 8 | Precedence **not_fit > unclear > fit** (with the A2 re-run). All reason codes returned. | engine |
| 9 | Frustrated prospects (T16, W08): qualify and book, flag `frustrated_prospect`. Complaints = existing/past projects only. | engine flag + prompt |
| 10 | Expected classes for W/F confirmed: 12 fit / 2 not_fit / 6 unclear. | `tests/fixtures/enquiries.ts` |

## B. Wording
`src/core/scripts.ts` (EN/HI/MR). English approved. Price explanation has **no digits at all** (tested), HI/MR supplied by the
owner, status `approved_pending_native_check`. All other HI/MR lines are my drafts, status `draft_pending_native_review`.
The front desk must native-check Hindi and Marathi before go-live. "Never promise Nikhil by name" is tested.

## C. Operations (status)
| Decision | Status |
|---|---|
| Mon–Fri 10:00–19:00 for transfers, 30-min reassign clock, review queue; Saturday consults bookable if the calendar is free | Hours config: **done**. Booking/reassign: Sessions 3/5. |
| "I want a person" → front desk (`FRONT_DESK_NUMBER`); complaints → design lead (`DESIGN_LEAD_NUMBER`), fallback front desk; no number configured → callback, never a fake transfer | **Done + tested** |
| Escalation SLA measured from 10:00 next working day for after-hours complaints | Metric: Session 6 |
| Designer roster: CSV import + admin edit; seed 3 test designers (principal, design lead) with the owner's Telegram chat id and a test calendar; rotation = least-recently-assigned eligible | Sessions 3/5 (needs chat id + test calendar from the owner) |
| Existing clients = HubSpot contacts with lifecycle stage "customer" + active-project flag; `lookup_caller` queries HubSpot; seed Sheetal Deshpande (T09) on a test number | Session 5 (HubSpot). Today: in-memory repo. |
| Studio number: conditional forwarding of the existing number (pilot: after hours + no answer); the Vaani number is never published | Ops, no code |
| VIP referrers: config table, seeded Vikram Agarwal; flag + notify Nikhil, rules unchanged | Flag **done**; notify: Session 5 |
| Recordings deleted after 90 days; fields + transcript stay with the HubSpot record; delete everything on request | Schema fields added; job: Session 4/5 |

## D. Project owner
Rules engine first (done). Supabase Mumbai, free for build/pilot, Pro before rollout (cost model to be updated). GitHub: private
repo to be created by the owner. Schema v2 conditions: see the end of `schema-proposal.md`. **Vaani: the answer promised "below"
was not in the message, so the Vaani items in `docs/vaani-findings.md` are still open.**

## Things I found or assumed while implementing (please confirm)
1. **T07 source inconsistency.** The transcript says Diwali is "about three weeks away" on 8 Sep; the research PDF dates Diwali 8 Nov 2026
   (8+ weeks), which would **pass** the 8-week rule. The fixture follows the transcript.
2. **Transfer failure in working hours** uses Nikhil's wording "a senior person will call you by 10am {next working day}", so a
   complaint whose live transfer fails at noon waits until tomorrow. The 15-minute SLA suggests a faster fallback. Confirm.
3. Not specified, so I assumed: partial home with 3+ rooms uses the two-room threshold (flagged `partial_rooms_threshold_assumed`);
   a full home with unknown BHK uses the 1BHK threshold (flagged `budget_unassessed`); an unknown decision-maker on an office or an
   employee caller is flagged, not blocked.
4. "I want a person" scripts (in hours / after hours) were not supplied; mine are `draft_not_approved`.
5. T16's transcript has no scope; its fixture assumes a full home to match the expected class (a live call would re-ask).
6. Hindi/Marathi drafts avoid gendered first-person verbs so they work for either voice persona.
