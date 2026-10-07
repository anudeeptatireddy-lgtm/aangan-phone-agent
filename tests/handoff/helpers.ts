import { InMemoryBookingRepo } from "@/server/booking-repo";
import { FakeCalendar } from "@/adapters/calendar/fake";
import { FakeNotifier } from "@/adapters/notify/fake";
import { BookingService } from "@/core/booking/service";
import { HandoffService } from "@/core/handoff/service";
import { DEFAULT_BOOKING_CONFIG } from "@/core/booking/types";
import { designer, enquiry, ist } from "../booking/helpers";

export { designer, enquiry, ist };
export const NOW = ist("2026-10-07T10:30:00"); // Wednesday, working hours
export const OWNER_CHAT = 111, NIKHIL_CHAT = 222;

export function makeHandoffEnv(designers = [
  designer("A", "A", { isPrincipal: true }), designer("B", "B"), designer("C", "C"), designer("L", "Lead", { isDesignLead: true, calendarId: null })]) {
  const clock = { t: NOW };
  const repo = new InMemoryBookingRepo(designers);
  const calendar = new FakeCalendar();
  const notifier = new FakeNotifier();
  const enq = enquiry();
  const booking = new BookingService({ repo, calendar, notifier, now: () => clock.t, config: DEFAULT_BOOKING_CONFIG });
  const svc = new HandoffService({
    repo, calendar, notifier, now: () => clock.t, config: DEFAULT_BOOKING_CONFIG,
    loadEnquiry: async (id) => (id === enq.id ? enq : null), ownerChatId: OWNER_CHAT, nikhilChatId: NIKHIL_CHAT,
  });
  return { repo, calendar, notifier, clock, enq, booking, svc };
}

/** Books Thursday 11:00 and returns the first handoff (sent to whichever designer rotation picked). */
export async function bookedEnv(wantsPrincipal = false) {
  const env = makeHandoffEnv();
  const r = await env.booking.bookSlot({ enquiry: env.enq, start: ist("2026-10-08T11:00:00").toISOString(), wantsPrincipal });
  if (!r.ok) throw new Error(JSON.stringify(r));
  const handoffs = await env.repo.handoffsForBooking(r.booking_id);
  const h = handoffs[0]!;
  const designerChat = (await env.repo.getDesigner(h.designerId))!.telegramChatId!;
  return { ...env, bookingId: r.booking_id, h, designerChat };
}
