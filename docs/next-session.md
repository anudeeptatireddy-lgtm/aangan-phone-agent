# Next session

Updated 2026-10-07 (end of the call-to-booking router session).

## Done this session
- Restored on the owner's Mac from a git bundle; GitHub (private) is the remote. 778 tests passing at restore.
- **Call-to-booking router** (`src/core/calcom/match.ts`, `router.ts`): pure matcher + `CallRouter`. Triggered by post-call processing finishing, a Cal.com booking arriving, and `/api/cron/tick` (which also runs the sweep). A matched booking goes through rotation assignment (`recordExternalBooking`), the designer note, and the outbox (HubSpot deal, confirmation email, note update). Tests: `tests/calcom/` (matcher, both arrival orders, races, window edges, sweep flags), `tests/api/` (webhook trigger, tick step). Suite: 827 passing, 12 skipped.
- `design_lead_alert` items are now delivered (they were queued but never sent before).
- Fixed a double-booking race in `recordExternalBooking`.
- Decisions recorded in `docs/decisions.md`.

## Needed before live testing (the 13 variables missing from `.env.local`)
`CRON_SECRET`, `DASHBOARD_TOKEN`, `GEMINI_PAID_TIER_CONFIRMED`, `GOOGLE_IMPERSONATE_USER`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `HUBSPOT_DEAL_STAGE_ID`, `HUBSPOT_PIPELINE_ID`, `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `VAANI_WEBHOOK_SECRET`.
Also for the Vaani dashboard product: `VAANIVOICE_API_KEY`, `VAANIVOICE_CLIENT_ID`, `VAANIVOICE_WEBHOOK_SECRET`, `VAANIVOICE_RATE_INR_PER_MIN`, and `CALCOM_SIGNING_SECRET` (the router needs the Cal.com webhook to be signed and reaching us).
Real designer rows: the design lead must have a Telegram chat id, or design-lead alerts wait in the outbox.

## Not wired yet (the router only runs live once these are)
1. **The vaanivoice webhook is not wired to the pipeline.** `src/adapters/voice/vaanivoice/record.ts` (`buildCallRecord`, `parseVaaniVoiceEvent`) exists, but no route calls it. `src/app/api/vaani/webhook` still uses the vaanilabs.in mapper (returns null). Next step: a `vaanivoice` webhook handler -> `VaaniVoiceClient` details + history -> `buildCallRecord` -> `pipeline.process`.
2. **`makeDeps` builds the pipeline without `mode: "prompt_only"`** and without `refine: mergeVaaniEntities`. Only prompt-only calls enqueue `call_routing`. Needs a config switch (or make prompt-only the default now that Cal.com booking is the production path).
3. **In-memory repos only.** `PgPostCallRepo`, `PgCalBookingStore`, `PgBookingRepo` exist and have contract tests, but `makeDeps` still wires in-memory ones. The router has no migration of its own (it uses the outbox row as its state); a Postgres contract run of `tests/calcom/router.test.ts` against the Pg repos is still to do.
4. The router's contract tests use in-memory stores only.

## Owner-only items (batched)
- Confirm the router details in `docs/decisions.md` (the "details I chose" entry): especially (1) only-candidate requires the agent's booking claim, (3) ambiguous = normal priority, (4) 45-minute orphan report.
- `.claude/agents/founders-office-advisor.md` is still missing: the file was not in ~/Downloads (searched). Re-send it, or say what it should do and it will be recreated. The "Working with the advisor" rule is already in CLAUDE.md.
- pnpm: it is not installed globally on this Mac (use `corepack pnpm ...`, or `corepack enable`). `pnpm install --frozen-lockfile` currently fails the pnpm 12 supply-chain policy (`minimumReleaseAge`) because `next@16.4.0` was published under 24 h ago; it clears by itself after about a day. `node_modules` is currently from an earlier `npm install`, which works. Do not relax the policy without the owner's say-so.
- Delete `~/aangan-voice-agent.bundle` (owner said they will).

## Next plan item
Wire item 1 and 2 above (vaanivoice webhook -> pipeline in prompt_only mode), against the fake client, tests first. Then Session 7 replay harness.
