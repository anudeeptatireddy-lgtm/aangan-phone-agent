# Aangan voice agent (local-first)

Inbound-only AI phone enquiry agent for Aangan Studio. See `CLAUDE.md` (rules), `docs/session-0-plan.md` (plan),
`docs/schema-proposal.md`, `docs/vaani-findings.md`.

## Run locally
```
pnpm install
cp .env.example .env.local   # fill TOOL_SHARED_SECRET + PHONE_HASH_PEPPER (>=16 chars); never commit .env.local
pnpm dev                     # http://localhost:3000
pnpm simulate                # drives the real tool endpoints like the voice agent would (second terminal)
pnpm test && pnpm typecheck
```
State is in-memory until Supabase (Session 1). `check_fit` runs the real deterministic rules engine (rule_versions v1; see `docs/decisions-v1.md`).

## Database (Session 1)
`supabase/migrations/` is the schema (authoritative), `supabase/seed.sql` is generated: `pnpm db:seed:gen`. `pnpm test` runs the
migration and seed against an in-process Postgres (PGlite), so no Docker is needed for the fast loop. The source of truth is the Supabase
local stack: `pnpm db:start` (needs Docker), `pnpm test:supabase-local`, `pnpm db:reset`, `pnpm db:stop`. Nothing is applied to a hosted project yet. Env: `PHONE_ENC_KEY` (64 hex) encrypts phone numbers; `PHONE_HASH_PEPPER` keys the lookup hash.
