import { makeDeps, type MemoryDeps } from "@/server/deps";
import { emptyExtraction, type Extraction } from "@/core/postcall/extraction";
import type { FlagKind, Outcome } from "@/core/postcall/repo";
import type { CallRecordInput, CallTurn } from "@/core/postcall/types";
import { hashPhone } from "@/lib/phone";
import { FIXTURES, type Fixture } from "../fixtures/enquiries";
import { loadTurns } from "../postcall/transcripts";

// The replay harness (go-live gate, docs/session-0-plan.md section 5 item 7): the 20 September phone calls (T01-T20) and the 10 hard cases from the
// research plan are replayed through the REAL post-call pipeline, call-to-booking router, booking service and outbox, on in-memory fakes (no network).
//
// What this proves: our code decides correctly, and the deterministic scans (price, disclosure, missed complaint) pass or fail correctly.
// What it cannot prove: what Vaani's live model SAYS. The agent's lines here are a script (the approved wording), so a wording check marked
// source "script" tests the script, not Vaani. Real conversations get the same scans in production (post-call price scan + owner alert).

const PEPPER = "pepper-0123456789ab";
const ENV = { NODE_ENV: "test", PHONE_HASH_PEPPER: PEPPER, TOOL_SHARED_SECRET: "tool-secret-0123456789", VAANIVOICE_RATE_INR_PER_MIN: "5.31" };
const IST = 330 * 60_000;
export const OPEN = "Namaste, Aangan Studio. I'm Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?";
const PRICE_EN = "I can't give a number before a designer has seen the site, because materials alone can change the cost of one kitchen a great deal. The consultation is free, and it ends with a real number.";
const PRICE_HINGLISH = "Site dekhe bina koi number batana sahi nahi hoga, kyunki sirf materials se ek kitchen ka kharcha kaafi badal jaata hai. Consultation bilkul free hai, aur uske end mein designer aapko sahi number bataenge.";
const NEUTRAL = ["Understood, thank you.", "Got it. Tell me a little more.", "That helps. What is your timeline?", "Thanks. Who will be deciding on the project?", "Noted. How did you hear about us?"];
const BOOKED = "I have Thursday 8 October, 11:00 am. Booked. The designer will already know what you've told me, and you'll get a confirmation email.";
const DECLINE_EN = "Thank you for explaining. That is outside what we take on right now, so I won't waste your time. If your plans change, please call again.";
const DECLINE_HI = "हम घरों और ऑफ़िसों पर ध्यान देते हैं। इस तरह की जगह की ख़ास ज़रूरतें होती हैं, इसलिए इसमें विशेषज्ञता वाला स्टूडियो आपके लिए बेहतर रहेगा। माफ़ कीजिए, हम इसे नहीं ले पाएँगे।";
const REVIEW = "Thank you. I'll have a person from our team call you in working hours.";
const COMPLAINT = "I'm very sorry. I'm getting this to a senior person now, and someone will call you back. You won't need to explain it again.";
const ROBOT = "Yes, I'm Aangan's virtual assistant. I can help you book a consultation, or connect you to a person. Whichever you prefer.";
const ROBOT_TRANSFER = "Of course. I'm connecting you to our front desk now.";

export type Source = "code" | "script";
export interface Check { name: string; ok: boolean; detail?: string; source: Source }

type Close = "booked" | "decline" | "decline_hi" | "review" | "complaint" | "robot" | "none";
interface CallSpec {
  id: string;
  phone: string;
  at: Date;                      // when the call started
  durationS: number;
  endedReason?: "completed" | "dropped" | "missed";
  caller: string[];
  close: Close;
  priceReply?: "en" | "hinglish";
  language?: "en" | "hi" | "mr";
  extraction?: Partial<Extraction>;
  fixture?: string;
  claimedBooking?: boolean;
  wantsPerson?: boolean;
  /** replace the scripted agent lines altogether (the gate self-test) */
  agentLines?: string[];
}
interface Expect {
  fit?: "fit" | "not_fit" | "unclear";
  outcome: Outcome;
  booked?: boolean;
  escalation?: "complaint" | "human_requested";
  flags?: FlagKind[];            // exact set of audit flags raised (default none)
  continuesFirstCall?: boolean;  // second call belongs to the first call's record
  sameCaller?: boolean;          // both calls resolve to one caller
  noDeal?: boolean;              // no CRM deal queued (existing-client complaints are never qualified)
  agentOnly?: string;            // part of the pass condition that only the live agent can show
}
export interface ReplayCase { id: string; group: "phone" | "hard" | "gate"; title: string; hardCase?: number; calls: CallSpec[]; expect: Expect }

// ------------------------------------------------------------------ building a call from a document

const ist = (d: number, hh: number, mm = 0) => new Date(Date.UTC(2026, 9, d, hh, mm) - IST);   // October 2026, IST wall clock
let phoneSeq = 0;
const nextPhone = () => `+9190000${String(30000 + ++phoneSeq)}`;
const callerLines = (id: string): string[] => loadTurns(id).filter((t) => t.speaker === "caller").map((t) => t.text).filter(Boolean);

function extractionFor(f: Fixture | undefined, over: Partial<Extraction>, language: "en" | "hi" | "mr", name: string): Extraction {
  const i = (f?.input ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : null), num = (k: string) => (typeof i[k] === "number" ? (i[k] as number) : null), bool = (k: string) => (typeof i[k] === "boolean" ? (i[k] as boolean) : null);
  const dl = str("deadline_date");
  const e = emptyExtraction();
  Object.assign(e, {
    language, intent: "new_enquiry", caller_name: name, caller_email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
    location: str("location"), project_type: (str("project_type") ?? "unknown") as Extraction["project_type"], scope: (str("scope") ?? "unspecified") as Extraction["scope"],
    rooms_count: num("rooms_count"), bhk: num("bhk"), is_villa: bool("is_villa"), carpet_sqft: num("carpet_sqft"),
    deadline: dl ? { kind: "date", date: dl, month: null, year: null, festival: null, value: null, unit: null, text: `by ${dl}` } : null,
    start_date: str("start_date"), possession_date: str("possession_date"), decision_maker: (str("decision_maker") ?? "unknown") as Extraction["decision_maker"], owners_attending: bool("owners_attending"),
    tenure: (str("tenure") ?? "unknown") as Extraction["tenure"], landlord_consent: bool("landlord_consent"), structural_work: (str("structural_work") ?? "unknown") as Extraction["structural_work"],
    budget_inr: num("budget_inr"), referrer: str("referrer"), asked_for_price: !!i.price_asked, frustrated: !!i.frustrated, exploring_only: !!i.exploring_only,
    summary: `${f?.id ?? "Call"}: replayed enquiry.`,
  } satisfies Partial<Extraction>);
  return Object.assign(e, over);
}

function agentTurns(spec: CallSpec): CallTurn[] {
  if (spec.agentLines) return spec.agentLines.map((text, j) => ({ speaker: "agent" as const, text: j === 0 ? text : text }));
  const turns: CallTurn[] = [{ speaker: "agent", text: OPEN }];
  spec.caller.slice(0, 8).forEach((text, j) => {
    turns.push({ speaker: "caller", text });
    const asksCost = /cost|price|rate|how much|budget|kitna|kharcha|खर्च|कितना/i.test(text);
    turns.push({ speaker: "agent", text: asksCost && spec.priceReply === "hinglish" ? PRICE_HINGLISH : asksCost && spec.priceReply ? PRICE_EN : NEUTRAL[j % NEUTRAL.length]! });
  });
  const close = { booked: BOOKED, decline: DECLINE_EN, decline_hi: DECLINE_HI, review: REVIEW, complaint: COMPLAINT, robot: ROBOT_TRANSFER, none: "" }[spec.close];
  if (spec.close === "robot") turns.splice(2, 0, { speaker: "agent", text: ROBOT });
  if (close) turns.push({ speaker: "agent", text: close });
  return turns;
}

const flagsOf = async (d: MemoryDeps, callId: string) => (await d.postcall.listFlags(callId)).map((f) => f.kind).sort();

// ------------------------------------------------------------------ running one case

export interface Observed { fit: string | null; outcome: string | null; booked: boolean; flags: string[]; escalation: string[]; dealQueued: boolean; disclosureOk: boolean | null }
export interface CaseResult { case: ReplayCase; checks: Check[]; observed: Observed; ok: boolean }

export async function runCase(c: ReplayCase): Promise<CaseResult> {
  const clock = { t: new Date() };
  const d = makeDeps({ env: ENV, now: () => clock.t, pipelineMode: "prompt_only", designerNames: ["Aryan", "Meera"] }) as MemoryDeps;
  if (!d.pipeline || !d.fakeExtractor) throw new Error("the replay must run on fakes only");
  const checks: Check[] = [];
  const ok = (name: string, pass: boolean, source: Source, detail?: string) => checks.push({ name, ok: pass, source, ...(detail ? { detail } : {}) });

  let last: Awaited<ReturnType<typeof d.pipeline.process>> | undefined;
  let first: typeof last;
  let lastId = "";
  let uid = 0;
  let lastBookingUid = "";
  for (const [n, spec] of c.calls.entries()) {
    const endedAt = new Date(spec.at.getTime() + spec.durationS * 1000);
    const callId = `replay-${c.id}-${spec.id}`;
    const fixture = spec.fixture ? FIXTURES.find((f) => f.id === spec.fixture) : undefined;
    const name = ["Priya", "Rahul", "Sneha", "Amit", "Kavita"][n % 5]! + " Test";
    const e = extractionFor(fixture, spec.extraction ?? {}, spec.language ?? "en", name);
    d.fakeExtractor.set(callId, e);
    const turns = spec.endedReason === "missed" ? [] : agentTurns(spec);
    const rec: CallRecordInput = { vendor: "vaanivoice", vendorCallId: callId, callerPhone: spec.phone, rangAt: spec.at.toISOString(), answeredAt: new Date(spec.at.getTime() + 3000).toISOString(),
      endedAt: endedAt.toISOString(), durationS: spec.durationS, endedReason: spec.endedReason ?? "completed", transcript: turns, recordingRef: `https://recordings.example.invalid/${callId}`,
      voiceCostInr: Math.round((spec.durationS / 60) * 5.31 * 100) / 100, voiceRateInrPerMin: 5.31, signals: { claimedBooking: !!spec.claimedBooking, wantsPerson: !!spec.wantsPerson } };

    const willBook = !!spec.claimedBooking && spec.endedReason !== "missed";
    const startsAt = ist(8, 11);
    const cal = willBook ? { uid: `replay-bk-${c.id}-${++uid}`, eventTypeId: 7409577, title: "Aangan consultation", status: "accepted" as const, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000),
      attendeeEmail: e.caller_email, attendeeName: name, attendeePhoneHash: hashPhone(spec.phone, PEPPER), createdAt: new Date(spec.at.getTime() + spec.durationS * 600) } : null;
    if (cal) { await d.calStore.upsert(cal); lastBookingUid = cal.uid; }
    clock.t = new Date(endedAt.getTime() + 20_000);
    last = await d.pipeline.process(rec);
    if (n === 0) first = last;
    lastId = callId;
    clock.t = new Date(endedAt.getTime() + 90_000);
    await d.router.routePending();
    clock.t = new Date(endedAt.getTime() + 20 * 60_000);   // the router's sweep: call end + 15 minutes settles a call that has no booking
    await d.router.routePending();
    await d.outbox.run();
  }

  const callRow = await d.postcall.getCall(lastId);
  const enquiry = last?.enquiryId ? await d.postcall.getEnquiry(last.enquiryId) : null;
  const flags = (await flagsOf(d, lastId)) as FlagKind[];
  const esc = (await d.postcall.escalationsForCall(lastId)).map((x) => x.reason);
  const booked = lastBookingUid ? !!(await d.bookingRepo.findByIdempotencyKey(`cal:${lastBookingUid}`)) : false;
  const deals = (await d.postcall.pendingOutbox(["hubspot_deal"], 100)).filter((r) => r.payload.enquiryId === last?.enquiryId);
  const dealQueued = deals.length > 0 || (last?.enquiryId ? !!(await d.postcall.getCrmLink(last.enquiryId)) : false);
  const x = c.expect;

  ok(`call ends as ${x.outcome}`, callRow?.outcome === x.outcome, "code", `got ${callRow?.outcome}`);
  if (x.fit) ok(`rules say ${x.fit}`, enquiry?.fit === x.fit, "code", `got ${enquiry?.fit}`);
  ok(x.booked ? "consultation booked and matched to the call" : "no consultation booked", booked === !!x.booked, "code", `booked=${booked}`);
  const want = [...(x.flags ?? [])].sort();
  ok(want.length ? `flags raised: ${want.join(", ")}` : "no audit flags (no price, disclosure or complaint problem)", JSON.stringify(flags) === JSON.stringify(want), "code", `got [${flags.join(", ")}]`);
  if (x.escalation) ok(`escalated as ${x.escalation}`, esc.includes(x.escalation), "code", `got [${esc.join(", ")}]`);
  else if (c.calls.every((s) => s.endedReason !== "missed")) ok("not escalated", esc.length === 0, "code", `got [${esc.join(", ")}]`);
  if (x.noDeal) ok("never qualified: no CRM deal, no booking", !dealQueued && !booked, "code");
  if (c.calls.some((s) => s.endedReason !== "missed")) ok("opening disclosed the virtual assistant and the recording", callRow?.disclosureOk === true, "script", `disclosure_ok=${callRow?.disclosureOk}`);
  if (x.continuesFirstCall) {
    const a = await d.postcall.getCall(`replay-${c.id}-${c.calls[0]!.id}`);
    ok("second call continues the first call's record", !!callRow?.parentCallId && !!a?.enquiryId && a.enquiryId === callRow.enquiryId, "code", `first=${a?.enquiryId ?? "none"} second=${callRow?.enquiryId ?? "none"} parent=${callRow?.parentCallId ?? "none"}`);
  }
  if (x.sameCaller) {
    const a = await d.postcall.getCall(`replay-${c.id}-${c.calls[0]!.id}`);
    ok("both calls are recognised as one caller", !!a?.callerId && a.callerId === callRow?.callerId, "code");
  }
  if (x.agentOnly) ok(`live agent only: ${x.agentOnly}`, true, "script", "not testable offline: checked by the scans on real calls");

  const observed: Observed = { fit: enquiry?.fit ?? null, outcome: callRow?.outcome ?? null, booked, flags, escalation: esc, dealQueued, disclosureOk: callRow?.disclosureOk ?? null };
  return { case: c, checks, observed, ok: checks.every((k) => k.ok) };
}

// ------------------------------------------------------------------ the cases

const expectFor = (f: Fixture): Expect => f.expected.result === "fit" ? { fit: "fit", outcome: "booked", booked: true } : f.expected.result === "not_fit" ? { fit: "not_fit", outcome: "not_fit" } : { fit: "unclear", outcome: "review" };

function phoneCase(id: string, title: string, over: Partial<CallSpec> = {}, expect?: Partial<Expect>): ReplayCase {
  const fixture = FIXTURES.find((f) => f.id === id)!;
  const ex = { ...expectFor(fixture), ...expect };
  const close: Close = ex.outcome === "booked" ? "booked" : ex.outcome === "not_fit" ? "decline" : "review";
  const day = Number(fixture.call_date.slice(8)) % 20 + 1;
  return { id, group: "phone", title, expect: ex, calls: [{ id: "a", phone: nextPhone(), at: ist(day, 10 + (day % 6), 15), durationS: 240, caller: callerLines(id), close, fixture: id, claimedBooking: ex.outcome === "booked", ...over }] };
}

export function buildCases(): ReplayCase[] {
  phoneSeq = 0;
  const cases: ReplayCase[] = [
    phoneCase("T01", "Referral, 3BHK full home in Kothrud"),
    phoneCase("T02", "Asks the price twice, still books", { priceReply: "en" }),
    phoneCase("T03", "Nashik: outside the service area"),
    phoneCase("T04", "Advice only, no project: declined"),
    phoneCase("T05", "VIP referrer, 4BHK in Koregaon Park"),
    phoneCase("T06", "Office fit-out in Baner"),
    phoneCase("T07", "Needs it in three weeks: timeline too short"),
    { id: "T08", group: "phone", title: "Missed call at 10:47pm, nothing said", expect: { outcome: "missed" },
      calls: [{ id: "a", phone: nextPhone(), at: ist(9, 22, 47), durationS: 0, endedReason: "missed", caller: [], close: "none" }] },
    { id: "T09", group: "phone", title: "Existing client, five days without a reply: escalated, never qualified", expect: { outcome: "escalated", escalation: "complaint", noDeal: true },
      calls: [{ id: "a", phone: nextPhone(), at: ist(11, 11, 5), durationS: 150, close: "complaint", wantsPerson: true,
        caller: ["I need to speak to someone right now. My project has been going for three months and my designer hasn't replied in five days. This is not acceptable. My designer is Aryan. Flat in Viman Nagar."],
        extraction: { intent: "complaint", location: "Viman Nagar", summary: "Existing client; no reply from the designer for five days; wants a senior callback." } }] },
    phoneCase("T10", "Volunteers a very small budget: human review"),
    phoneCase("T11", "Rented flat, landlord consent"),
    phoneCase("T12", "Large villa in Kalyani Nagar"),
    phoneCase("T13", "Asks the price, 3 rooms in Aundh", { priceReply: "en" }),
    phoneCase("T14", "Son calling for his parents, owners will attend"),
    phoneCase("T15", "Possession date soon, 2BHK in Undri"),
    phoneCase("T16", "Frustrated: called Monday, nobody got back"),
    phoneCase("T17", "Call dropped, second call books"),
    phoneCase("T18", "180 sq ft coworking pod: below the minimum"),
    phoneCase("T19", "Restaurant in Koregaon Park: not served"),
    phoneCase("T20", "2BHK in Magarpatta, January start"),
  ];

  // ---- the ten hard cases (research plan, Gate 2) ----
  const hard: ReplayCase[] = [];
  const h = (n: number, title: string, c: Omit<ReplayCase, "group" | "hardCase" | "title" | "id">) => hard.push({ ...c, id: `H${n}`, group: "hard", hardCase: n, title });

  h(1, "Price push, English (T02): explains, books, says no number", { ...phoneCase("T02", "", { priceReply: "en" }), expect: { fit: "fit", outcome: "booked", booked: true } });
  h(2, "Price push, Hinglish (W03 style): same, in Hinglish", { expect: { fit: "fit", outcome: "booked", booked: true }, calls: [{ id: "a", phone: nextPhone(), at: ist(12, 14, 0), durationS: 270, close: "booked", priceReply: "hinglish", language: "en", fixture: "W03", claimedBooking: true,
    caller: ["Hi, mujhe Pimple Nilakh mein 3BHK ka poora interior karwana hai.", "Pehle ye bataiye, per sq ft kitna rate hoga aur total kitna kharcha aayega?", "Theek hai, to consultation book kar dijiye."] }] });
  h(3, "Angry existing client (T09): transferred or senior callback, no questions asked", { expect: { outcome: "escalated", escalation: "complaint", noDeal: true, agentOnly: "a live transfer in working hours, or the 10am senior callback promise" },
    calls: [{ id: "a", phone: nextPhone(), at: ist(13, 20, 30), durationS: 120, close: "complaint", wantsPerson: true, caller: ["This is Mr. Kulkarni. My flat is being done by Aangan. My designer Aryan has not replied for five days and the work has stopped. I want a senior person now."],
      extraction: { intent: "complaint", location: "Viman Nagar" } }] });
  h(4, "Son calling for parents (T14): books with the owners attending", { ...phoneCase("T14", ""), expect: { fit: "fit", outcome: "booked", booked: true } });
  h(5, "Repeat caller, lost note (T16): the number is recognised", { expect: { fit: "fit", outcome: "booked", booked: true, sameCaller: true, agentOnly: "the apology, said when the caller says nobody called back" },
    calls: [
      { id: "mon", phone: "+919000040001", at: ist(5, 15, 10), durationS: 200, close: "review", fixture: "T16", caller: ["Hi, I have a 3BHK in Viman Nagar and want the interiors done. My name is Girish Nair."], extraction: { scope: "unspecified" } },
      { id: "wed", phone: "+919000040001", at: ist(7, 10, 38), durationS: 318, close: "booked", fixture: "T16", claimedBooking: true, caller: callerLines("T16") }] });
  h(6, "Call drops mid-way (T17): the second call continues the first record", { expect: { fit: "fit", outcome: "booked", booked: true, continuesFirstCall: true, sameCaller: true },
    calls: [
      { id: "one", phone: "+919000040002", at: ist(22, 14, 14), durationS: 72, endedReason: "dropped", close: "none", caller: ["Hi, I wanted to inquire about"], extraction: {} },
      { id: "two", phone: "+919000040002", at: ist(22, 14, 17), durationS: 270, close: "booked", fixture: "T17", claimedBooking: true, caller: callerLines("T17") }] });
  h(7, "Edge location, Talegaon (F03): goes to the human queue", { ...phoneCase("F03", "", {}, { fit: "unclear", outcome: "review" }) });
  h(8, "Budget far below scope (T10): no floor stated, human review", { ...phoneCase("T10", "") });
  h(9, "Restaurant or gym (T19, W07): declines kindly, in Hindi too", { expect: { fit: "not_fit", outcome: "not_fit" }, calls: [
    { id: "a", phone: nextPhone(), at: ist(14, 11, 30), durationS: 150, close: "decline_hi", language: "hi", fixture: "T19", caller: ["मुझे अपने रेस्टोरेंट का इंटीरियर करवाना है, कोरेगांव पार्क में।"] }] });
  h(10, "\"Is this a robot? I want a person.\": confirms, transfers, never qualified", { expect: { outcome: "escalated", escalation: "human_requested", noDeal: true },
    calls: [{ id: "a", phone: nextPhone(), at: ist(15, 12, 0), durationS: 90, close: "robot", wantsPerson: true, caller: ["Is this a robot? I want a person.", "No, I want to speak to a real person please."], extraction: { intent: "new_enquiry", location: null } }] });

  return [...cases, ...hard, ...gateSelfTest()];
}

// ------------------------------------------------------------------ the price gate must be able to FAIL

/** A bad agent: each of these says a price-related number. A harness that lets one through is broken, so each must raise price_mention. */
const BAD: [string, string, string][] = [
  ["G1", "a total in lakh (English)", "For a 3BHK like that it will cost around 15 lakh."],
  ["G2", "a per-square-foot rate", "Our rate is ₹1,800 per sq ft for full interiors."],
  ["G3", "a range", "Typically between 8 and 10 lakh for a home that size."],
  ["G4", "a figure in rupees as digits", "The budget minimum for this work is Rs 1500000."],
  ["G5", "Hinglish", "Aapke project mein paanch lakh ke aas-paas lagega."],
  ["G6", "Hindi", "करीब पाँच लाख रुपये लगेंगे इस काम में।"],
  ["G7", "Marathi", "यासाठी सुमारे दोन लाख रुपये लागतील."],
  ["G8", "reading back a budget the caller volunteered", "You said your budget is 1.5 lakh, so we can work within that."],
];
function gateSelfTest(): ReplayCase[] {
  return BAD.map(([id, what, line], i) => ({ id, group: "gate" as const, title: `Gate self-test: the agent says ${what}: must be caught`,
    expect: { outcome: "booked" as Outcome, fit: "fit" as const, booked: true, flags: ["price_mention" as FlagKind] },
    calls: [{ id: "a", phone: `+919000050${String(i).padStart(3, "0")}`, at: ist(16, 11, 0), durationS: 200, close: "booked" as Close, claimedBooking: true, fixture: "T01", caller: ["We have a 3BHK in Kothrud."], agentLines: [OPEN, "Understood. What is your timeline?", line, BOOKED] }] }));
}

// ------------------------------------------------------------------ report

export async function runAll(): Promise<CaseResult[]> { const out: CaseResult[] = []; for (const c of buildCases()) out.push(await runCase(c)); return out; }

export function summarise(results: CaseResult[]) {
  const good = results.filter((r) => r.case.group !== "gate");
  const gate = results.filter((r) => r.case.group === "gate");
  const priceLeaks = good.filter((r) => r.observed.flags.includes("price_mention")).map((r) => r.case.id);
  return { cases: good.length, passed: good.filter((r) => r.ok).length, failed: good.filter((r) => !r.ok).map((r) => r.case.id), gateChecks: gate.length, gateCaught: gate.filter((r) => r.ok).length, priceLeaks,
    pass: good.every((r) => r.ok) && gate.every((r) => r.ok) && priceLeaks.length === 0 };
}

export function renderMarkdown(results: CaseResult[], when: string): string {
  const s = summarise(results);
  const row = (r: CaseResult) => `| ${r.case.id} | ${r.case.title} | ${r.observed.fit ?? "-"} | ${r.observed.outcome ?? "-"} | ${r.observed.booked ? "yes" : "no"} | ${r.observed.flags.length ? r.observed.flags.join(", ") : "none"} | ${r.ok ? "PASS" : "**FAIL**"} |`;
  const head = "| Case | What it checks | Rules say | Outcome | Booked | Audit flags | Result |\n|---|---|---|---|---|---|---|";
  const fails = results.filter((r) => !r.ok).flatMap((r) => r.checks.filter((k) => !k.ok).map((k) => `- ${r.case.id}: ${k.name} (${k.detail ?? ""})`));
  return [
    `# Replay report`, ``, `Run: ${when}. ${s.pass ? "**ALL PASS**" : "**FAILED**"}: ${s.passed}/${s.cases} calls, price gate caught ${s.gateCaught}/${s.gateChecks} planted violations, price numbers said by the scripted agent: ${s.priceLeaks.length}.`, ``,
    `Scope: our code (rules, router, booking, escalation, scans) is tested for real. The agent's own lines are a script of the approved wording, so what Vaani's live model says is NOT proven here; real calls get the same price and disclosure scans after the call (docs/replay-harness.md).`, ``,
    `## The 20 September phone calls`, ``, head, ...results.filter((r) => r.case.group === "phone").map(row), ``,
    `## The 10 hard cases`, ``, head, ...results.filter((r) => r.case.group === "hard").map(row), ``,
    `## Price gate self-test (a bad agent that says a price: each must be caught)`, ``, head, ...results.filter((r) => r.case.group === "gate").map(row), ``,
    ...(fails.length ? [`## Failures`, ``, ...fails, ``] : []),
  ].join("\n");
}
