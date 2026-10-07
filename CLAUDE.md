# CLAUDE.md — Aangan Studio AI Phone Enquiry Agent

## What we're building
A production AI voice agent for Aangan Studio (60-person interior design studio, Pune; 14 designers; founder
Nikhil Deshpande). The owner of this project is in the founder's office. The agent answers **inbound** phone
enquiries 24/7, qualifies callers against the studio's rules, books a consultation in a designer's calendar
**during the call**, and hands the designer a complete note. Existing-client complaints and unclear cases go to
a human. A dashboard shows Nikhil call volume, outcomes and the system's own running cost.

Scope: inbound phone only. WhatsApp and the web form are out of scope; every module is channel-neutral so they
become adapters later (a `channel` column, no phone-specific logic in `src/core`).

## HARD RULES (never break)
1. **No price talk.** The agent NEVER states a price, per-sq-ft rate, range or budget minimum — and never reads
   back a budget the caller volunteered. If asked, it gives the approved explanation (a number before a designer
   sees the site would mislead; materials alone can triple the cost of one kitchen; the consultation is free and
   ends with a real number). **`pricing.md` must never be read into any prompt, file, repo or context.** It is
   git-ignored. Do not open it. If budget-floor thresholds are needed for rule 6 they come from Nikhil directly.
2. **AI talks and extracts; plain code decides.** Fit decisions come from the deterministic TypeScript rules
   engine (`src/core/rules`), never an LLM. Routing of complaints/existing clients is also deterministic.
3. **Disclosure at the start of every call:** Aangan's virtual assistant + the call is recorded.
4. **Existing clients / complaints are never qualified like leads.** Escalate immediately: live transfer in working
   hours (10am–7pm IST), otherwise a promised senior callback by 10am + alert to Nikhil.
5. **Inbound only.** Never build AI-dialled outbound calls (also enforce `direction = 'inbound'` in the DB).
6. **Caller data only to paid API tiers that don't train on it.** Never log secrets or full phone numbers in plain
   logs (use the redacting logger; phones appear masked, e.g. `+91 98•••••12`).
7. **Never invent third-party APIs.** For Vaani Labs (and any API we don't know) read the docs/MCP server, or stop
   and ask the owner. No guessing endpoints, payloads, signatures or model IDs.

## Stack
- TypeScript (strict), Next.js App Router on Vercel (Pro; region Mumbai `bom1`): webhooks, agent tool endpoints, dashboard.
- Supabase Postgres for all state (RLS on every table; server-side service role only; region ap-south-1).
- Vaani Labs: telephony, speech, live conversation model — behind a `VoicePlatform` adapter interface (Bolna = possible swap).
- Gemini Flash-Lite (paid tier) for post-call extraction to a fixed JSON schema. **Pin the model name in config.**
- Google Calendar API for free/busy + booking. NO Cal.com / Calendly. Our own rotation rule.
- Telegram Bot API for designer handoff, inline "Accept" / "Can't take it" buttons.
- HubSpot (free CRM): one deal per qualified call. Resend: caller confirmation email. GitHub: commit every session.

## Call flow (summary)
1. Vaani picks up → disclosure. 2. `lookup_caller(phone)` flags repeat caller / lost enquiry, call dropped <30 min
ago (continue same record), existing client. 3. Route by intent: existing client/complaint → `request_human("complaint")`;
other (vendor, wrong number) → log and close; new enquiry → continue. 4. Ask in order: location; scope; approx carpet
area; current state; timeline; who decides and will attend; how they heard. Budget only if volunteered. Follow caller
into English/Hindi/Marathi. 5. `check_fit(fields)` → `fit` (→ `get_slots()`, `book_slot()`, read key facts back) /
`not_fit` + reason code (explain kindly, offer later start or specialist) / `unclear` (→ `request_human("review")`,
caller told to expect a call in working hours). 6. Post-call webhook: store transcript, Gemini extraction, draft
designer note, scan agent lines for any rupee amount / "lakh" / "per sq ft" / range (alert owner), flag complaints
that slipped through. 7. Outputs: Telegram note (reassign to next designer + alert design lead if not accepted in 30
working minutes), HubSpot deal, caller confirmation email, one call-log row feeding the dashboard.

## Fit rules
`docs/qualified.md` (Nikhil's rubric) is the authority. The 8 rules inferred from transcripts are in the brief and
reconciled in `docs/session-0-plan.md` §2. **No rule is coded until the owner/Nikhil resolve the listed differences.**
Rules live in versioned config (`rule_versions` table, validated by a typed zod schema) so approved changes need no
code change. Rule thresholds/budget floors are config, never prompt text. The engine takes `callDate` as input (never
reads the clock) so tests are reproducible.

## Conventions
- Tests first for logic (Vitest). Rules engine: unit tests over all 40 transcripts in `docs/enquiries/`.
- Secrets only in `.env.local`; keep `.env.example` current; validate env with zod at boot. Never commit secrets.
- Logger (`src/lib/log`) redacts phones, tokens, emails by default. No `console.log` of caller data.
- All times stored `timestamptz`; working hours/holidays computed in Asia/Kolkata from config, not hard-coded.
- Webhooks: verify signatures, idempotent via a `webhook_events` inbox, respond fast (voice-tool endpoints must be low latency).
- Adapters (`src/adapters/*`) isolate every third party; `src/core` has no vendor imports.
- No guessing at vendor APIs (rule 7). Pin model names in config. Commit at end of every session with a clear message.
- Decisions that belong to Nikhil (rules, wording, routing) → stop and tell the owner; never choose silently.
- Each session: one plan item only; end with done / next / what's needed from the owner.

## Go-live gate
All 40 transcripts' fixtures pass in the rules engine (T01–T20 expected classes in the brief), the replay harness
passes the 20 phone transcripts + 10 hard cases, and a run FAILS if the agent ever says a price-related number.

## Session plan
See `docs/session-0-plan.md` §5. Status:
- Session 0: done (awaiting owner decisions on the rule conflicts, schema, session order).
- Session 2 (Vaani agent + tools), **local, partial**: tool endpoints + deterministic routing/escalation/hours + Vaani webhook
  verification + `VoicePlatform` seam + agent prompt draft + local simulator are built and tested. Live-call wiring is BLOCKED on
  undocumented Vaani features — see `docs/vaani-findings.md`. `check_fit` is a fail-safe stub (always `unclear`).
- Local-first: run with `pnpm dev`; test with `pnpm test`, `pnpm simulate`. Push only to a private remote the owner creates.
