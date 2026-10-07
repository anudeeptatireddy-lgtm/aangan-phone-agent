-- Session 7: prompt-only voice agent + Vaani's Cal.com booking. Cal.com's own webhook is the evidence that a booking exists.
create table calcom_bookings (
  uid text primary key,
  event_type_id bigint, title text,
  status text not null check (status in ('accepted','cancelled','pending','rejected','rescheduled')),
  starts_at timestamptz not null, ends_at timestamptz not null,
  attendee_email text, attendee_name text,
  attendee_contact_hash text,                 -- HMAC like callers.phone_hash; the number itself is not stored here
  created_at timestamptz not null,          -- Cal.com's creation time: matches the booking to the call in progress
  claimed_by_call text,                     -- vaani_call_id of the call this booking belongs to
  received_at timestamptz not null default now()
);
create index calcom_bookings_unclaimed on calcom_bookings (created_at) where claimed_by_call is null and status = 'accepted';

alter table calcom_bookings enable row level security;
alter table calcom_bookings force row level security;
revoke all on calcom_bookings from anon, authenticated;

-- new outbox job kinds
alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check check (kind in
  ('hubspot_deal','confirmation_email','owner_alert','nikhil_alert','designer_note_update','vaani_call','call_routing','design_lead_alert'));
