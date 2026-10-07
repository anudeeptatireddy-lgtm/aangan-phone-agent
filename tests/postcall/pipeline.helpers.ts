import { InMemoryPostCallRepo } from "@/server/postcall-repo";
import { InMemoryBookingRepo } from "@/server/booking-repo";
import { FakeExtractor } from "@/adapters/llm/fake";
import { FakeNotifier } from "@/adapters/notify/fake";
import { PostCallPipeline } from "@/core/postcall/pipeline";
import { emptyExtraction, type Extraction } from "@/core/postcall/extraction";
import type { CallRecordInput, CallTurn } from "@/core/postcall/types";
import { CheckFitInput } from "@/core/rules/engine";
import { designer } from "../booking/helpers";

export const NOW = new Date("2026-10-07T06:20:00Z"); // Wednesday 11:50 IST
export const OPEN = "Namaste, Aangan Studio. I'm Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?";
export const a = (text: string): CallTurn => ({ speaker: "agent", text });
export const c = (text: string): CallTurn => ({ speaker: "caller", text });

export const cleanTurns = (): CallTurn[] => [a(OPEN), c("We have a 3BHK in Kothrud, about 1,400 sq ft, and want to redo the whole thing."), a("So that's a 3BHK in Kothrud, about 1,400 square feet. When do you need it done?"),
  c("By March."), a("I have Thursday 8 October, 11:00 am or Friday 9 October, 10:00 am. Which suits you?"), c("Thursday."), a("Booked. The designer will already know what you shared.")];

export const record = (vendorCallId: string, o: Partial<CallRecordInput> = {}): CallRecordInput => ({
  vendor: "fake", vendorCallId, callerPhone: "+919000000021", rangAt: "2026-10-07T06:12:00Z", answeredAt: "2026-10-07T06:12:03Z", endedAt: "2026-10-07T06:19:30Z",
  durationS: 450, endedReason: "completed", transcript: cleanTurns(), recordingRef: `rec/${vendorCallId}`, ...o });

export const ext = (o: Partial<Extraction> = {}): Extraction => ({ ...emptyExtraction(), language: "en", intent: "new_enquiry", caller_name: "Priya", caller_email: "priya@example.com", location: "Kothrud",
  project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, current_state: "lived_in", decision_maker: "owner", owners_attending: true, source_heard: "Instagram",
  deadline: { kind: "month", date: null, month: 3, year: null, festival: null, value: null, unit: null, text: "by March" }, summary: "3BHK full redesign in Kothrud, owners attending.", ...o });

export function makeAll(o: { designerNames?: string[] } = {}) {
  const repo = new InMemoryPostCallRepo("pepper-0123456789ab");
  const bookings = new InMemoryBookingRepo([designer("A", "A", { isPrincipal: true }), designer("B", "B")]);
  const extractor = new FakeExtractor();
  const notifier = new FakeNotifier();
  const clock = { t: NOW };
  const pipeline = new PostCallPipeline({ repo, bookings, extractor, now: () => clock.t, designerNames: o.designerNames ?? ["Aryan", "Meera"] });
  return { repo, bookings, extractor, notifier, clock, pipeline };
}

/** What the live tool calls would have left behind: a call linked to an enquiry, with the live rules evaluation. */
export async function liveEnquiry(repo: InMemoryPostCallRepo, vendorCallId: string, o: { id?: string; input?: Record<string, unknown>; fit?: "fit" | "not_fit" | "unclear"; callerPhone?: string } = {}) {
  const caller = await repo.upsertCaller({ phone: o.callerPhone ?? "+919000000021" });
  const input = CheckFitInput.parse({ location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, deadline_date: "2027-03-31", decision_maker: "owner", ...o.input });
  const fit = o.fit ?? "fit";
  const e = await repo.upsertEnquiry({ id: o.id ?? crypto.randomUUID(), callerId: caller.id, input, fit, reasonCodes: [], flags: [], ruleVersion: "v1", nextAction: fit === "fit" ? "proceed_to_booking" : "human_review" });
  await repo.upsertCall(vendorCallId, { callerId: caller.id, enquiryId: e.id });
  await repo.recordEvaluation({ vendorCallId, enquiryId: e.id, phase: "live", input, fit, reasonCodes: [], ruleVersion: "v1", callDate: new Date("2026-10-07T06:12:00Z") });
  return e;
}

export async function book(bookings: InMemoryBookingRepo, enquiryId: string) {
  const r = await bookings.createHold({ enquiryId, designerId: "A", startsAt: new Date("2026-10-08T05:30:00Z"), endsAt: new Date("2026-10-08T06:30:00Z"), idempotencyKey: `k-${enquiryId}`, mode: "site_visit", callerEmail: "priya@example.com" });
  if (!r.ok) throw new Error("hold failed");
  await bookings.confirm(r.booking.id, "evt-1");
  return r.booking;
}
