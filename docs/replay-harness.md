# Replay harness (the go-live gate)

`corepack pnpm replay` replays the 20 September phone calls (T01-T20) and the 10 hard cases from the research plan (Gate 2) through the real
post-call pipeline, call-to-booking router, booking service and outbox, on in-memory fakes. No network, no cost. It exits with an error (and the
test suite fails) if anything is wrong, above all if the scripted agent ever says a price-related number. It writes `docs/replay-report.md`.
The same cases run in `corepack pnpm test` (`tests/replay/`).

## What is checked on every call
- The rules engine's result (fit / not_fit / unclear) is the expected class.
- The call ends as the right outcome (booked, not_fit, review, escalated, missed) after the router's 15-minute sweep.
- A consultation exists and was matched to the right call, only when the caller was meant to be booked.
- No audit flag is raised (no price mention, missing disclosure, missed complaint, rule disagreement).
- Complaints and "I want a person" calls are escalated and never qualified (no CRM deal, no booking).
- The opening discloses the virtual assistant and the recording.

## The ten hard cases
| # | Case | What the replay shows |
|---|---|---|
| 1 | Price push, English (T02) | explained, booked, no price flag |
| 2 | Price push, Hinglish | same, in Hinglish |
| 3 | Angry existing client (T09) | escalated as a complaint, not qualified |
| 4 | Son calling for parents (T14) | booked, owners attending |
| 5 | Repeat caller, lost note (T16) | both calls resolve to one caller |
| 6 | Call drops mid-way (T17) | second call continues the first record |
| 7 | Edge location, Talegaon (F03) | human review |
| 8 | Budget far below scope (T10) | human review, no figure said |
| 9 | Restaurant or gym (T19) | declined, in Hindi |
| 10 | "Is this a robot? I want a person." | escalated as human_requested, not qualified |

## The price gate can fail (self-test)
Eight planted violations (a total in lakh, a per-sq-ft rate, a range, rupee digits, Hinglish, Hindi, Marathi, and reading back a budget the caller volunteered)
must each raise `price_mention`. A harness that let one through would be broken, so the run fails if any is missed.

## Limits (read this before relying on it)
The agent's lines are a SCRIPT of the approved wording (`tests/replay/harness.ts`), because Vaani's live model is not available offline. So:
- Our code's decisions and the scans are tested for real.
- What Vaani's model actually says is NOT proven here. Real calls get the same price and disclosure scans after the call, with an alert.
- Things only the live agent does (the spoken apology for a lost note, a live transfer in working hours) are marked "live agent only" and are not tested.
- Prompt-only mode has no live lookup, so "recognises the number" means both calls resolve to one caller record after the fact.
- The first real chat or call is still the real test of Vaani's field names.

## Bug the harness found
A caller who only said "I want a person" (no project details) got an escalation record but the call ended as `review`, not `escalated`. Fixed in
`src/core/postcall/pipeline.ts` (H10).
