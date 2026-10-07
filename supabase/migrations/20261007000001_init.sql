-- Aangan voice agent — schema v2 (docs/schema-proposal.md). Authoritative DDL.
-- Owner conditions: phone numbers encrypted/hashed; RLS on every table; rule_version on every enquiry;
-- per-call cost fields; no price fields (the system stores no quote/rate; only the caller's volunteered budget and tooling costs).

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;   -- not in public (Supabase advisor: extension_in_public)

create type call_outcome as enum ('booked','not_fit','review','escalated','closed_other','dropped','missed');
create type fit_result   as enum ('fit','not_fit','unclear');

-- people ----------------------------------------------------------------------------------------------
create table callers (
  id uuid primary key default gen_random_uuid(),
  phone_hash text not null unique,          -- HMAC-SHA256(e164, PHONE_HASH_PEPPER): lookup key
  phone_enc bytea not null,                 -- AES-256-GCM (app-level, PHONE_ENC_KEY): nonce | tag | ciphertext. No plaintext phone column.
  phone_masked text not null,               -- e.g. +91 98••••••10
  name text, email text, language text,
  is_existing_client boolean not null default false,
  client_ref text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  deleted_at timestamptz                    -- deletion on request
);

create table vip_referrers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  notes text,
  active boolean not null default true       -- effect: flag in the designer note + notify Nikhil; rules unchanged
);

create table designers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  areas text[] not null default '{}',
  project_types text[] not null default '{}',
  calendar_id text,
  telegram_chat_id bigint,
  is_principal boolean not null default false,
  is_design_lead boolean not null default false,
  active boolean not null default true,
  is_test boolean not null default false,
  last_assigned_at timestamptz,             -- rotation: least-recently-assigned eligible designer
  max_per_day int
);

-- rules and wording (versioned; approved by project owner, Nikhil production sign-off pending) -----------------
create table rule_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  config jsonb not null,                    -- validated by the typed zod schema; NEVER sent to a prompt
  status text not null check (status in ('draft','approved','active','retired')),
  approved_by text, approved_at timestamptz, notes text,
  created_at timestamptz not null default now()
);
create unique index one_active_rule_version on rule_versions (status) where status = 'active';

create table approved_texts (
  id uuid primary key default gen_random_uuid(),
  key text not null, locale text not null check (locale in ('en','hi','mr')), body text not null,
  status text not null check (status in ('approved','approved_pending_native_check','draft_pending_native_review')),
  version int not null default 1, approved_by text, approved_at timestamptz,
  unique (key, locale, version)
);

create table studio_hours (
  id uuid primary key default gen_random_uuid(),
  weekday int check (weekday between 0 and 6), opens time, closes time,
  holiday_date date, note text
);

create table festival_dates (               -- never trust a caller's stated distance to a festival
  key text primary key,
  names text[] not null,
  display jsonb not null,
  event_date date not null
);

-- calls and enquiries ------------------------------------------------------------------------------------
create table enquiries (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid references callers(id),
  channel text not null default 'phone',
  location_raw text, locality text,
  location_zone text check (location_zone in ('pune','pcmc','edge','outside','unknown')),
  project_type text, scope text, scope_text text, rooms_count int, bhk int, is_villa boolean,
  carpet_sqft int, current_state text,
  timeline_raw text, deadline_date date, start_date date, possession_date date,
  decision_maker text, owners_attending boolean,
  tenure text check (tenure in ('owned','rented')), landlord_consent boolean, structural_work text,
  referrer text, source_heard text,
  caller_budget_inr bigint,                 -- ONLY what the caller volunteered (upper figure); never spoken back
  language text, asked_for_number boolean not null default false,  -- caller asked for a figure (the agent gave the approved explanation)
  flags jsonb not null default '{}',
  extraction_model text, extraction_schema_version int,
  fit fit_result, reason_codes text[] not null default '{}', missing_fields text[] not null default '{}',
  next_action text,
  rule_version_id uuid not null references rule_versions(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Every enquiry is stamped with the active rule version, so it can never exist without one.
create function stamp_rule_version() returns trigger language plpgsql
  set search_path = ''                       -- immutable search path (Supabase advisor: function_search_path_mutable)
as $$
begin
  if new.rule_version_id is null then
    new.rule_version_id := (select id from public.rule_versions where status = 'active');
  end if;
  return new;
end $$;
create trigger enquiries_stamp_rule_version before insert on enquiries
  for each row execute function stamp_rule_version();

create table calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid references callers(id),
  enquiry_id uuid references enquiries(id),  -- a dropped call and its call-back share one enquiry
  parent_call_id uuid references calls(id),
  channel text not null default 'phone',
  direction text not null default 'inbound' check (direction = 'inbound'),   -- hard rule 5
  vaani_call_id text unique,
  rang_at timestamptz, answered_at timestamptz, ended_at timestamptz,
  duration_s int, answer_latency_ms int,
  after_hours boolean,
  intent text check (intent in ('new_enquiry','existing_client','complaint','other','unknown')),
  outcome call_outcome, ended_reason text,
  disclosure_ok boolean,
  recording_path text,
  recording_expires_at timestamptz,          -- ended_at + 90 days; a daily job deletes the file
  recording_deleted_at timestamptz,
  transcript jsonb,
  cost_voice_inr numeric(12,4), cost_ai_inr numeric(12,4), cost_total_inr numeric(12,4),
  created_at timestamptz not null default now()
);
create index calls_caller_ended on calls (caller_id, ended_at desc);

create table rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid references enquiries(id), call_id uuid references calls(id),
  phase text check (phase in ('live','post_call')),
  input jsonb not null, fit fit_result not null, reason_codes text[] not null,
  rule_version_id uuid not null references rule_versions(id),
  call_date timestamptz not null,
  evaluated_at timestamptz not null default now()
);

-- booking and handoff --------------------------------------------------------------------------------------
create table bookings (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references enquiries(id), call_id uuid references calls(id),
  designer_id uuid not null references designers(id),
  calendar_event_id text, mode text,
  starts_at timestamptz not null, ends_at timestamptz not null,
  status text not null check (status in ('held','confirmed','cancelled','rescheduled','attended','no_show')),
  booked_on_call boolean not null default true,
  attendees_expected text, caller_email text,
  confirmation_email_sent_at timestamptz, resend_message_id text,
  designer_reasked_questions boolean,
  idempotency_key text unique,
  constraint booking_ends_after_start check (ends_at > starts_at),
  constraint no_double_booking exclude using gist (designer_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
    where (status in ('held','confirmed'))
);

create table handoffs (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id), designer_id uuid not null references designers(id),
  attempt_no int not null default 1,
  telegram_message_id bigint,
  sent_at timestamptz, due_at timestamptz,   -- due_at = sent + 30 working minutes
  accepted_at timestamptz, declined_at timestamptz, decline_reason text,
  reassigned_to_handoff_id uuid references handoffs(id), design_lead_alerted_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sent','accepted','declined','timed_out','reassigned'))
);                                           -- 'pending' = booking confirmed but the Telegram note has not been delivered yet

create table escalations (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id), caller_id uuid references callers(id),
  reason text not null check (reason in ('complaint','review','human_requested','misroute')),
  mode text check (mode in ('live_transfer','callback_sla','callback_promised','queued_review','offer_choice','continue_booking')),
  created_at timestamptz not null default now(),
  transferred_at timestamptz, callback_due_at timestamptz,
  sla_minutes int, sla_due_at timestamptz,
  queue text, queue_escalates_to text,
  design_lead_alerted_at timestamptz, acknowledged_at timestamptz,
  nikhil_alerted_at timestamptz,
  resolved_at timestamptz, resolved_by text, notes text
);

-- cost, safety, review ------------------------------------------------------------------------------------------
create table usage_costs (                   -- ledger of what the TOOLS cost us; the roll-up lives on calls.cost_*
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calls(id),
  occurred_at timestamptz not null, period_month date not null,
  line text not null check (line in ('voice_minutes','phone_number','ai_tokens_in','ai_tokens_out','hosting','other_fixed')),
  provider text not null, quantity numeric, unit text, unit_cost numeric,
  currency text not null check (currency in ('INR','USD')), fx_inr_per_usd numeric,
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

create table call_reviews (
  id uuid primary key default gen_random_uuid(),
  week_start date not null, call_id uuid not null references calls(id),
  agent_decision text not null, overturned boolean, overturn_reason text,
  reviewer text, reviewed_at timestamptz,
  unique (week_start, call_id)
);

-- integration plumbing ----------------------------------------------------------------------------------------------
create table crm_links (
  id uuid primary key default gen_random_uuid(), enquiry_id uuid references enquiries(id),
  hubspot_contact_id text, hubspot_deal_id text, stage text, synced_at timestamptz
);
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null, external_id text not null, payload jsonb,
  received_at timestamptz not null default now(), processed_at timestamptz, status text,
  unique (source, external_id)
);
create table dashboard_users (
  email text primary key,
  role text not null check (role in ('founder','owner','reviewer'))
);

-- Row-level security on EVERY table: enabled, forced, no policies, no grants for anon/authenticated.
-- Only the server-side service role (BYPASSRLS) touches data; the dashboard reads through server routes.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
