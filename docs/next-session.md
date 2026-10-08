# Next session

**Go-live:** see `docs/go-live-checklist.md` (env vars, setup steps in order, and the shortest path to a first real test call). Engineering follow-ups from it are in its section 4 (Vaani retry gap, HubSpot stage sync; the Google-parked eligibility and reassignment gaps are fixed).

## CEO dashboard session (2026-10-07), latest
**Built:** Postgres wiring (`makeDeps({ db })`, `src/db/open.ts`: `DATABASE_URL` = Postgres, `LOCAL_DB_DIR` = local PGlite with migrations + seed applied on first use), migration 0005 (demo marker, funnel stages, deal value, phone-reveal log), every metric in SQL (`src/db/dash-metrics.ts`, `dash-calls.ts`), API under `/api/dashboard/*` (login-gated, date range, live/demo), five pages (Overview, Calls + CSV, Call detail, Designers, Weekly review), `pnpm seed:demo` / `seed:demo:reset`, screenshots in `docs/screenshots/`. 953 tests passing, 12 skipped.
**Open locally:** stop other dev servers, `npx next dev -p 3000` (or `corepack pnpm dev`), open http://localhost:3000/dashboard (no login outside production), then press **Demo**. Only one process may hold `data/local/pglite` at a time: stop `next dev` before `seed:demo`.
**Still missing for live data:** (1) `DATABASE_URL` for Supabase (the migrations apply with `supabase db push`; `PHONE_ENC_KEY` is required with any database). (2) Nothing sets `bookings.status = attended` or a HubSpot stage past `new`, so stages 8-10, designers' consultations/quotes/wins and the pipeline value show "no data yet" until a HubSpot sync exists (needs the real pipeline and stage ids). (3) Fixed fees (phone number, hosting) have no entry screen: insert `usage_costs` rows with `source = 'manual_fixed'`. (4) Nobody marks a complaint escalation resolved, so "closed within 15 minutes" shows "no data yet". (5) One shared password in production: reviewer names are self-declared and reveals are logged as "dashboard"; locally both are "local user". (6) The webhook inbox (`deps.repo.recordWebhookEvent`) and the live-tools stores are still in memory. (7) `pg` and `@electric-sql/pglite` are devDependencies; move them to dependencies in the same change that updates the lockfile (blocked today by the pnpm release-age policy).

Updated 2026-10-07 (end of the Vaani -> pipeline wiring session).

## Done so far (this project, local on the owner's Mac; GitHub private is the remote)
- **Call-to-booking router** (`src/core/calcom/`): matcher + `CallRouter`, triggered by post-call processing, a Cal.com booking arriving, and the tick; sweep at call end + 15 min; flags go to the design lead only. Ambiguous = normal priority, URGENT when the earliest candidate consultation is within 24 h.
- **Vaani -> pipeline wiring** (`src/server/handlers/vaanivoice-webhook.ts`, route `src/app/api/vaanivoice/webhook/[secret]/route.ts`): secret path segment; only `call_postprocessing` is processed; only the call id is read from the body, everything else is re-fetched from Vaani (`VaaniVoicePort`: real client or `FakeVaaniVoiceClient`); outbound calls ignored; failures answer 503 and alert the owner once per call. `makeDeps` runs the pipeline in `prompt_only` mode by default (Vaani's own extracted fields are merged in). The old vaanilabs.in mapper, signature check and `VAANI_*` env vars are removed.
- `design_lead_alert` items are delivered; double-booking race in `recordExternalBooking` fixed.
- Advisor agent: `.claude/agents/founders-office-advisor.md`.
- Suite: 831 passing, 12 skipped; `tsc` clean.

## Done on 2026-10-08
Dashboard login removed for local use (NODE_ENV decides; production = one `DASHBOARD_PASSWORD` screen, fail closed), dashboard redesigned (docs/design-plan.md, desktop only), `node_modules` switched to pnpm's layout (the release-age block cleared; `pnpm install --frozen-lockfile` only reports esbuild's install script as unapproved, which is harmless here). Verified a real production build and the password flow end to end. 977 tests passing, 12 skipped.
**Open the dashboard locally:** `npx next dev -p 3000`, then http://localhost:3000/dashboard (no login), then press **Demo**. To refresh the demo data with the realistic caller names: stop `next dev`, run `corepack pnpm seed:demo`, start it again.
**Production needs:** `DASHBOARD_PASSWORD` (12+ characters). Without it the dashboard is locked.

## Earlier note, now done (pnpm switch)
Retry `corepack pnpm install --frozen-lockfile` and switch `node_modules` over from the earlier npm install. It fails today only because `next@16.4.0` (published 2026-10-06 ~18:20 UTC) is inside pnpm 12's `minimumReleaseAge` window; it clears by itself after about 24 h. **Leave the policy alone.** If it still fails, report which packages, don't relax it. After the switch: run the full suite and confirm 831 passing.

## Needed before live testing
Missing from `.env.local` (names only):
`CRON_SECRET`, `DASHBOARD_PASSWORD` (production only; the dashboard is locked without it), `GEMINI_PAID_TIER_CONFIRMED`, `GOOGLE_IMPERSONATE_USER`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `HUBSPOT_DEAL_STAGE_ID`, `HUBSPOT_PIPELINE_ID`, `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `VAANI_WEBHOOK_SECRET` (**now renamed `VAANIVOICE_WEBHOOK_SECRET`**: 24-128 chars of A-Z a-z 0-9 _ -).
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

## Next plan item (superseded by the dashboard session above for now)
Session 7 replay harness (20 phone transcripts + 10 hard cases, fails if the agent says a price-related number), then the Postgres wiring (gap 1) and the history-reconcile tick step (gap 2).
