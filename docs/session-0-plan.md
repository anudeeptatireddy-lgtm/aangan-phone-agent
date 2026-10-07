# Session 0 — Questions, rule conflicts, repo structure, session plan

Status: **proposal, awaiting owner approval. No app code written.**
Sources read: brief, `docs/qualified.md`, `docs/services.md`, Sept 2026 enquiries PDF (T01–T20, W01–W10, F01–F10),
research plan PDF, Nikhil pre-read. **`pricing.md` was not opened** (hard rule 1).

## 0. Findings that need a decision before anything else
- **F1. (Resolved)** `telegram-app` is public and holds an unrelated project, so this work moved to its own standalone repo. Keep the remote **private**: `docs/` holds Nikhil's rubric and transcripts.
- **F2. `docs/enquiries/` does not exist.** Only the PDF was supplied. I'll transcribe the 40 transcripts into
  `docs/enquiries/*.md` + structured field fixtures in Session 4 (rules engine).
- **F3. No Vaani MCP server or Claude Skill found** in the connector registry or skills (web results were Vapi, a different
  product). Per rule 7 I need the Vaani docs URL / MCP server / API access from you before Session 2.

## 1. Questions for the owner
| # | Question | My recommendation |
|---|---|---|
| Q1 | ~~Repo~~ **Resolved:** standalone project `aangan-voice-agent`, local first; Skinstinct repo untouched. Remaining: create a **private** GitHub remote before first push. | Private repo. |
| Q2 | Vaani: docs/MCP link, account access, written per-minute rate, data-handling terms (training opt-out, which LLM they route to, sub-processors, retention, India region) — rule 6 applies to Vaani too. | Get in writing before Session 2. |
| Q3 | Vaani capabilities I must confirm in docs (not assume): tool-call/webhook format + signature, end-of-call webhook payload, recording URL, warm/live transfer to a phone number, caller ID, usage/cost records, test/simulation mode (needed for Session 7). | Read docs in Session 2 start. |
| Q4 | Supabase project: create new (Mumbai/ap-south-1)? Free tier pauses on inactivity and has no backups — production caller PII suggests Pro. | Pro, ap-south-1. |
| Q5 | Studio number: forward existing number or publish new one? Telco forwarding charges? Health-check fallback when Vaani is down. | Open item from research plan. |
| Q6 | Working days: front desk says "closed over the weekend" (W05) but consultations are offered Saturdays (T01, W03). Which days count for live transfer, 30-working-minute reassign clock, designer slots? Holidays (Diwali)? | Config table `studio_hours`; need Nikhil's calendar. |
| Q7 | Who receives live transfers (front desk / senior designer / Nikhil)? Numbers? Does "I want a person" (hard case 10) get the same path as complaints? | Separate reason `human_requested` → front desk in hours. |
| Q8 | Existing-client detection: where does the client phone list come from (HubSpot? project system)? | Needs a seed list + sync. |
| Q9 | Designers: the 14 names, areas, project types, Telegram chat IDs, calendar IDs, who is principal / design lead, rotation rule and per-day caps. | Draft rotation: eligible (area+type, active, free) → least-recently-assigned. Nikhil approves. |
| Q10 | Google Calendar access method: shared calendars with a service account, or domain-wide delegation? Slot length, buffers, travel time for site visits, booking horizon. | Service account + calendar sharing (least privilege). |
| Q11 | Approved price-explanation wording, word for word (EN/HI/MR), plus the not_fit and unclear scripts. | Nikhil signs; stored versioned in `approved_texts`. |
| Q12 | Frustrated *prospects* (T16, W08): book + flag, or escalate? T16 is expected `fit`, but the front desk escalated W08 to a senior designer. Definition of "complaint" = about an existing/past project. | Book + flag + notify design lead. |
| Q13 | Telegram note: include caller phone? | No — name/area/scope only; full record in HubSpot (rule 6). |
| Q14 | HubSpot: pipeline + stage IDs, deal amount (the agent must not invent one; use blank or volunteered budget?). | Leave amount blank; designer fills after consult. |
| Q15 | Recording retention period; deletion-on-request process (DPDP). VIP referrer list (T05). | Nikhil decides. |
| Q16 | Dashboard metric list differs: PDF adds "re-asked questions (designer yes/no)", brief does not. "% answered under 1 hour" baseline needs telco records. Include re-asked? | Include (one boolean column). |
| Q17 | Escalation SLA clock: "closed within 15 min" vs after-hours "callback by 10am" — measure from 10:00 for after-hours escalations? | Yes. |
| Q18 | Gemini exact pinned model ID and current paid pricing — I'll verify against Google's docs in Session 5, not from memory. Login for dashboard: email allowlist via Supabase Auth? Who gets access (Nikhil, you, reviewers)? | Allowlist. |
| Q19 | Reading back a caller's own budget counts as "saying a number related to price" under the harness rule. I'll never repeat budgets aloud. OK? | Yes. |
| Q20 | Plan order: the agent's `check_fit` (Session 2) depends on the rules engine (Session 4). Option A (recommended): pull the rules engine forward into its own session before the Vaani agent (pure TS, no external accounts, can run while Vaani access is pending). Option B: keep your order; in Session 2 `check_fit` is a fail-safe stub that always returns `unclear` (→ everything goes to a human). | A, or B if you want to keep 7 sessions. |

## 2. qualified.md vs the 8 rules — every difference
qualified.md has **5 criteria** (real project, service area, realistic timeline, budget band, decision-maker). It has no
location list, no type list, no size limit. Differences, rule by rule:

| Rule | Brief says | qualified.md / services.md say | Decision needed |
|---|---|---|---|
| 1 Location | Pune + PCMC; edge areas (Talegaon) → `unclear` (human queue). | qualified.md §2 and services.md: Talegaon is **outside** area → decline politely (`not_fit`). services.md names Talegaon, Lonavala, Nashik, Mumbai as not served. Served list is "…and adjoining areas" (not exhaustive); Kharadi (T10) is **not listed**. | Talegaon: not_fit or human review? Approve a locality registry (served / excluded / edge); unknown locality → `unclear`. |
| 2 Service | Advisory-only → `not_fit`. | Same intent (§1). services.md also excludes decor/styling-only, standalone furniture sourcing, Vastu-only. qualified.md says unclear scope → *ask one direct question*. | Add those as `not_fit` sub-codes? Engine returns `unclear` + `missing_fields` so the agent can ask the one question, then re-call. Kitchen-only / wardrobe-only: in scope? 1BHK full home (services says "2BHK onwards")? |
| 3 Type | Homes + offices only; restaurants, gyms, hospitality out. | services.md also allows **clinics and studios**, excludes **retail stores** (not in brief). | Allowed types: home, office, clinic, studio? Retail → not_fit? Unknown type → `unclear`. |
| 4 Commercial size | 500–3,000 sq ft. | services.md: "up to approximately 3,000" (soft). **500 minimum appears nowhere** in qualified.md/services.md — only in T18 ("typically 500 or more"). Residential has no size rule (T12: 5,500 sq ft villa qualified). | Is 500 a hard floor? Tolerance around 3,000 (e.g. 3,001–3,300 → unclear)? |
| 5 Timeline | Design 3–4 wks; one room ≥ 8–10 wks **end to end**; shorter → `not_fit` "offer later start". | qualified.md §3: site available for execution **within 8–10 weeks of the consultation**. services.md: cannot start execution if ready in **under 6 weeks from today**; design 3–4 wks; execution 8–16 wks. Three different measures. Also T02 (move-in ~Nov from 3 Sep, 950 sq ft full redesign) is expected `fit` although services.md timelines would not allow it. T15 "possession in 6 weeks, start design now" is a start date, not a deadline. | Single definition: minimum weeks from call date to the caller's *deadline*. I propose a flat threshold of **8 weeks** (T07/F08 at 3 weeks fail; T02 passes), parameter in config, no size scaling. Nikhil confirms. Extraction must separate deadline / start date / possession date. |
| 6 Budget | Volunteered and far below scope → `unclear` (human). Never state a floor. | qualified.md §4: "address the misalignment **on the call**"; last section: "note it and **do not forward**" (i.e. decline, not review). Unclear budget → treat as qualified + note. T10 front desk said "1–1.5 lakh would be significantly below" — that **is stating a floor**, which hard rule 1 forbids. | Outcome for far-below budget: `unclear` (brief) vs decline (qualified.md)? Who defines "far below scope"? Engine needs per-scope thresholds supplied by **Nikhil directly** (not derived from pricing.md), stored in rule config, never in prompts. |
| 7 Decision-maker | Owners must **attend** the consultation; relative may call on behalf. | qualified.md §5: decision-maker on the call **or authorised representative**; "just researching for in-laws" is not sufficient; but boundary section says unclear on 4 or 5 → treat as qualified + note. No mention of attendance. Internal tension: "not sufficient" vs "treat as qualified". | Unknown/unauthorised decision-maker: `fit` + flag (my proposal) or `unclear`? Is owner attendance a booking condition (T14) or just a note? Companies (F05 "Operations Head"): who counts? |
| 8 Rentals | OK with landlord consent and reversible work. | qualified.md: rented fine "as long as no structural changes"; no landlord-consent requirement (consent only appears in T11). services.md: no structural work for anyone. | Landlord consent required? If not obtained → `unclear`/`not_fit`? Add a general **structural work → not_fit** rule (services.md) as rule 9? |
| — Precedence | Not specified. | qualified.md: one fail → close; two or more fails → decline with a specific script. | If rules disagree, proposal: `not_fit` > `unclear` > `fit`; return *all* reason codes. |
| — Complaint routing | Hard rule 4 + `request_human`. | Silent. | See Q12 (definition of complaint vs frustrated prospect). |

### Proposed expected classes for the 20 WhatsApp/form enquiries (brief only gives T01–T20)
Please confirm; these become test ground truth. fit: W01, W03, W04, W06, W08, W09, F01, F02, F05, F06, F09, F10.
not_fit: W07 (gym), F08 (timeline). unclear: W02, W05, W10, F03 (Talegaon — flips to not_fit if Q on Talegaon = decline),
F04, F07 (insufficient info / price-list-only / "please call me").
T09's `escalate` is router-level, not an engine class; I'll implement a deterministic `routeCall()` (existing-client flag
from lookup, extracted intent, keyword guard incl. designer names and "my project/my designer" in EN/HI/MR) so it is unit-testable.

## 3. Proposed repo structure
```
CLAUDE.md  .env.example  .gitignore  vercel.json
docs/  qualified.md  services.md  session-0-plan.md  schema-proposal.md  source/*.pdf  enquiries/T01..F10.md
agent/                      # Vaani agent definition versioned in git: prompt.md, script, tool specs, approved texts
supabase/migrations/        # SQL migrations; seed/ (designers, draft rule_versions)
src/
  app/                      # Next.js App Router
    (dashboard)/page.tsx  login/
    api/vaani/{tools/{lookup-caller,check-fit,get-slots,book-slot,request-human},webhook}/route.ts
    api/telegram/webhook/route.ts   api/cron/{reassign,health,usage-sync}/route.ts   api/review/overturn/route.ts
  core/                     # channel-neutral, no vendor imports
    rules/{engine,schema,reasons,localities}.ts   routing/route-call.ts
    guards/{price-scan,complaint-scan}.ts   booking/{rotation,slot-select}.ts
    handoff/{note,reassign}.ts   costs/   metrics/
  adapters/
    voice/{VoicePlatform.ts, vaani/, fake/}      # Bolna would be a sibling later
    calendar/google/  notify/telegram/  crm/hubspot/  email/resend/  llm/gemini/
  db/{client,repos,types}.ts
  lib/{env,log,phone,time}.ts
tests/{unit,replay,fixtures}/
```
Tooling: pnpm, Vitest, ESLint + Prettier, zod, pino (redaction), GitHub Actions (lint/typecheck/test). Existing root `api/`
Vercel functions would clash with Next.js, one more reason for Q1.

## 4. Schema
See `docs/schema-proposal.md`. **Not applied anywhere — waiting for your OK.**

## 5. Session plan (each session: tests first for logic, one item, commit, handoff summary)
1. **Foundation + schema** — Next.js/TS scaffold, env (zod), redacting logger, phone mask/hash + IST working-hours utils (tested), migrations + RLS, seed, CI. *Needs: Q1, Q4, Q6, schema OK.*
2. **Vaani agent + tools** — read Vaani docs; `VoicePlatform` interface + Vaani adapter; tool endpoints `lookup_caller`, `request_human`, `check_fit` (stub→real per Q20), `get_slots`/`book_slot` contracts; signature verification; agent prompt/script (disclosure, routing, ask order, language following, approved price explanation). *Needs: Q2, Q3, Q5, Q7, Q11.*
3. **Booking** — Google Calendar free/busy, own rotation rule, hold→confirm, DB exclusion constraint against double-booking, invite. *Needs: Q9, Q10.*
4. **Post-call pipeline + rules engine** — idempotent end-of-call webhook, transcript store, Gemini extraction (fixed JSON schema, pinned model), rules engine over all 40 fixtures, live-vs-post-call disagreement flag, price scan (EN/HI/MR, spoken-number words, ranges, ignores sq-ft readbacks/weeks/times), complaint-slip scan, designer-note drafting, call-log row. *Needs: rule conflicts resolved (§2), thresholds from Nikhil, Q18.*
5. **Telegram + HubSpot (+ Resend)** — bot, Accept / Can't take it callbacks (secret-token verified), 30-working-minute reassign cron, design-lead + Nikhil alerts, HubSpot deal, confirmation email. *Needs: Q9, Q13, Q14.*
6. **Dashboard + cost logging** — Supabase Auth login, all metrics as SQL views with tests, cost by line / per call / per booking, Vaani usage sync, weekly 10-call review with overturn. *Needs: Q16–Q18, Vaani usage API.*
7. **Test harness** — replay T01–T20 + 10 hard cases as scripted calls, assert tool calls/outcomes/disclosure and **fail on any price-related number said by the agent**. How the agent is driven (Vaani test mode vs text-mode simulation) depends on Q3.

Risks to track: Vaani rate and data terms unverified; Supabase free tier unsuitable for PII; per-minute voice cost dominates (PDF mid estimate ≈ ₹11k/month); telco may bill forwarded legs; Gemini repricing 1 Jan 2027.
