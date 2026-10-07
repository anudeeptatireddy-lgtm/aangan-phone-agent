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
State is in-memory until the Supabase schema is approved. `check_fit` is a fail-safe stub that always returns `unclear`.
