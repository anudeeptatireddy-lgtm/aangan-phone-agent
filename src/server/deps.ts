import { DEFAULT_HOURS, HoursConfig } from "@/core/hours";
import { getEnv, Env } from "@/lib/env";
import { log } from "@/lib/log";
import { FakeCalendar } from "@/adapters/calendar/fake";
import { FakeNotifier } from "@/adapters/notify/fake";
import { TelegramNotifier } from "@/adapters/notify/telegram";
import { HandoffService } from "@/core/handoff/service";
import type { CrmPort, EmailPort, NotifierPort } from "@/core/ports";
import { FakeCrm } from "@/adapters/crm/fake";
import { HubSpotCrm } from "@/adapters/crm/hubspot";
import { FakeEmail } from "@/adapters/email/fake";
import { ResendEmail } from "@/adapters/email/resend";
import { GoogleCalendar } from "@/adapters/calendar/google";
import { parseServiceAccount } from "@/adapters/calendar/service-account";
import type { CalendarPort } from "@/core/ports";
import type { DashboardSource } from "@/core/dashboard/source";
import { InMemoryDashboardSource } from "./dashboard-source";
import type { SqlClient } from "@/db/pg-booking-repo";
import { PgBookingRepo } from "@/db/pg-booking-repo";
import { PgPostCallRepo } from "@/db/pg-postcall-repo";
import { PgCalBookingStore } from "@/db/pg-calcom-store";
import { PgDashboardSource } from "@/db/pg-dashboard-source";
import { openDb } from "@/db/open";
import type { BookingRepo } from "@/core/booking/repo";
import type { PostCallRepo } from "@/core/postcall/repo";
import type { CalBookingStore } from "@/core/calcom/types";
import { InMemoryCalBookingStore } from "./calcom-store";
import { CallRouter, toEnquiryRecord } from "@/core/calcom/router";
import { CrmStageSync, parseStageMap } from "@/core/crm/stage-sync";
import { VaaniVoiceClient, type VaaniVoicePort } from "@/adapters/voice/vaanivoice/client";
import { FakeVaaniVoiceClient } from "@/adapters/voice/vaanivoice/fake";
import { mergeVaaniEntities } from "@/adapters/voice/vaanivoice/entities";
import { OutboxRunner } from "@/core/outbox/runner";
import { BookingService } from "@/core/booking/service";
import { DEFAULT_BOOKING_CONFIG, BookingConfig, Designer } from "@/core/booking/types";
import { FakeExtractor } from "@/adapters/llm/fake";
import { GeminiExtractor } from "@/adapters/llm/gemini";
import { AlertDrainer } from "@/core/postcall/alerts";
import type { ExtractionPort } from "@/core/postcall/extraction";
import { PostCallPipeline } from "@/core/postcall/pipeline";
import { InMemoryBookingRepo } from "./booking-repo";
import { InMemoryPostCallRepo } from "./postcall-repo";
import { InMemoryEnquiryStore } from "./enquiry-store";
import { InMemoryRepo } from "./repo";

const notConfigured = () => Promise.reject(new Error("Telegram is not configured (TELEGRAM_BOT_TOKEN)"));
const unconfigured = (what: string) => () => Promise.reject(new Error(`${what} is not configured`));
class UnconfiguredNotifier implements NotifierPort {
  sendHandoff = notConfigured as NotifierPort["sendHandoff"];
  sendAlert = notConfigured;
  editHandoff = notConfigured;
  answerCallback = notConfigured;
}

export interface Deps {
  env: Env;
  repo: InMemoryRepo;
  now: () => Date;
  hours: HoursConfig;
  designerNames: string[]; // from designers table once it exists
  // Session 3: booking against ports. Fakes locally; the real Google Calendar / Telegram adapters replace them later.
  enquiries: InMemoryEnquiryStore;
  bookingRepo: BookingRepo;
  calendar: CalendarPort;
  fakeCalendar: FakeCalendar | undefined; // only when the in-memory fake is in use (dev/test)
  notifier: NotifierPort;
  fakeNotifier: FakeNotifier | undefined; // only when the in-memory fake is in use (dev/test)
  handoff: HandoffService;
  crm: CrmPort;
  email: EmailPort;
  fakeCrm: FakeCrm | undefined;
  fakeEmail: FakeEmail | undefined;
  outbox: OutboxRunner;
  dashboard: DashboardSource;
  calStore: CalBookingStore;
  router: CallRouter;
  /** Copies the designers' progress on each HubSpot deal (stage, quote amount) into our tables. Run by the tick. */
  crmSync: CrmStageSync;
  /** A real HubSpot connection (token, pipeline and stage ids) or the dev/test fake. False in production without them: the sync then does nothing instead of failing every minute. */
  crmConfigured: boolean;
  vaaniVoice: VaaniVoicePort;
  fakeVaaniVoice: FakeVaaniVoiceClient | undefined; // only when the in-memory fake is in use (dev/test)
  /** A real Vaani key (or the dev/test fake). False in production without VAANIVOICE_API_KEY: the reconciler then does nothing instead of failing every minute. */
  vaaniVoiceConfigured: boolean;
  booking: BookingService;
  // Session 4: post-call pipeline
  postcall: PostCallRepo;
  /** Set when the stores are Postgres (DATABASE_URL, LOCAL_DB_DIR, or an injected client). The CEO dashboard reads only from here. */
  db: SqlClient | undefined;
  extractor: ExtractionPort | undefined;
  fakeExtractor: FakeExtractor | undefined; // only when the scripted fake is in use (dev/test)
  pipeline: PostCallPipeline | undefined;
  alerts: AlertDrainer;
}

/** What `makeDeps()` returns without a database: the concrete in-memory stores, for tests and the local simulator. */
export interface MemoryDeps extends Deps { bookingRepo: InMemoryBookingRepo; postcall: InMemoryPostCallRepo; calStore: InMemoryCalBookingStore; db: undefined }

/** Clearly marked TEST designers (one principal, one design lead), as seeded in supabase/seed.sql. */
export const TEST_DESIGNERS: Designer[] = [
  { id: "test-a", name: "TEST Designer A (principal)", areas: [], projectTypes: ["home", "office"], calendarId: "fake-cal-a", telegramChatId: 1001, isPrincipal: true, isDesignLead: false, active: true, lastAssignedAt: null, maxPerDay: null },
  { id: "test-b", name: "TEST Designer B (design lead)", areas: [], projectTypes: ["home", "office"], calendarId: "fake-cal-b", telegramChatId: 1002, isPrincipal: false, isDesignLead: true, active: true, lastAssignedAt: null, maxPerDay: null },
  { id: "test-c", name: "TEST Designer C", areas: [], projectTypes: ["home", "office"], calendarId: "fake-cal-c", telegramChatId: 1003, isPrincipal: false, isDesignLead: false, active: true, lastAssignedAt: null, maxPerDay: null },
];

/**
 * Is a calendar in use for booking? Yes with a real Google key, and in any non-production run (the in-memory fake). In production WITHOUT a Google key
 * (bookings come from Cal.com) there is none: designers then need no calendar id and reassignment judges free time from our own bookings only.
 */
export const googleCalendarInUse = (env: { NODE_ENV: string; GOOGLE_SERVICE_ACCOUNT_JSON?: string }) => !!env.GOOGLE_SERVICE_ACCOUNT_JSON || env.NODE_ENV !== "production";

export interface MakeDepsOptions { env?: Record<string, string | undefined>; now?: () => Date; hours?: HoursConfig; designerNames?: string[];
  designers?: Designer[]; bookingConfig?: BookingConfig; pipelineMode?: "live_tools" | "prompt_only"; db?: SqlClient }

export function makeDeps(o?: Omit<MakeDepsOptions, "db">): MemoryDeps;
export function makeDeps(o: MakeDepsOptions & { db: SqlClient }): Deps;
export function makeDeps(o: MakeDepsOptions = {}): Deps {
  const env = getEnv(o.env ?? process.env);
  const now = o.now ?? (() => new Date());
  const hours = o.hours ?? DEFAULT_HOURS;
  const db = o.db;
  // Postgres when a database client is given; the designers then come from the `designers` table (seeded), never from TEST_DESIGNERS.
  const bookingRepo: BookingRepo = db ? new PgBookingRepo(db) : new InMemoryBookingRepo(o.designers ?? TEST_DESIGNERS);
  // Calendar: real Google only with a service-account key; a fake outside production; in production without one every call fails, so booking
  // answers "calendar unavailable" and the call goes to a human rather than promising a slot nobody checked.
  let calendar: CalendarPort, fakeCalendar: FakeCalendar | undefined;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) calendar = new GoogleCalendar({ serviceAccount: parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON), impersonate: env.GOOGLE_IMPERSONATE_USER });
  else if (env.NODE_ENV !== "production") calendar = fakeCalendar = new FakeCalendar();
  else { const no = () => Promise.reject(new Error("Google Calendar is not configured (GOOGLE_SERVICE_ACCOUNT_JSON)")); calendar = { freeBusy: no, createEvent: no, deleteEvent: no }; }
  // Telegram: the real bot only when a token is configured; a recording fake otherwise (in production without a token every send fails loudly, so items wait in the outbox and the sweep reports them).
  let notifier: NotifierPort, fakeNotifier: FakeNotifier | undefined;
  if (env.TELEGRAM_BOT_TOKEN) notifier = new TelegramNotifier({ token: env.TELEGRAM_BOT_TOKEN });
  else if (env.NODE_ENV !== "production") notifier = fakeNotifier = new FakeNotifier();
  else notifier = new UnconfiguredNotifier();
  const calendarInUse = googleCalendarInUse(env);
  const booking = new BookingService({ repo: bookingRepo, calendar, notifier, now, hours, config: o.bookingConfig ?? DEFAULT_BOOKING_CONFIG, requireCalendar: calendarInUse ? undefined : false });

  // Extractor: the real Gemini adapter only with a key AND an explicit paid-tier confirmation (an unconfirmed key disables extraction instead of sending caller data to a tier that may train on it). Without a key: a scripted fake outside production.
  let extractor: ExtractionPort | undefined, fakeExtractor: FakeExtractor | undefined;
  // A key without the confirmation sends NOTHING: post-call processing stays off (503) and the rest of the app keeps running.
  if (env.GEMINI_API_KEY && env.GEMINI_PAID_TIER_CONFIRMED !== "true") log("error", "GEMINI_API_KEY is set but GEMINI_PAID_TIER_CONFIRMED is not 'true': post-call extraction is DISABLED (hard rule 6)");
  else if (env.GEMINI_API_KEY) extractor = new GeminiExtractor({ apiKey: env.GEMINI_API_KEY, paidTierConfirmed: true });
  else if (env.NODE_ENV !== "production") extractor = fakeExtractor = new FakeExtractor();
  const enquiries = new InMemoryEnquiryStore();
  if (db && !env.PHONE_ENC_KEY) throw new Error("PHONE_ENC_KEY is required when a database is used (caller phone numbers are stored encrypted)");
  const postcall: PostCallRepo = db ? new PgPostCallRepo(db, { pepper: env.PHONE_HASH_PEPPER, encKey: env.PHONE_ENC_KEY! }) : new InMemoryPostCallRepo(env.PHONE_HASH_PEPPER);
  const handoff = new HandoffService({ repo: bookingRepo, calendar, useCalendar: calendarInUse, notifier, now, hours, config: o.bookingConfig ?? DEFAULT_BOOKING_CONFIG,
    // Enquiries made live are in `enquiries`; those from post-call processing (prompt-only calls) are in the post-call repo. Reassignment needs both.
    loadEnquiry: async (id) => {
      const live = enquiries.get(id);
      if (live) return live;
      const row = await postcall.getEnquiry(id);
      return row ? toEnquiryRecord(row, row.callerId ? await postcall.callerContact(row.callerId) : null, now()) : null;
    },
    ownerChatId: env.OWNER_TELEGRAM_CHAT_ID ? Number(env.OWNER_TELEGRAM_CHAT_ID) : null, nikhilChatId: env.NIKHIL_TELEGRAM_CHAT_ID ? Number(env.NIKHIL_TELEGRAM_CHAT_ID) : null });
  const calStore: CalBookingStore = db ? new PgCalBookingStore(db) : new InMemoryCalBookingStore();
  const router = new CallRouter({ repo: postcall, cal: calStore, booking, bookings: bookingRepo, pepper: env.PHONE_HASH_PEPPER, now, hours });
  // prompt_only is the production mode (owner decision): Vaani's prompt-only agent cannot call our tools mid-call, so every call is decided here, afterwards, and the
  // booking is made by Vaani's Cal.com and matched by the router. Vaani's own extracted fields are merged in (they win where valid).
  const pipeline = extractor ? new PostCallPipeline({ repo: postcall, bookings: bookingRepo, extractor, now, hours, designerNames: o.designerNames, router,
    mode: o.pipelineMode ?? "prompt_only", refine: (e, rec) => (rec.vendor === "vaanivoice" ? mergeVaaniEntities(e, rec.vendorEntities) : e) }) : undefined;
  // Vaani (vaanivoice.ai): the real client only with a key; a fake outside production; in production without a key every lookup fails loudly (503 + owner alert).
  let vaaniVoice: VaaniVoicePort, fakeVaaniVoice: FakeVaaniVoiceClient | undefined;
  if (env.VAANIVOICE_API_KEY) vaaniVoice = new VaaniVoiceClient({ apiKey: env.VAANIVOICE_API_KEY, clientId: env.VAANIVOICE_CLIENT_ID });
  else if (env.NODE_ENV !== "production") vaaniVoice = fakeVaaniVoice = new FakeVaaniVoiceClient();
  else { const no = () => Promise.reject(new Error("vaanivoice is not configured (VAANIVOICE_API_KEY)")); vaaniVoice = { getCallDetails: no, findInHistory: no, recentCalls: no }; }
  // CRM and email: real adapters only when configured; fakes outside production; in production without config every attempt fails (and is retried / alerted).
  let crm: CrmPort, fakeCrm: FakeCrm | undefined;
  if (env.HUBSPOT_ACCESS_TOKEN && env.HUBSPOT_PIPELINE_ID && env.HUBSPOT_DEAL_STAGE_ID) crm = new HubSpotCrm({ token: env.HUBSPOT_ACCESS_TOKEN, pipelineId: env.HUBSPOT_PIPELINE_ID, dealStageId: env.HUBSPOT_DEAL_STAGE_ID });
  else if (env.NODE_ENV !== "production") crm = fakeCrm = new FakeCrm();
  else { const no = unconfigured("HubSpot (HUBSPOT_ACCESS_TOKEN / HUBSPOT_PIPELINE_ID / HUBSPOT_DEAL_STAGE_ID)"); crm = { createDealForEnquiry: no, readDeals: no, dealStages: no, dealPipelines: no }; }
  let email: EmailPort, fakeEmail: FakeEmail | undefined;
  if (env.RESEND_API_KEY && env.RESEND_FROM) email = new ResendEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM, replyTo: env.RESEND_REPLY_TO });
  else if (env.NODE_ENV !== "production") email = fakeEmail = new FakeEmail();
  else email = { send: unconfigured("Resend (RESEND_API_KEY / RESEND_FROM)") };
  const crmSync = new CrmStageSync({ repo: postcall, bookings: bookingRepo, crm, now, stageMap: parseStageMap(env.HUBSPOT_STAGE_MAP), startStageId: env.HUBSPOT_DEAL_STAGE_ID, pipelineId: env.HUBSPOT_PIPELINE_ID });
  const outbox = new OutboxRunner({ repo: postcall, bookings: bookingRepo, notifier, crm, email, now });
  const alerts = new AlertDrainer({ repo: postcall, notifier, designLeadChat: async () => (await bookingRepo.listActiveDesigners()).find((x) => x.isDesignLead && x.telegramChatId != null)?.telegramChatId ?? null,
    ownerChatId: env.OWNER_TELEGRAM_CHAT_ID ? Number(env.OWNER_TELEGRAM_CHAT_ID) : undefined, nikhilChatId: env.NIKHIL_TELEGRAM_CHAT_ID ? Number(env.NIKHIL_TELEGRAM_CHAT_ID) : undefined });
  return { env, repo: new InMemoryRepo(env.PHONE_HASH_PEPPER), now, hours, designerNames: o.designerNames ?? [],
    enquiries, bookingRepo, calendar, fakeCalendar, notifier, fakeNotifier, handoff, crm, email, fakeCrm, fakeEmail, outbox, dashboard: db ? new PgDashboardSource(db) : new InMemoryDashboardSource(postcall as InMemoryPostCallRepo, bookingRepo as InMemoryBookingRepo), db, calStore, router, crmSync, crmConfigured: !!(env.HUBSPOT_ACCESS_TOKEN && env.HUBSPOT_PIPELINE_ID && env.HUBSPOT_DEAL_STAGE_ID) || !!fakeCrm, vaaniVoice, fakeVaaniVoice, vaaniVoiceConfigured: !!env.VAANIVOICE_API_KEY || !!fakeVaaniVoice, booking, postcall, extractor, fakeExtractor, pipeline, alerts };
}

// Process-wide singleton for the Next dev server (state is in-memory until Supabase lands).
const g = globalThis as unknown as { __aanganDeps?: Deps };
export function getDeps(): Deps {
  if (g.__aanganDeps) return g.__aanganDeps;
  const env = getEnv(process.env);
  const db = openDb({ DATABASE_URL: env.DATABASE_URL, LOCAL_DB_DIR: env.LOCAL_DB_DIR });
  return (g.__aanganDeps = db ? makeDeps({ db }) : makeDeps());
}
