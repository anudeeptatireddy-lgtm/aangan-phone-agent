-- Session 8: CEO dashboard. Demo-data marker, funnel stage vocabulary, HubSpot deal value, phone-reveal audit log.

-- Demo marker. The default is driven by a session setting, so the demo seeder (which runs `select set_config('app.demo','on',false)`)
-- marks every row it creates in every table without any repository code knowing; real traffic never sets it, so it is false.
-- Live queries filter on it; `seed:demo:reset` deletes WHERE is_demo.
do $$ declare t text; begin
  foreach t in array array['callers','designers','enquiries','calls','rule_evaluations','bookings','handoffs','escalations','usage_costs','audit_flags','call_reviews','crm_links','outbox','calcom_bookings'] loop
    execute format($f$alter table public.%I add column is_demo boolean not null default (coalesce(current_setting('app.demo', true), '') = 'on')$f$, t);
  end loop;
end $$;
create index calls_demo_rang on calls (is_demo, rang_at);

-- Funnel stages 8-10 come from here (designer-driven; nothing sets them from a live HubSpot sync yet: the dashboard shows "no data yet", not 0).
alter table crm_links
  add column deal_amount_inr numeric(14,2),     -- synced FROM HubSpot (what the designer entered). Never written by the agent, never in a prompt, script, tool response, log, Telegram or email.
  add column stage_changed_at timestamptz,
  add constraint crm_links_stage_check check (stage is null or stage in ('new','consult_booked','consult_held','quote_sent','won','lost'));

alter table call_reviews add column overturned_at timestamptz;

-- Every reveal of a caller's real number from the dashboard is logged BEFORE the number is returned.
create table phone_reveals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calls(id), caller_id uuid references callers(id),
  revealed_at timestamptz not null default now(),
  who text not null default 'dashboard',        -- one shared dashboard token today: no per-person identity (real attribution needs dashboard_users auth)
  ip text,
  is_demo boolean not null default (coalesce(current_setting('app.demo', true), '') = 'on')
);
create index phone_reveals_recent on phone_reveals (revealed_at desc);
alter table phone_reveals enable row level security;
alter table phone_reveals force row level security;
revoke all on phone_reveals from anon, authenticated;
