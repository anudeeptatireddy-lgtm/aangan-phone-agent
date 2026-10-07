import { DEFAULT_HOURS, HoursConfig } from "@/core/hours";
import { getEnv, Env } from "@/lib/env";
import { FakeCalendar } from "@/adapters/calendar/fake";
import { FakeNotifier } from "@/adapters/notify/fake";
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

export interface Deps {
  env: Env;
  repo: InMemoryRepo;
  now: () => Date;
  hours: HoursConfig;
  designerNames: string[]; // from designers table once it exists
  // Session 3: booking against ports. Fakes locally; the real Google Calendar / Telegram adapters replace them later.
  enquiries: InMemoryEnquiryStore;
  bookingRepo: InMemoryBookingRepo;
  calendar: FakeCalendar;
  notifier: FakeNotifier;
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
  const calendar = new FakeCalendar();
  const notifier = new FakeNotifier();
  const booking = new BookingService({ repo: bookingRepo, calendar, notifier, now, hours, config: o.bookingConfig ?? DEFAULT_BOOKING_CONFIG });

  // Extractor: the real Gemini adapter only with a key AND an explicit paid-tier confirmation (it throws otherwise, so a misconfigured
  // deployment fails at boot instead of sending caller data to a tier that trains on it). Without a key: a scripted fake outside production.
  let extractor: ExtractionPort | undefined, fakeExtractor: FakeExtractor | undefined;
  if (env.GEMINI_API_KEY) extractor = new GeminiExtractor({ apiKey: env.GEMINI_API_KEY, paidTierConfirmed: env.GEMINI_PAID_TIER_CONFIRMED === "true" });
  else if (env.NODE_ENV !== "production") extractor = fakeExtractor = new FakeExtractor();
  const postcall = new InMemoryPostCallRepo(env.PHONE_HASH_PEPPER);
  const pipeline = extractor ? new PostCallPipeline({ repo: postcall, bookings: bookingRepo, extractor, now, hours, designerNames: o.designerNames }) : undefined;
  const alerts = new AlertDrainer({ repo: postcall, notifier,
    ownerChatId: env.OWNER_TELEGRAM_CHAT_ID ? Number(env.OWNER_TELEGRAM_CHAT_ID) : undefined, nikhilChatId: env.NIKHIL_TELEGRAM_CHAT_ID ? Number(env.NIKHIL_TELEGRAM_CHAT_ID) : undefined });
  return { env, repo: new InMemoryRepo(env.PHONE_HASH_PEPPER), now, hours, designerNames: o.designerNames ?? [],
    enquiries: new InMemoryEnquiryStore(), bookingRepo, calendar, notifier, booking, postcall, extractor, fakeExtractor, pipeline, alerts };
}

// Process-wide singleton for the Next dev server (state is in-memory until Supabase lands).
const g = globalThis as unknown as { __aanganDeps?: Deps };
export function getDeps(): Deps {
  return (g.__aanganDeps ??= makeDeps());
}
