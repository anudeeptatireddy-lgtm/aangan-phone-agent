# Replay report

Run: 2026-10-09. **ALL PASS**: 30/30 calls, price gate caught 8/8 planted violations, price numbers said by the scripted agent: 0.

Scope: our code (rules, router, booking, escalation, scans) is tested for real. The agent's own lines are a script of the approved wording, so what Vaani's live model says is NOT proven here; real calls get the same price and disclosure scans after the call (docs/replay-harness.md).

## The 20 September phone calls

| Case | What it checks | Rules say | Outcome | Booked | Audit flags | Result |
|---|---|---|---|---|---|---|
| T01 | Referral, 3BHK full home in Kothrud | fit | booked | yes | none | PASS |
| T02 | Asks the price twice, still books | fit | booked | yes | none | PASS |
| T03 | Nashik: outside the service area | not_fit | not_fit | no | none | PASS |
| T04 | Advice only, no project: declined | not_fit | not_fit | no | none | PASS |
| T05 | VIP referrer, 4BHK in Koregaon Park | fit | booked | yes | none | PASS |
| T06 | Office fit-out in Baner | fit | booked | yes | none | PASS |
| T07 | Needs it in three weeks: timeline too short | not_fit | not_fit | no | none | PASS |
| T08 | Missed call at 10:47pm, nothing said | - | missed | no | none | PASS |
| T09 | Existing client, five days without a reply: escalated, never qualified | - | escalated | no | none | PASS |
| T10 | Volunteers a very small budget: human review | unclear | review | no | none | PASS |
| T11 | Rented flat, landlord consent | fit | booked | yes | none | PASS |
| T12 | Large villa in Kalyani Nagar | fit | booked | yes | none | PASS |
| T13 | Asks the price, 3 rooms in Aundh | fit | booked | yes | none | PASS |
| T14 | Son calling for his parents, owners will attend | fit | booked | yes | none | PASS |
| T15 | Possession date soon, 2BHK in Undri | fit | booked | yes | none | PASS |
| T16 | Frustrated: called Monday, nobody got back | fit | booked | yes | none | PASS |
| T17 | Call dropped, second call books | fit | booked | yes | none | PASS |
| T18 | 180 sq ft coworking pod: below the minimum | not_fit | not_fit | no | none | PASS |
| T19 | Restaurant in Koregaon Park: not served | not_fit | not_fit | no | none | PASS |
| T20 | 2BHK in Magarpatta, January start | fit | booked | yes | none | PASS |

## The 10 hard cases

| Case | What it checks | Rules say | Outcome | Booked | Audit flags | Result |
|---|---|---|---|---|---|---|
| H1 | Price push, English (T02): explains, books, says no number | fit | booked | yes | none | PASS |
| H2 | Price push, Hinglish (W03 style): same, in Hinglish | fit | booked | yes | none | PASS |
| H3 | Angry existing client (T09): transferred or senior callback, no questions asked | - | escalated | no | none | PASS |
| H4 | Son calling for parents (T14): books with the owners attending | fit | booked | yes | none | PASS |
| H5 | Repeat caller, lost note (T16): the number is recognised | fit | booked | yes | none | PASS |
| H6 | Call drops mid-way (T17): the second call continues the first record | fit | booked | yes | none | PASS |
| H7 | Edge location, Talegaon (F03): goes to the human queue | unclear | review | no | none | PASS |
| H8 | Budget far below scope (T10): no floor stated, human review | unclear | review | no | none | PASS |
| H9 | Restaurant or gym (T19, W07): declines kindly, in Hindi too | not_fit | not_fit | no | none | PASS |
| H10 | "Is this a robot? I want a person.": confirms, transfers, never qualified | - | escalated | no | none | PASS |

## Price gate self-test (a bad agent that says a price: each must be caught)

| Case | What it checks | Rules say | Outcome | Booked | Audit flags | Result |
|---|---|---|---|---|---|---|
| G1 | Gate self-test: the agent says a total in lakh (English): must be caught | fit | booked | yes | price_mention | PASS |
| G2 | Gate self-test: the agent says a per-square-foot rate: must be caught | fit | booked | yes | price_mention | PASS |
| G3 | Gate self-test: the agent says a range: must be caught | fit | booked | yes | price_mention | PASS |
| G4 | Gate self-test: the agent says a figure in rupees as digits: must be caught | fit | booked | yes | price_mention | PASS |
| G5 | Gate self-test: the agent says Hinglish: must be caught | fit | booked | yes | price_mention | PASS |
| G6 | Gate self-test: the agent says Hindi: must be caught | fit | booked | yes | price_mention | PASS |
| G7 | Gate self-test: the agent says Marathi: must be caught | fit | booked | yes | price_mention | PASS |
| G8 | Gate self-test: the agent says reading back a budget the caller volunteered: must be caught | fit | booked | yes | price_mention | PASS |
