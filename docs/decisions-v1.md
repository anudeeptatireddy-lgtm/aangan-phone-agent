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
owner, status `approved_pending_native_check`. All other HI/MR lines are build-team drafts, status `draft_pending_native_review`.
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
2. ~~Transfer failure in working hours~~ Resolved in round 2 (below).
3. Not specified, so I assumed: partial home with 3+ rooms uses the two-room threshold (flagged `partial_rooms_threshold_assumed`);
   a full home with unknown BHK uses the 1BHK threshold (flagged `budget_unassessed`); an unknown decision-maker on an office or an
   employee caller is flagged, not blocked.
4. ~~"I want a person" scripts~~ Resolved in round 2 (below).
5. T16's transcript has no scope; its fixture assumes a full home to match the expected class (a live call would re-ask).
6. Hindi/Marathi drafts avoid gendered first-person verbs so they work for either voice persona.

## Round 2 — answers from the project owner, 2026-10-07 (Nikhil production sign-off still pending)
Provenance: all wording and rules below are recorded as **approved by project owner**.

1. **T07 confirmed** as not_fit. Fixtures test the rule against what the caller said ("about three weeks"); the real-calendar mismatch
   (Diwali 2026 = 8 Nov) is a case-authoring artifact. **New for live calls:** never trust a festival's distance as the caller states it.
   `src/core/festivals.ts` holds `festival_dates` (Diwali 2026 = 8 Nov; more rows only when the owner supplies dates). Tool `resolve_date`
   resolves a named festival/event, returns the read-back ("Diwali is on 8 November, so about nine weeks from now. Is that your deadline?"),
   and the agent runs `check_fit` on the confirmed date. Events with no approved date (e.g. Ganesh Chaturthi, weddings) return
   `resolved:false` and the agent asks for a calendar date. A festival date already passed is not resolved (next year's rows must be added).
2. **Failed live transfer: faster fallback (working hours only).** The "10am next working day" script is for after hours only.
   - Complaint, 15+ minutes of hours left: `callback_sla`, 15-minute SLA starting at the failure; design lead alerted (Telegram, Session 5)
     immediately; Nikhil alerted if not acknowledged in 10 minutes. Script `complaint_transfer_failed`.
   - Less than 15 minutes left: the after-hours path (callback by 10am next working day, Nikhil alerted).
   - Implemented in `planEscalation` (`slaMinutes`, `alertDesignLeadNow`, `alertNikhilIfUnackedMin`), tested at the 15/14-minute boundary.
3. Both assumptions accepted: partial home with 3+ rooms uses the two-room threshold; unknown BHK uses the 1BHK threshold; both flagged in output.
4. **"I want a person" wording approved** (EN; HI/MR drafted by the build team, pending native review): in hours "connecting you to our front desk now";
   transfer failed in hours with 30+ minutes left: front-desk queue item, 30-minute SLA, escalating to the design lead
   (`human_requested_transfer_failed`); after hours: offer a choice (take details for a morning callback, or book the consultation now).
   The choice is a second `request_human` call with `escalation_id` + `choice: callback|book`. "Is this a robot?" → script `robot_confirm`.
   *Assumption to confirm:* for a person-request with fewer than 30 minutes of hours left after a failed transfer I use the after-hours choice.
5. **Open:** the Vaani and GitHub fields were left as "[fill in…]" placeholders, so the Vaani key's origin / real key and the repo URL are
   still unknown. Live calls stay blocked on Vaani.
6. **Order:** Session 1 (foundation + schema) first, then Session 3 (booking). Supabase project, test calendar and Telegram chat id to follow.

## Round 3 — project owner, 2026-10-07
1. **Vaani key:** confirmed the owner's own; used once on the documented endpoint: **HTTP 401, the API wants `vv_live_…` keys**. Exact list of
   undocumented features and what to ask/check: `docs/vaani-findings.md`. Live calls stay blocked.
2. **Git:** repo initialised; `.gitignore` covers `.env*`, `node_modules` and local Supabase state; all history scanned: no secrets
   (only the fake placeholder numbers +919000000000/1 used in tests, and a dummy `vv_whk_testsecret`). GitHub: `gh auth status` reports the
   token invalid, so the private repo `aangan-phone-agent` could not be created (owner to run `gh auth login`). From now on: commit and push at the end of every session.
3. **Supabase local stack (Docker) replaces PGlite as the source of truth:** `supabase init/start`, migration + seed applied by the CLI, verified by
   `pnpm test:supabase-local` (10 checks). Results in `docs/schema-proposal.md`. PGlite tests stay as a fast Docker-free guard.
4. **Confirmed:** person request with < 30 min of working hours left after a failed transfer → after-hours choice.
5. **Native review:** HI/MR drafts stay `draft_pending_native_review`; the festival read-back runs **in English only** until reviewed (`resolve_date`
   returns the English read-back regardless of the language requested).
6. **Session 3:** booking against adapter interfaces with in-memory fakes for Google Calendar and Telegram; real adapters swapped in when the
   owner supplies the test calendar and Telegram chat id.

## Session 3 — booking (built against ports, in-memory fakes) — assumptions to confirm
Confirmed by the owner (round 3): person-request with < 30 min left after a failed transfer → after-hours choice; HI/MR stay drafts; festival read-back English-only.

Built and tested: `get_slots`, `book_slot`, rotation, free/busy with buffer, hold → calendar event → confirm → handoff, idempotency, double-booking
guard (in-memory and Postgres exclusion constraint, one shared contract suite), handoff note builder, working-minute due time. Google Calendar and Telegram
are **ports with in-memory fakes** (`src/adapters/calendar/fake.ts`, `src/adapters/notify/fake.ts`); the real adapters need the owner's test calendar and Telegram chat id.

Behaviour (owner-approved earlier): rotation = least-recently-assigned eligible designer (never-assigned first, ties by name); Saturday bookable if a
calendar is free; a note is sent to the designer with Accept / Can't take it buttons; `due_at` = sent + 30 **working** minutes; only an enquiry the rules
engine called `fit` can be offered slots or booked (enforced in code, tested).

**Operational parameters I chose (NOT specified by the owner; `DEFAULT_BOOKING_CONFIG`, one line each to change):**
1. Consultation length **60 min**, start times every **30 min**, window **10:00–19:00**, **Mon–Sat, no Sundays**.
2. **30-minute buffer** before and after any other event (travel / overrun), applied to the designer's calendar and to our own bookings.
3. Earliest bookable time **2 hours from now**; horizon **14 days**; **3 slots** read out, earliest on each of the first days.
4. Booking mode is always **site visit** (the research plan's template); studio / online visits are not modelled yet.
5. A designer without a calendar id cannot be offered (free/busy unknown). The seeded TEST designers have none until the real calendar exists.
6. If the Telegram send fails, **the booking stands** (the caller was promised it) and the handoff stays `pending` for a retry job (Session 5).
7. If no designer is eligible, or the calendar is unreachable, the agent is told `request_human_review` rather than inventing a slot.
8. The Telegram note carries **no phone or email**; it shows a budget only if the caller volunteered it.

## Session 4 — post-call pipeline
Built (tests first, 590 passing; the repository contract also runs on the real local Supabase): `src/core/postcall/*`, `src/adapters/llm/*`, `PgPostCallRepo`,
migration `20261007000002_post_call.sql` (calls.summary/post_call_status/processed_at, enquiries.designer_note/rule_input, `outbox` table, audit kind `extraction_failed`).

What happens after a call (`POST /api/calls/process`, vendor-neutral record):
1. Store the call, transcript and recording expiry (**ended + 90 days**), caller link, after-hours flag.
2. **Deterministic scans first (never depend on the model):** disclosure at the start (hard rule 3); any price-related number in the AGENT's lines, EN/HI/MR/Hinglish, spoken
   numbers included (hard rule 1); each hit becomes an audit flag + an owner alert.
3. **Gemini extraction** to a fixed JSON schema (`gemini-3.5-flash-lite`, paid tier only, `store:false`), retried once on transient errors, never on a rejected request. If it
   still fails: status `extraction_failed`, flagged and alerted, scans already done.
4. **Complaint slip check** (hard rule 4) from the caller's words + the model's intent; owner **and** Nikhil alerted; never turned into a lead.
5. **Rules engine re-run** on the extracted fields (model extracts, code decides; deadlines turned into dates by code, festivals only from `festival_dates`). Compared with the
   live evaluation; a difference raises `rule_disagreement`. **The live result stays authoritative** (it is what the caller was told); the post-call run is the audit.
6. Enquiry upserted (continues the live one, or the one from a call dropped within 30 minutes; both calls linked), designer note drafted for booked calls (no phone/email), outcome derived,
   AI cost logged per call, follow-ups queued in the **outbox** (HubSpot deal for `fit`, confirmation email for booked). Alerts are delivered by `POST /api/outbox/drain`.

Assumptions I made (please confirm):
- **Outcome rules:** booked > escalated > dropped > not_fit > review. A `fit` enquiry that was not booked is `review` (someone must call) and still gets a HubSpot deal (qualified, per the brief).
- **Which result is stored on the enquiry:** the live one (post-call is audit only). If no live check happened (call ended early) the post-call result is used.
- Only the CALLER's budget is recorded; a caller volunteering a budget is never a violation. The extraction prompt forbids money in the summary but the model is not trusted on that: the price scan only covers the AGENT.
- The price scanner is **deliberately conservative**: it also flags "3x the cost" and "we don't quote per sq ft". Against the 40 real transcripts it flags exactly T10 (a floor in lakh) and T13 (a multiplier), and passes every approved script
  in all three languages. It is a safety net; the weekly 10-call review remains the check for what regexes cannot see.
- Model choice: pinned **`gemini-3.5-flash-lite`** ($0.30/$2.50 per 1M), matching the research plan's cost model. `gemini-3.1-flash-lite` is also Stable and cheaper ($0.25/$1.50). Owner to choose.
- Cost: each call logs the ledger rows and `calls.cost_ai_inr` (about ₹0.24 on a typical call). Voice cost joins when Vaani usage data exists.

Needs from the owner: a **paid-tier Gemini key** (`GEMINI_API_KEY` + `GEMINI_PAID_TIER_CONFIRMED=true`; the app refuses to start with a key but no confirmation), then run
`pnpm tsx scripts/gemini-smoke.ts` once; **Telegram chat ids** for owner alerts and Nikhil (`OWNER_TELEGRAM_CHAT_ID`, `NIKHIL_TELEGRAM_CHAT_ID`); and from Vaani a real `call.completed`
payload. Until then the Vaani webhook stores the event as `unmapped`, acknowledges it, and alerts the owner once that calls are not being post-processed (`docs/vaani-findings.md` item 6).

## Session 5 — handoff, CRM, email (assumptions to confirm)
1. A designer who declines, or does not accept within 30 working minutes (Mon-Fri 10-19 IST), loses the booking to the next eligible designer (least recently assigned, free at that time, has a Telegram chat). Nobody who already had it is asked again. A principal-requested booking only goes to a principal.
2. On timeout the design lead is alerted first, then reassignment runs. If nobody can take it, the design lead, the owner and Nikhil are all alerted; the booking stays with the original designer and the caller is not contacted by the system.
3. Reassignment moves the calendar event (new created, old deleted) and sends the new designer a note marked "Reassigned".
4. Only the designer whose chat id matches can press the buttons for that handoff; a stale press (already accepted, timed out) is answered "already handled".
5. HubSpot gets a deal for every `fit` enquiry (booked or not), described by the designer note (no phone, no email, no amount). Contacts are matched by email; a caller without an email creates a new contact (can duplicate: assumption).
6. The confirmation email is English only (HI/MR pending native review), carries no prices, and is skipped if the booking was cancelled by the time it is sent.
7. A failed outbox item is retried every minute (cron tick) up to 5 times, then marked failed and the owner is alerted.
