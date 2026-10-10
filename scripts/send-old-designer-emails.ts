// One-off backfill: designer emails for real calls that happened while transcripts could not be read (a parser bug, fixed 2026-10-10).
//   - a call with a booking          -> "New project assigned" (details, meeting link, transcript)
//   - a qualified call with no booking -> "New enquiry, no consultation booked yet" (call the customer back)
// Goes to DESIGNER_EMAIL_TO through Resend. Idempotent per call (the idempotency key is the call id). Usage: pnpm tsx scripts/send-old-designer-emails.ts [--dry]
import { existsSync } from "node:fs";
import pg from "pg";
import { SUPABASE_CA } from "../src/db/supabase-ca";
import { ResendEmail } from "../src/adapters/email/resend";
import { buildDesignerEmail } from "../src/core/outbox/designer-email";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { DATABASE_URL, RESEND_API_KEY, RESEND_FROM, RESEND_REPLY_TO, DESIGNER_EMAIL_TO } = process.env;
if (!DATABASE_URL || !RESEND_API_KEY || !RESEND_FROM || !DESIGNER_EMAIL_TO) { console.error("DATABASE_URL, RESEND_API_KEY, RESEND_FROM and DESIGNER_EMAIL_TO are needed (all in .env.local)."); process.exit(1); }
const dry = process.argv.includes("--dry");
const db = new pg.Client({ connectionString: DATABASE_URL.replace(":6543/", ":5432/"), ssl: { ca: SUPABASE_CA } });
await db.connect();
try {
  const designers = (await db.query("select id, name from designers where active and not is_demo order by last_assigned_at nulls first, name")).rows as { id: string; name: string }[];
  const calls = (await db.query(`select c.vaani_call_id id, c.transcript, c.summary, c.outcome, cr.name caller_name, coalesce(e.locality, e.location_raw) place, e.designer_note, e.fit::text fit,
      b.starts_at, dz.name designer, cb.meeting_url
    from calls c left join enquiries e on e.id = c.enquiry_id left join callers cr on cr.id = c.caller_id
    left join bookings b on b.enquiry_id = e.id and b.status <> 'cancelled' left join designers dz on dz.id = b.designer_id left join calcom_bookings cb on cb.claimed_by_call = c.vaani_call_id
    where not c.is_demo and e.fit = 'fit' and c.post_call_status = 'processed' order by c.rang_at`)).rows;
  const mail = new ResendEmail({ apiKey: RESEND_API_KEY, from: RESEND_FROM, replyTo: RESEND_REPLY_TO });
  let spare = 0;
  for (const c of calls) {
    const booked = c.starts_at != null;
    const designer = c.designer ?? designers[spare++ % Math.max(1, designers.length)]?.name ?? "Designer";
    const msg = buildDesignerEmail({ designerName: designer, callerName: c.caller_name, location: c.place, startsAt: booked ? new Date(c.starts_at) : null, meetingUrl: c.meeting_url,
      details: c.designer_note ?? c.summary ?? "", transcript: c.transcript ?? [], forDesigner: designer });
    console.log(`${dry ? "would send" : "sending"}: ${msg.subject}`);
    if (!dry) await mail.send({ to: DESIGNER_EMAIL_TO, ...msg, idempotencyKey: `designer_email:backfill:${c.id}` });
  }
  console.log(`${calls.length} email(s) ${dry ? "prepared" : "sent"} to ${DESIGNER_EMAIL_TO.replace(/^(.).*(@.*)$/, "$1…$2")}`);
} finally { await db.end(); }
