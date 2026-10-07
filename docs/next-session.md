# Next session

Updated 2026-10-07 (end of the Vaani -> pipeline wiring session).

## Done so far (this project, local on the owner's Mac; GitHub private is the remote)
- **Call-to-booking router** (`src/core/calcom/`): matcher + `CallRouter`, triggered by post-call processing, a Cal.com booking arriving, and the tick; sweep at call end + 15 min; flags go to the design lead only. Ambiguous = normal priority, URGENT when the earliest candidate consultation is within 24 h.
- **Vaani -> pipeline wiring** (`src/server/handlers/vaanivoice-webhook.ts`, route `src/app/api/vaanivoice/webhook/[secret]/route.ts`): secret path segment; only `call_postprocessing` is processed; only the call id is read from the body, everything else is re-fetched from Vaani (`VaaniVoicePort`: real client or `FakeVaaniVoiceClient`); outbound calls ignored; failures answer 503 and alert the owner once per call. `makeDeps` runs the pipeline in `prompt_only` mode by default (Vaani's own extracted fields are merged in). The old vaanilabs.in mapper, signature check and `VAANI_*` env vars are removed.
- `design_lead_alert` items are delivered; double-booking race in `recordExternalBooking` fixed.
- Advisor agent: `.claude/agents/founders-office-advisor.md`.
- Suite: 831 passing, 12 skipped; `tsc` clean.

## Tomorrow (owner instruction)
Retry `corepack pnpm install --frozen-lockfile` and switch `node_modules` over from the earlier npm install. It fails today only because `next@16.4.0` (published 2026-10-06 ~18:20 UTC) is inside pnpm 12's `minimumReleaseAge` window; it clears by itself after about 24 h. **Leave the policy alone.** If it still fails, report which packages, don't relax it. After the switch: run the full suite and confirm 831 passing.

## Needed before live testing
Missing from `.env.local` (names only):
`CRON_SECRET`, `DASHBOARD_TOKEN`, `GEMINI_PAID_TIER_CONFIRMED`, `GOOGLE_IMPERSONATE_USER`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `HUBSPOT_DEAL_STAGE_ID`, `HUBSPOT_PIPELINE_ID`, `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `VAANI_WEBHOOK_SECRET` (**now renamed `VAANIVOICE_WEBHOOK_SECRET`**: 24-128 chars of A-Z a-z 0-9 _ -).
Also new names for the Vaani + Cal.com side: `VAANIVOICE_WEBHOOK_SECRET`, `VAANIVOICE_RATE_INR_PER_MIN` (the dashboard's per-minute rate; optional), `VAANIVOICE_CLIENT_ID` (optional), `CALCOM_SIGNING_SECRET`.
`.env.local` already has `VAANIVOICE_API_KEY` (I renamed the old `VAANI_API_KEY` variable name in place; the value is untouched and is the `vaani_` key for vaanivoice.ai).
In Vaani's dashboard: set the webhook URL to `https://<host>/api/vaanivoice/webhook/<VAANIVOICE_WEBHOOK_SECRET>`. In Cal.com: webhook `https://<host>/api/calcom/webhook` with the same signing secret as `CALCOM_SIGNING_SECRET`.
Real designer rows: the design lead must have a Telegram chat id, or design-lead alerts wait in the outbox.

## Known gaps and limits
1. **In-memory repos only.** `makeDeps` still wires in-memory stores; `PgPostCallRepo`, `PgCalBookingStore`, `PgBookingRepo` exist with contract tests. The router keeps its state in the outbox row (no migration) but has not been run against the Pg repos.
2. **A lost webhook is a lost call.** Vaani's retry behaviour is undocumented. We answer 503 and alert the owner, but nothing re-reads Vaani's history on its own. Recommended follow-up (small): a tick step that lists recent inbound calls from `call-history` and processes any we have not seen.
3. **Vaani's payload and history fields come from docs/findings only**: `call_postprocessing` carries `data.call_id`; caller number, direction and times come from `call-history`. If a real call shows different field names, the fake-client tests will pass and the live call will not: verify on the first test call (needs the owner to place it).
4. Price guard is the prompt rule plus the transcript scan that alerts: a documented limitation (advisor brief).
5. Orphan alerts can repeat for bookings already reported as ambiguous (low priority, once each).
6. Live transfer, `request_human` and the other tools exist for a tool-capable agent (`pipelineMode: "live_tools"`); the prompt-only agent does not call them.

## Owner-only items (batched)
- Place the first real test call(s) to Vaani once the env values and both webhooks are set (nobody else can).
- Telegram bot token and chat ids; HubSpot pipeline/stage ids; Resend key and verified from-address; Google service account if Calendar is wanted (Cal.com is the booking path now, so this can wait).
- Nikhil production sign-off on rules v1 is still pending (`docs/decisions-v1.md`).
- Delete `~/aangan-voice-agent.bundle` (owner said they will).

## Next plan item
Session 7 replay harness (20 phone transcripts + 10 hard cases, fails if the agent says a price-related number), then the Postgres wiring (gap 1) and the history-reconcile tick step (gap 2).
