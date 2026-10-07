import { InMemoryBookingRepo } from "@/server/booking-repo";
import { FakeCalendar } from "@/adapters/calendar/fake";
import { FakeNotifier } from "@/adapters/notify/fake";
import { BookingService } from "@/core/booking/service";
import { DEFAULT_BOOKING_CONFIG, type BookingConfig, type Designer } from "@/core/booking/types";
import { CheckFitInput } from "@/core/rules/engine";
import type { EnquiryRecord } from "@/core/enquiry";

export const ist = (iso: string) => new Date(`${iso}+05:30`);
export const NOW = ist("2026-10-07T10:30:00"); // Wednesday

export const designer = (id: string, name: string, o: Partial<Designer> = {}): Designer => ({
  id, name, areas: [], projectTypes: ["home", "office"], calendarId: `cal-${id}`, telegramChatId: 100 + id.charCodeAt(0), isPrincipal: false,
  isDesignLead: false, active: true, lastAssignedAt: null, maxPerDay: null, ...o });

export const enquiry = (o: Partial<EnquiryRecord> = {}, input: Record<string, unknown> = {}): EnquiryRecord => ({
  id: "enq-1", callerName: "Priya", callerEmail: "priya@example.com", language: "en", fit: "fit", reasonCodes: [], nextAction: "proceed_to_booking",
  flags: [], ruleVersion: "v1", createdAt: NOW.toISOString(),
  input: CheckFitInput.parse({ location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, decision_maker: "owner", ...input }), ...o });

export function makeSvc(o: { designers?: Designer[]; cfg?: Partial<BookingConfig>; requireCalendar?: boolean } = {}) {
  const clock = { t: NOW };
  const repo = new InMemoryBookingRepo(o.designers ?? [designer("A", "A", { isPrincipal: true }), designer("B", "B"), designer("C", "C")]);
  const calendar = new FakeCalendar();
  const notifier = new FakeNotifier();
  const svc = new BookingService({ repo, calendar, notifier, now: () => clock.t, config: { ...DEFAULT_BOOKING_CONFIG, ...o.cfg }, requireCalendar: o.requireCalendar });
  return { svc, repo, calendar, notifier, clock };
}
