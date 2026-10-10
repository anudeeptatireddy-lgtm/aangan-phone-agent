-- Resend replaces Telegram for the designer handoff: designers have an email, Cal.com bookings keep their meeting link, and a new outbox job emails the designer.
alter table designers add column if not exists email text;
alter table calcom_bookings add column if not exists meeting_url text;
alter table outbox drop constraint outbox_kind_check;
alter table outbox add constraint outbox_kind_check check (kind in
  ('hubspot_deal','confirmation_email','owner_alert','nikhil_alert','designer_note_update','vaani_call','call_routing','design_lead_alert','designer_email'));
