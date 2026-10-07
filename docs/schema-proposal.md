# Supabase schema proposal v2 (NOT applied — Session 1)

v2 amends v1 to meet the owner's four approval conditions (2026-10-07): phone numbers encrypted/hashed, RLS on every table,
rule_version on every enquiry, per-call cost fields, no price fields. See "Approval conditions" at the end.

Principles: Postgres, `timestamptz` everywhere, RLS enabled on every table with **no anon/authenticated policies** except
dashboard reads via allowlisted users; all writes by server-side service role. Channel-neutral (`channel`). Full phone is
stored once (needed for callbacks); lookups use a keyed hash; logs use the masked form. Inbound-only enforced by constraint.
Costs: `usage_costs` is the ledger; cost columns on `calls` are cached roll-ups.

```sql
create extension if not exists btree_gist;

create type call_outcome as enum ('booked','not_fit','review','escalated','closed_other','dropped','missed');
create type fit_result   as enum ('fit','not_fit','unclear');

-- people ---------------------------------------------------------------
create table callers (
  id uuid primary key default gen_random_uuid(),
  phone_hash text not null unique,          -- HMAC-SHA256(e164, PHONE_HASH_PEPPER); lookup key
  phone_enc bytea not null,                 -- AES-256-GCM (app-level, key PHONE_ENC_KEY, nonce prepended); NO plaintext phone column
  phone_masked text not null,               -- e.g. +91 98••••••10
  name text, email text, language text,
  is_existing_client boolean not null default false,
  client_ref text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  deleted_at timestamptz                    -- deletion-on-request (DPDP)
);

create table vip_referrers (id uuid primary key default gen_random_uuid(), name text not null, notes text, active boolean default true);  -- seeded: Vikram Agarwal. Effect: flag in note + notify Nikhil; rules unchanged

create table designers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  areas text[] not null default '{}',        -- localities served
  project_types text[] not null default '{}',
  calendar_id text,                          -- Google Calendar id
  telegram_chat_id bigint,
  is_principal boolean not null default false,
  is_design_lead boolean not null default false,
  active boolean not null default true,
  last_assigned_at timestamptz,              -- rotation rule input
  max_per_day int
);  -- roster comes from CSV import + admin edit; seed 3 test designers (one principal, one design lead) for build

-- rules & wording (versioned, Nikhil-approved) --------------------------
create table rule_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  config jsonb not null,                     -- validated by zod; includes thresholds; NEVER sent to a prompt
  status text not null check (status in ('draft','approved','active','retired')),
  approved_by text, approved_at timestamptz, notes text,
  created_at timestamptz not null default now()
);
create unique index one_active_rule_version on rule_versions ((status)) where status = 'active';

create table approved_texts (                -- price explanation, not_fit/unclear scripts, per language
  id uuid primary key default gen_random_uuid(),
  key text not null, locale text not null, body text not null,
  status text not null check (status in ('approved','approved_pending_native_check','draft_pending_native_review','draft_not_approved')),
  version int not null, approved_by text, approved_at timestamptz,
  unique (key, locale, version)
);
create table studio_hours (                  -- working days/hours/holidays config (IST)
  id uuid primary key default gen_random_uuid(), weekday int, opens time, closes time, holiday_date date, note text
);

-- calls & enquiries ---------------------------------------------------------
create table enquiries (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid references callers(id),
  channel text not null default 'phone',
  -- extracted fields
  location_raw text, locality text,
  location_zone text check (location_zone in ('pune','pcmc','edge','outside','unknown')),
  property_type text, scope_kind text, scope_text text,
  carpet_sqft int, current_state text,
  timeline_raw text, deadline_date date, start_date date, possession_date date,
  decision_maker text, owners_attending boolean,
  tenure text check (tenure in ('owned','rented','unknown')), landlord_consent boolean, structural_work boolean,
  referrer text, source_heard text,
  caller_budget_inr bigint,                  -- ONLY what the caller volunteered (upper figure); never spoken back; the system stores no price/quote of its own
  language text, price_asked boolean not null default false,
  flags jsonb not null default '{}',         -- vip, high_value, frustrated, lost_earlier_enquiry...
  extraction_model text, extraction_schema_version int,
  -- rule result
  fit fit_result, reason_codes text[] not null default '{}', missing_fields text[] not null default '{}',
  rule_version_id uuid not null references rule_versions(id),   -- stamped at creation with the active version; refreshed on every evaluation
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid references callers(id),
  enquiry_id uuid references enquiries(id),  -- two calls (dropped + callback) share one enquiry
  parent_call_id uuid references calls(id),
  channel text not null default 'phone',
  direction text not null default 'inbound' check (direction = 'inbound'),  -- hard rule 5
  vaani_call_id text unique,                 -- column name tied to adapter; confirm with Vaani docs
  rang_at timestamptz, answered_at timestamptz, ended_at timestamptz,
  duration_s int, answer_latency_ms int,
  after_hours boolean,
  intent text check (intent in ('new_enquiry','existing_client','complaint','other','unknown')),
  outcome call_outcome, ended_reason text,
  disclosure_ok boolean,
  recording_path text,                       -- served only behind login
  recording_expires_at timestamptz,          -- ended_at + 90 days (decision C); a daily job deletes the file
  recording_deleted_at timestamptz,
  transcript jsonb,
  cost_voice_inr numeric(12,4), cost_ai_inr numeric(12,4), cost_total_inr numeric(12,4),
  created_at timestamptz not null default now()
);
create index on calls (caller_id, ended_at desc);

create table rule_evaluations (              -- audit: live check_fit vs post-call re-run
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid references enquiries(id), call_id uuid references calls(id),
  phase text check (phase in ('live','post_call')),
  input jsonb not null, fit fit_result not null, reason_codes text[] not null,
  rule_version_id uuid not null references rule_versions(id), call_date timestamptz not null,
  evaluated_at timestamptz not null default now()
);

-- booking & handoff ------------------------------------------------------------
create table bookings (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries(id), call_id uuid references calls(id),
  designer_id uuid not null references designers(id),
  calendar_event_id text, mode text,         -- site_visit | studio | other
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null check (status in ('held','confirmed','cancelled','rescheduled','attended','no_show')),
  booked_on_call boolean not null default true,
  attendees_expected text, caller_email text,
  confirmation_email_sent_at timestamptz, resend_message_id text,
  designer_reasked_questions boolean,        -- Q16
  idempotency_key text unique,
  exclude using gist (designer_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status in ('held','confirmed'))   -- DB-level double-booking guard
);

create table handoffs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id), designer_id uuid not null references designers(id),
  attempt_no int not null default 1,
  telegram_message_id bigint,
  sent_at timestamptz, due_at timestamptz,   -- due_at = sent + 30 *working* minutes
  accepted_at timestamptz, declined_at timestamptz, decline_reason text,
  reassigned_to_handoff_id uuid references handoffs(id), design_lead_alerted_at timestamptz,
  status text not null check (status in ('sent','accepted','declined','timed_out','reassigned'))
);

create table escalations (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id), caller_id uuid references callers(id),
  reason text not null check (reason in ('complaint','review','human_requested','misroute')),
  mode text check (mode in ('live_transfer','callback_promised','queued')),
  created_at timestamptz not null default now(),
  transferred_at timestamptz, callback_due_at timestamptz, resolved_at timestamptz, resolved_by text,
  nikhil_alerted_at timestamptz, notes text
);

-- cost, safety, review -------------------------------------------------------------
create table usage_costs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calls(id),         -- null for fixed fees
  occurred_at timestamptz not null, period_month date not null,
  line text not null check (line in ('voice_minutes','phone_number','ai_tokens_in','ai_tokens_out','hosting','other_fixed')),
  provider text not null, quantity numeric, unit text, unit_price numeric,
  currency text not null check (currency in ('INR','USD')), fx_rate numeric,
  amount_inr numeric(14,4) not null,
  source text not null check (source in ('vaani_usage','computed','manual_fixed'))
);

create table audit_flags (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id),
  kind text not null check (kind in ('price_mention','missed_complaint','rule_disagreement','missing_disclosure','other')),
  severity text not null default 'high', evidence text,
  detected_by text, alerted_at timestamptz, resolved_at timestamptz, resolved_by text,
  created_at timestamptz not null default now()
);

create table call_reviews (                  -- weekly 10-random-calls panel; overturn rate = error rate
  id uuid primary key default gen_random_uuid(),
  week_start date not null, call_id uuid not null references calls(id),
  agent_decision text not null, overturned boolean, overturn_reason text,
  reviewer text, reviewed_at timestamptz, unique (week_start, call_id)
);

-- integration plumbing ---------------------------------------------------------------
create table crm_links (id uuid primary key default gen_random_uuid(), enquiry_id uuid references enquiries(id),
  hubspot_contact_id text, hubspot_deal_id text, stage text, synced_at timestamptz);
create table webhook_events (                -- idempotent inbox
  id uuid primary key default gen_random_uuid(),
  source text not null, external_id text not null, payload jsonb,   -- redacted before store
  received_at timestamptz not null default now(), processed_at timestamptz, status text,
  unique (source, external_id)
);
create table dashboard_users (email text primary key, role text not null check (role in ('founder','owner','reviewer')));
```

Notes
- `vaani_call_id` and any Vaani-specific columns are provisional until Session 2 (I have not seen Vaani docs).
- Dashboard metrics are SQL views over these tables (e.g. median `answer_latency_ms`, `% answered < 1 hour` from
  `calls`, `% booked on call` from `bookings.booked_on_call`, accept time from `handoffs`, escalation SLA from `escalations`).
- Rule thresholds (incl. any budget-floor numbers supplied by Nikhil) live only in `rule_versions.config`.

## Row-level security (every table)
```sql
do $$ declare t text; begin
  foreach t in array array['callers','vip_referrers','designers','rule_versions','approved_texts','studio_hours','enquiries','calls',
    'rule_evaluations','bookings','handoffs','escalations','usage_costs','audit_flags','call_reviews','crm_links','webhook_events','dashboard_users']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);   -- deny by default; the service role (server only) bypasses RLS
  end loop;
end $$;
-- Dashboard reads go through server routes that check dashboard_users; no browser-side table access.
```
A migration test (Session 1) asserts every table in `public` has RLS enabled and no anon/authenticated grants.

## Approval conditions (owner, 2026-10-07)
| Condition | Status in v2 |
|---|---|
| Phone numbers encrypted or hashed | Met: no plaintext column. `phone_hash` (keyed HMAC) for lookup, `phone_enc` (AES-256-GCM) for callbacks, `phone_masked` for display/logs. Needs `PHONE_ENC_KEY` + `PHONE_HASH_PEPPER` in env. |
| RLS on every table | Met: block above + a test that fails if any table lacks it. |
| rule_version stored on every enquiry | Met: `enquiries.rule_version_id NOT NULL` (and on every `rule_evaluations` row). |
| Per-call cost fields | Met: `calls.cost_voice_inr / cost_ai_inr / cost_total_inr` (roll-ups) over the `usage_costs` ledger. |
| No price fields anywhere | **Needs your confirmation.** The system stores no quote, rate or price of its own. Two places hold caller- or owner-supplied money figures: `enquiries.caller_budget_inr` (what the caller volunteered; the designer note and rule 6 need it) and the budget thresholds inside `rule_versions.config`. Keep both, or drop `caller_budget_inr` (then the designer note loses the volunteered budget and rule 6 can only run in memory during the call)? |
