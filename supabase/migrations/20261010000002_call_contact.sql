-- A web call has no phone number, so it has no callers row (callers.phone_* are required). The name and email the caller gave are kept on the call itself.
alter table calls add column if not exists contact_name text;
alter table calls add column if not exists contact_email text;
