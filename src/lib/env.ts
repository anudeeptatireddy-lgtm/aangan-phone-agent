import { z } from "zod";
import { parseStageMap } from "@/core/crm/stage-sync";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PHONE_HASH_PEPPER: z.string().min(16, "PHONE_HASH_PEPPER must be at least 16 chars"),
  // AES-256 key for callers.phone_enc (64 hex chars). Required once the database repository is used.
  PHONE_ENC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "PHONE_ENC_KEY must be 64 hex chars").optional(),
  TOOL_SHARED_SECRET: z.string().min(16, "TOOL_SHARED_SECRET must be at least 16 chars"),
  // Post-call extraction. A Gemini key is only accepted together with an explicit paid-tier confirmation (hard rule 6).
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_PAID_TIER_CONFIRMED: z.enum(["true", "false"]).optional(),
  // Telegram chat ids for audit alerts (price said, complaint not escalated, ...). Numeric strings.
  OWNER_TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/).optional(),
  NIKHIL_TELEGRAM_CHAT_ID: z.string().regex(/^-?\d+$/).optional(),
  // Telegram bot (designer handoffs + alerts). The webhook secret is the secret_token given to setWebhook.
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/, "TELEGRAM_WEBHOOK_SECRET: 16-256 chars of A-Z a-z 0-9 _ -").optional(),
  // HubSpot (deal per qualified enquiry). Pipeline and stage ids are read from the account, never guessed.
  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  HUBSPOT_PIPELINE_ID: z.string().optional(),
  HUBSPOT_PORTAL_ID: z.string().regex(/^\d+$/).optional(), // only to turn a deal id into a link on the dashboard
  HUBSPOT_DEAL_STAGE_ID: z.string().optional(),
  // JSON: HubSpot stage id -> one of new, consult_booked, consult_held, quote_sent, won, lost (only the studio knows what its own stages mean). Closed won / lost need no entry.
  HUBSPOT_STAGE_MAP: z.string().optional().superRefine((v, ctx) => { try { parseStageMap(v); } catch (e) { ctx.addIssue({ code: "custom", message: (e as Error).message }); } }),
  // Resend (caller confirmation email). The from-address must be on a domain verified in Resend.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
  RESEND_REPLY_TO: z.string().optional(),
  // Google Calendar: service-account key JSON (raw JSON or base64 of it). Share each designer's calendar with the service account's email.
  // GOOGLE_IMPERSONATE_USER enables domain-wide delegation, which Google requires before a service account may invite attendees.
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_IMPERSONATE_USER: z.string().email().optional(),
  // Storage. DATABASE_URL = Postgres (Supabase later); LOCAL_DB_DIR = local PGlite directory (migrations + seed applied on first use). Neither = in-memory (tests).
  DATABASE_URL: z.string().url().optional(),
  LOCAL_DB_DIR: z.string().min(1).optional(),
  // The owner dashboard has NO login outside production. In production this one password is required; without it the dashboard is blocked.
  DASHBOARD_PASSWORD: z.string().min(12, "DASHBOARD_PASSWORD must be at least 12 characters").optional(),
  // vaanivoice.ai (Vaani AI Research): API key for call_details/call-history, the secret path segment of our webhook URL, and the dashboard's
  // per-minute rate (used only to ESTIMATE voice cost: the vendor's cost field has no documented unit).
  VAANIVOICE_API_KEY: z.string().optional(),
  VAANIVOICE_CLIENT_ID: z.string().optional(),
  VAANIVOICE_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{24,128}$/, "VAANIVOICE_WEBHOOK_SECRET: 24-128 chars of A-Z a-z 0-9 _ -").optional(),
  VAANIVOICE_RATE_INR_PER_MIN: z.coerce.number().positive().max(1000).optional(),
  // Cal.com: the HMAC secret entered on the webhook in Cal.com settings (x-cal-signature-256).
  CALCOM_SIGNING_SECRET: z.string().min(16).optional(),
  // Authenticates the scheduled tick (Vercel sends it as a bearer token).
  CRON_SECRET: z.string().min(16).optional(),
  // Live-transfer targets (E.164). Complaints -> design lead, falling back to front desk; "I want a person" -> front desk.
  FRONT_DESK_NUMBER: z.string().optional(),
  DESIGN_LEAD_NUMBER: z.string().optional(),
});
export type Env = z.infer<typeof Env>;

let cached: Env | undefined;
export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${missing}`); // names only, never values
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}
