-- Session 4: post-call pipeline additions (additive; nothing from 0001 is dropped).

alter table calls
  add column summary text,
  add column post_call_status text not null default 'pending' check (post_call_status in ('pending','processed','extraction_failed')),
  add column processed_at timestamptz;
create index calls_post_call_status on calls (post_call_status) where post_call_status <> 'processed';

alter table enquiries
  add column designer_note text,     -- the note the designer received (structured fields + a neutral summary; no phone or email)
  add column rule_input jsonb;       -- the exact input the rules engine evaluated (audit trail)

-- 'extraction_failed': the model call failed after retries; the scans still ran and a human is alerted.
alter table audit_flags drop constraint audit_flags_kind_check;
alter table audit_flags add constraint audit_flags_kind_check
  check (kind in ('price_mention','missed_complaint','rule_disagreement','missing_disclosure','extraction_failed','other'));

-- Transactional outbox: the pipeline records WHAT must happen next (HubSpot deal, confirmation email, alerts); workers deliver it.
-- dedupe_key makes re-processing a call (webhook retries) safe.
create table outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('hubspot_deal','confirmation_email','owner_alert','nikhil_alert','designer_note_update')),
  payload jsonb not null default '{}',
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending','processed','failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index outbox_pending on outbox (kind) where status = 'pending';

-- RLS on the new table, exactly as in 0001: enabled, forced, no policies, no grants for anon/authenticated.
alter table outbox enable row level security;
alter table outbox force row level security;
revoke all on outbox from anon, authenticated;
