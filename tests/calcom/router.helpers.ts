import { InMemoryPostCallRepo } from "@/server/postcall-repo";
import { InMemoryBookingRepo } from "@/server/booking-repo";
import { InMemoryCalBookingStore } from "@/server/calcom-store";
import { FakeExtractor } from "@/adapters/llm/fake";
import { FakeNotifier } from "@/adapters/notify/fake";
import { FakeCalendar } from "@/adapters/calendar/fake";
import { BookingService } from "@/core/booking/service";
import { DEFAULT_BOOKING_CONFIG, type Designer } from "@/core/booking/types";
import { PostCallPipeline } from "@/core/postcall/pipeline";
import { CallRouter } from "@/core/calcom/router";
import { AlertDrainer } from "@/core/postcall/alerts";
import { hashPhone } from "@/lib/phone";
import type { CalBooking } from "@/core/calcom/types";
import type { CallRecordInput } from "@/core/postcall/types";
import { designer } from "../booking/helpers";
import { ext, record } from "../postcall/pipeline.helpers";

export const PEPPER = "pepper-0123456789ab";
export const PHONE = "+919000000021";
export const PHONE_HASH = hashPhone(PHONE, PEPPER);
export const d = (s: string) => new Date(s);
/** The pipeline helper's call: rang 06:12:00Z, ended 06:19:30Z (window 06:10:00Z .. 06:29:30Z, sweep at 06:34:30Z). */
export const CALL_END = d("2026-10-07T06:19:30Z");
export const SWEEP_AT = new Date(CALL_END.getTime() + 15 * 60_000);
const nocal = (id: string, name: string, o: Partial<Designer> = {}) => designer(id, name, { calendarId: null, ...o });

export function makeWorld(o: { designers?: Designer[]; hours?: "default" } = {}) {
  const repo = new InMemoryPostCallRepo(PEPPER);
  const cal = new InMemoryCalBookingStore();
  const bookings = new InMemoryBookingRepo(o.designers ?? [nocal("A", "Asha", { isPrincipal: true }), nocal("B", "Bela"), nocal("L", "Lead", { isDesignLead: true })]);
  const notifier = new FakeNotifier();
  const clock = { t: d("2026-10-07T06:20:00Z") }; // Wed 11:50 IST
  const booking = new BookingService({ repo: bookings, calendar: new FakeCalendar(), notifier, now: () => clock.t, config: DEFAULT_BOOKING_CONFIG, requireCalendar: false });
  const router = new CallRouter({ repo, cal, booking, bookings, pepper: PEPPER, now: () => clock.t });
  const extractor = new FakeExtractor();
  const pipeline = new PostCallPipeline({ repo, bookings, extractor, mode: "prompt_only", now: () => clock.t, router });
  const drainer = new AlertDrainer({ repo, notifier, designLeadChat: async () => (await bookings.listActiveDesigners()).find((x) => x.isDesignLead)?.telegramChatId ?? null });
  return { repo, cal, bookings, notifier, clock, booking, router, extractor, pipeline, drainer };
}
export type World = ReturnType<typeof makeWorld>;

/** A call the voice agent says ended with a booking (claimed), as the vaanivoice mapper reports it. */
export const callRec = (id: string, o: Partial<CallRecordInput> = {}): CallRecordInput =>
  record(id, { vendor: "vaanivoice", signals: { claimedBooking: true, claimedBookingTime: "Thursday 11 am" }, ...o });

export async function runCall(w: World, id: string, o: Partial<CallRecordInput> = {}, e = ext()) {
  w.extractor.set(id, e);
  return w.pipeline.process(callRec(id, o));
}

export const calBooking = (uid: string, o: Partial<Omit<CalBooking, "claimedByCall">> = {}): Omit<CalBooking, "claimedByCall"> => ({
  uid, eventTypeId: 7, title: "Aangan consultation", status: "accepted", startsAt: d("2026-10-08T05:30:00Z"), endsAt: d("2026-10-08T06:30:00Z"),
  attendeeEmail: null, attendeeName: null, attendeePhoneHash: null, createdAt: d("2026-10-07T06:15:00Z"), ...o });

export const alertsOf = (w: World, kind: string) => [...w.repo.outbox.values()].filter((x) => x.kind === "design_lead_alert" && x.payload.kind === kind);
/** Work queued for the workers (the router's own call_routing row is bookkeeping). */
export const outboxKinds = (w: World) => [...w.repo.outbox.values()].map((x) => x.kind).filter((k) => k !== "call_routing").sort();
