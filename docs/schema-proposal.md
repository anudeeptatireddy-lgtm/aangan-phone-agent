# Schema v2 — implemented (Session 1)

The **authoritative DDL is `supabase/migrations/20261007000001_init.sql`**; `supabase/seed.sql` is generated from the typed
config (`pnpm db:seed:gen`). Both are tested against a real Postgres (PGlite + `btree_gist`) in `tests/db/`. This file keeps only
the design notes and the owner's approval conditions.

Status: **applied and verified on the local Supabase stack** (Docker, CLI v2.120, Postgres 17); no hosted project yet.
`pnpm db:start && pnpm test:supabase-local` (10 checks, against Supabase's real roles and PostgREST):
- migration applied by the CLI, seed loaded (rule v1 active, 36 scripts, 3 TEST designers);
- `btree_gist` installed in the `extensions` schema, and the double-booking exclusion constraint rejects an overlapping booking (back-to-back is fine);
- all 19 tables have RLS enabled **and forced**, zero policies;
- `anon` and `authenticated` hold no privileges, including on tables created later (default privileges revoked);
- SQL as `anon`/`authenticated` -> `permission denied` on every table; PostgREST with the anon key -> **401 / 42501 on every table, GET and POST** (a bogus key returns a different error, so this cannot pass vacuously); the service role can read;
- no plaintext phone column; Supabase's own security advisor reports **no findings** (it first flagged a mutable function search_path and btree_gist in `public`; both fixed).

## Principles
Postgres, `timestamptz` everywhere, channel-neutral (`channel` column), server-side service role only. Full phone stored once,
encrypted (`phone_enc`, AES-256-GCM, key `PHONE_ENC_KEY`); lookups use a keyed hash (`phone_hash`); logs/tool responses use
`phone_masked`. Inbound-only enforced by a CHECK on `calls.direction`. Double-booking blocked by an exclusion constraint on
`bookings`. Every enquiry is stamped with the active rule version by a trigger (and `rule_version_id` is NOT NULL). `usage_costs`
is the ledger; `calls.cost_*` are cached roll-ups.

## Tables (19)
callers, vip_referrers, designers, rule_versions, approved_texts, studio_hours, festival_dates, enquiries, calls, rule_evaluations,
bookings, handoffs, escalations, usage_costs, audit_flags, call_reviews, crm_links, webhook_events, dashboard_users.
A test fails if a table is added without being listed (and therefore without RLS being considered).

## Approval conditions (owner, 2026-10-07) — verified by tests in `tests/db/migration.test.ts`
| Condition | Status |
|---|---|
| Phone numbers encrypted or hashed | **Met & tested:** only `phone_hash`, `phone_enc` (bytea), `phone_masked` exist; no plaintext column anywhere. |
| RLS on every table | **Met & tested:** enabled + forced on all tables; no policies; anon/authenticated have no grants and get `permission denied`. |
| rule_version on every enquiry | **Met & tested:** `enquiries.rule_version_id NOT NULL`, auto-stamped with the active version; `rule_evaluations` too. |
| Per-call cost fields | **Met & tested:** `calls.cost_voice_inr / cost_ai_inr / cost_total_inr`. |
| No price fields anywhere | **Met in the strict sense, tested:** no column named price/quote/rate-per-area. The only money columns are `enquiries.caller_budget_inr` (what the caller volunteered), the tooling-cost ledger (`usage_costs.*`, `calls.cost_*`), and thresholds inside `rule_versions.config`. **Owner to confirm** keeping `caller_budget_inr` (the designer note and rule 6 need it). A test pins this exact list, so any new money column fails CI until reviewed. |

Renamed from the v1 proposal to satisfy the strict reading: `usage_costs.unit_price → unit_cost`, `fx_rate → fx_inr_per_usd`,
`enquiries.price_asked → asked_for_number`.
