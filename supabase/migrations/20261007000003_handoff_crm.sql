-- Session 5: handoff reassignment and CRM link idempotency.

-- A reassignment must keep honouring "the principal designer was asked for".
alter table bookings add column wants_principal boolean not null default false;

-- One HubSpot link per enquiry: re-running the deal job can never create a second deal.
create unique index crm_links_enquiry on crm_links (enquiry_id) where enquiry_id is not null;
