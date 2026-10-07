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
import type { CalBookingStore } from "@/core/calcom/types";
import { InMemoryCalBookingStore } from "./calcom-store";
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
  bookingRepo: InMemoryBookingRepo;
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
  booking: BookingService;
  // Session 4: post-call pipeline
  postcall: InMemoryPostCallRepo;
  extractor: ExtractionPort | undefined;
  fakeExtractor: FakeExtractor | undefined; // only when the scripted fake is in use (dev/test)
  pipeline: PostCallPipeline | undefined;
  alerts: AlertDrainer;
}

/** Clearly marked TEST designers (one principal, one design lead), as seeded in supabase/seed.sql. */
export const TEST_DESIGNERS: Designer[] = [
  { id: "test-a", name: "TEST Designer A (principal)", areas: [], projectTypes: ["home", "office"], calendarId: "fake-cal-a", telegramChatId: 1001, isPrincipal: true, isDesignLead: false, active: true, lastAssignedAt: null, maxPerDay: null },
  { id: "test-b", name: "TEST Designer B (design lead)", areas: [], projectTypes: ["home", "office"], calendarId: "fake-cal-b", telegramChatId: 1002, isPrincipal: false, isDesignLead: true, active: true, lastAssignedAt: null, maxPerDay: null },
  { id: "test-c", name: "TEST Designer C", areas: [], projectTypes: ["home", "office"], calendarId: "fake-cal-c", telegramChatId: 1003, isPrincipal: false, isDesignLead: false, active: true, lastAssignedAt: null, maxPerDay: null },
];

export function makeDeps(o: { env?: Record<string, string | undefined>; now?: () => Date; hours?: HoursConfig; designerNames?: string[];
  designers?: Designer[]; bookingConfig?: BookingConfig } = {}): Deps {
  const env = getEnv(o.env ?? process.env);
  const now = o.now ?? (() => new Date());
  const hours = o.hours ?? DEFAULT_HOURS;
  const bookingRepo = new InMemoryBookingRepo(o.designers ?? TEST_DESIGNERS);
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
  const booking = new BookingService({ repo: bookingRepo, calendar, notifier, now, hours, config: o.bookingConfig ?? DEFAULT_BOOKING_CONFIG });

  // Extractor: the real Gemini adapter only with a key AND an explicit paid-tier confirmation (an unconfirmed key disables extraction instead of sending caller data to a tier that may train on it). Without a key: a scripted fake outside production.
  let extractor: ExtractionPort | undefined, fakeExtractor: FakeExtractor | undefined;
  // A key without the confirmation sends NOTHING: post-call processing stays off (503) and the rest of the app keeps running.
  if (env.GEMINI_API_KEY && env.GEMINI_PAID_TIER_CONFIRMED !== "true") log("error", "GEMINI_API_KEY is set but GEMINI_PAID_TIER_CONFIRMED is not 'true': post-call extraction is DISABLED (hard rule 6)");
  else if (env.GEMINI_API_KEY) extractor = new GeminiExtractor({ apiKey: env.GEMINI_API_KEY, paidTierConfirmed: true });
  else if (env.NODE_ENV !== "production") extractor = fakeExtractor = new FakeExtractor();
  const enquiries = new InMemoryEnquiryStore();
  const handoff = new HandoffService({ repo: bookingRepo, calendar, notifier, now, hours, config: o.bookingConfig ?? DEFAULT_BOOKING_CONFIG,
    loadEnquiry: async (id) => enquiries.get(id) ?? null,
    ownerChatId: env.OWNER_TELEGRAM_CHAT_ID ? Number(env.OWNER_TELEGRAM_CHAT_ID) : null, nikhilChatId: env.NIKHIL_TELEGRAM_CHAT_ID ? Number(env.NIKHIL_TELEGRAM_CHAT_ID) : null });
  const postcall = new InMemoryPostCallRepo(env.PHONE_HASH_PEPPER);
  const pipeline = extractor ? new PostCallPipeline({ repo: postcall, bookings: bookingRepo, extractor, now, hours, designerNames: o.designerNames }) : undefined;
  // CRM and email: real adapters only when configured; fakes outside production; in production without config every attempt fails (and is retried / alerted).
  let crm: CrmPort, fakeCrm: FakeCrm | undefined;
  if (env.HUBSPOT_ACCESS_TOKEN && env.HUBSPOT_PIPELINE_ID && env.HUBSPOT_DEAL_STAGE_ID) crm = new HubSpotCrm({ token: env.HUBSPOT_ACCESS_TOKEN, pipelineId: env.HUBSPOT_PIPELINE_ID, dealStageId: env.HUBSPOT_DEAL_STAGE_ID });
  else if (env.NODE_ENV !== "production") crm = fakeCrm = new FakeCrm();
  else crm = { createDealForEnquiry: unconfigured("HubSpot (HUBSPOT_ACCESS_TOKEN / HUBSPOT_PIPELINE_ID / HUBSPOT_DEAL_STAGE_ID)") };
  let email: EmailPort, fakeEmail: FakeEmail | undefined;
  if (env.RESEND_API_KEY && env.RESEND_FROM) email = new ResendEmail({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM, replyTo: env.RESEND_REPLY_TO });
  else if (env.NODE_ENV !== "production") email = fakeEmail = new FakeEmail();
  else email = { send: unconfigured("Resend (RESEND_API_KEY / RESEND_FROM)") };
  const outbox = new OutboxRunner({ repo: postcall, bookings: bookingRepo, notifier, crm, email, now });
  const alerts = new AlertDrainer({ repo: postcall, notifier,
    ownerChatId: env.OWNER_TELEGRAM_CHAT_ID ? Number(env.OWNER_TELEGRAM_CHAT_ID) : undefined, nikhilChatId: env.NIKHIL_TELEGRAM_CHAT_ID ? Number(env.NIKHIL_TELEGRAM_CHAT_ID) : undefined });
  return { env, repo: new InMemoryRepo(env.PHONE_HASH_PEPPER), now, hours, designerNames: o.designerNames ?? [],
    enquiries, bookingRepo, calendar, fakeCalendar, notifier, fakeNotifier, handoff, crm, email, fakeCrm, fakeEmail, outbox, dashboard: new InMemoryDashboardSource(postcall, bookingRepo), calStore: new InMemoryCalBookingStore(), booking, postcall, extractor, fakeExtractor, pipeline, alerts };
}

// Process-wide singleton for the Next dev server (state is in-memory until Supabase lands).
const g = globalThis as unknown as { __aanganDeps?: Deps };
export function getDeps(): Deps {
  return (g.__aanganDeps ??= makeDeps());
}
