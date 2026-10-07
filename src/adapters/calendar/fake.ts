import type { Interval } from "@/core/booking/types";
import type { CalendarEventInput, CalendarPort } from "@/core/ports";

type Op = "freeBusy" | "createEvent" | "deleteEvent";

/** In-memory Google Calendar stand-in: injectable busy blocks, created events, and one-shot failures. */
export class FakeCalendar implements CalendarPort {
  events: (CalendarEventInput & { eventId: string })[] = [];
  private busy = new Map<string, Interval[]>();
  private failures = new Set<Op>();
  private n = 0;

  addBusy(calendarId: string, start: Date, end: Date) {
    this.busy.set(calendarId, [...(this.busy.get(calendarId) ?? []), { start, end }]);
  }
  failNext(op: Op) { this.failures.add(op); }
  private maybeFail(op: Op) {
    if (this.failures.delete(op)) throw new Error(`fake calendar ${op} failure`);
  }

  async freeBusy(calendarIds: string[], from: Date, to: Date): Promise<Map<string, Interval[]>> {
    this.maybeFail("freeBusy");
    const out = new Map<string, Interval[]>();
    for (const id of calendarIds) {
      const mine = [...(this.busy.get(id) ?? []), ...this.events.filter((e) => e.calendarId === id).map((e) => ({ start: e.start, end: e.end }))];
      out.set(id, mine.filter((b) => b.start < to && b.end > from));
    }
    return out;
  }
  async createEvent(e: CalendarEventInput) {
    this.maybeFail("createEvent");
    const eventId = `fake-evt-${++this.n}`;
    this.events.push({ ...e, eventId });
    return { eventId };
  }
  async deleteEvent(calendarId: string, eventId: string) {
    this.maybeFail("deleteEvent");
    this.events = this.events.filter((e) => !(e.calendarId === calendarId && e.eventId === eventId));
  }
}
