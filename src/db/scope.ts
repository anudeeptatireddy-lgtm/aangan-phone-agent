/**
 * Demo isolation. Every table has `is_demo`, defaulting from the session setting `app.demo` (migration 0005): the demo seeder sets it to 'on',
 * real traffic never does. Anything that picks work or people for REAL traffic (rotation, outbox drains, booking matching) filters on this, so
 * demo rows can never be assigned, sent to Telegram/HubSpot/Resend, or matched to a real call. Read it as "the scope of this connection".
 */
export const SCOPE = "(coalesce(current_setting('app.demo', true), '') = 'on')";
