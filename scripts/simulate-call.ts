// Local simulator: drives the real tool endpoints on localhost the way the voice agent would.
// Usage: pnpm dev (terminal 1)  |  pnpm simulate (terminal 2)
import { existsSync } from "node:fs";
import { emptyExtraction } from "../src/core/postcall/extraction";
import { loadTurns } from "../tests/postcall/transcripts";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH = { authorization: `Bearer ${process.env.TOOL_SHARED_SECRET}`, "content-type": "application/json" };
const call = async (path: string, body: unknown) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: AUTH, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const show = (label: string, r: { status: number; body: unknown }) => console.log(`  ${label} -> ${r.status}`, JSON.stringify(r.body));

async function scenario(name: string, run: () => Promise<void>) { console.log(`\n=== ${name}`); await run(); }

await scenario("T01 new enquiry: lookup -> check_fit => fit, proceed to booking (booking tools arrive next session)", async () => {
  show("lookup_caller", await call("/api/tools/lookup-caller", { phone: "9000000001", intent: "new_enquiry", first_utterance: "We have a 3BHK in Kothrud and want to redo the whole thing" }));
  show("check_fit", await call("/api/tools/check-fit", { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, deadline_date: "2027-03-31", decision_maker: "owner" }));
});

await scenario("T07 timeline too short -> decline text + later start, then re-run with the new deadline", async () => {
  const f = { location: "Kothrud", project_type: "home", scope: "partial_home", rooms_count: 2 };
  show("check_fit (3 weeks)", await call("/api/tools/check-fit", { ...f, deadline_date: new Date(Date.now() + 21 * 86400e3).toISOString().slice(0, 10) }));
  show("check_fit (caller accepts a later start)", await call("/api/tools/check-fit", { ...f, deadline_date: new Date(Date.now() + 90 * 86400e3).toISOString().slice(0, 10) }));
});

await scenario("T10 / hard case 8: tiny volunteered budget -> human review, budget never echoed", async () => {
  show("check_fit", await call("/api/tools/check-fit", { location: "Kharadi", project_type: "home", scope: "partial_home", rooms_count: 2, bhk: 1, carpet_sqft: 550, budget_inr: 150000 }));
  show("request_human(review)", await call("/api/tools/request-human", { reason: "review", summary: "budget below scope" }));
});

await scenario("Hard case 7: Talegaon (edge) -> human review", async () => {
  show("check_fit", await call("/api/tools/check-fit", { location: "Talegaon Dabhade, near Pune", project_type: "home", scope: "full_home", bhk: 3 }));
});

await scenario("Hard case 9: restaurant -> decline kindly (Hindi)", async () => {
  show("check_fit", await call("/api/tools/check-fit", { location: "Koregaon Park", project_type: "restaurant", language: "hi" }));
});

await scenario("Hard case 10: 'Is this a robot? I want a person.'", async () => {
  show("request_human(human_requested)", await call("/api/tools/request-human", { reason: "human_requested" }));
  show("request_human(complaint, transfer failed)", await call("/api/tools/request-human", { reason: "complaint", transfer_failed: true }));
});

await scenario("T07 with a festival: never trust the caller's distance; resolve, read back, then check", async () => {
  const r = await call("/api/tools/resolve-date", { text: "I want it done before Diwali, it's only three weeks away" });
  show("resolve_date", r);
  const b = r.body as { date?: string };
  if (b?.date) show("check_fit(confirmed date)", await call("/api/tools/check-fit", { location: "Kothrud", project_type: "home", scope: "partial_home", rooms_count: 2, deadline_date: b.date }));
  show("resolve_date(unknown event)", await call("/api/tools/resolve-date", { text: "before Ganesh Chaturthi" }));
});

await scenario("T09-style angry existing client (unknown number, keyword guard)", async () => {
  show("lookup_caller", await call("/api/tools/lookup-caller", { phone: "9000000009", first_utterance: "My project has been going for three months and my designer hasn't replied in five days" }));
  show("request_human(complaint)", await call("/api/tools/request-human", { reason: "complaint", phone: "9000000009", summary: "designer silent 5 days" }));
});

await scenario("Existing client in lookup + price push: never qualified", async () => {
  await call("/api/dev/seed", { callers: [{ phone: "9000000002", name: "Sheetal", isExistingClient: true }] });
  show("lookup_caller", await call("/api/tools/lookup-caller", { phone: "9000000002", intent: "new_enquiry" }));
});

await scenario("T17-style dropped call, caller rings back within 2 minutes", async () => {
  await call("/api/dev/seed", { callers: [{ phone: "9000000003", calls: [{ minutesAgo: 2, endedReason: "dropped", enquiryId: "enq-17" }] }] });
  show("lookup_caller", await call("/api/tools/lookup-caller", { phone: "9000000003", intent: "new_enquiry" }));
});

await scenario("T16-style repeat caller whose earlier note was lost", async () => {
  await call("/api/dev/seed", { callers: [{ phone: "9000000004", name: "Girish", calls: [{ minutesAgo: 60 * 24 * 4, endedReason: "completed", handoffDelivered: false }] }] });
  show("lookup_caller", await call("/api/tools/lookup-caller", { phone: "9000000004", intent: "new_enquiry", first_utterance: "I called on Monday about a project, it's been two days" }));
});

await scenario("Booking end to end (fake calendar + fake Telegram): check_fit -> get_slots -> book_slot", async () => {
  const fit = await call("/api/tools/check-fit", { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, deadline_date: "2027-03-31",
    decision_maker: "owner", owners_attending: true, caller_name: "Priya", caller_email: "priya@example.com" });
  show("check_fit", fit);
  const id = (fit.body as { enquiry_id: string }).enquiry_id;
  const slots = await call("/api/tools/get-slots", { enquiry_id: id });
  show("get_slots", slots);
  const first = (slots.body as { slots: { start: string }[] }).slots[1]!;
  const booked = await call("/api/tools/book-slot", { enquiry_id: id, start: first.start, idempotency_key: "sim-1" });
  show("book_slot", booked);
  show("book_slot (retry, same key)", await call("/api/tools/book-slot", { enquiry_id: id, start: first.start, idempotency_key: "sim-1" }));
});

await scenario("A non-fit enquiry can never be booked, even if the model tries (Talegaon => human review)", async () => {
  const fit = await call("/api/tools/check-fit", { location: "Talegaon", project_type: "home", scope: "full_home", bhk: 3 });
  show("check_fit", fit);
  const id = (fit.body as { enquiry_id: string }).enquiry_id;
  show("get_slots", await call("/api/tools/get-slots", { enquiry_id: id }));
  show("book_slot", await call("/api/tools/book-slot", { enquiry_id: id, start: new Date(Date.now() + 3 * 86400e3).toISOString() }));
});

await scenario("Auth: wrong secret is rejected", async () => {
  const r = await fetch(`${BASE}/api/tools/lookup-caller`, { method: "POST", headers: { authorization: "Bearer wrong" }, body: "{}" });
  console.log("  ->", r.status);
});

// ---------------------------------------------------------------- post-call pipeline ----
const get = async (path: string) => (await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${process.env.TOOL_SHARED_SECRET}` } })).json();
const OPEN = "Namaste, Aangan Studio. I'm Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?";
const callRec = (id: string, transcript: unknown[], o: Record<string, unknown> = {}) => ({ vendor: "fake", vendorCallId: id, callerPhone: "+919000000021",
  rangAt: new Date(Date.now() - 8 * 60e3).toISOString(), answeredAt: new Date(Date.now() - 8 * 60e3 + 2e3).toISOString(), endedAt: new Date().toISOString(),
  durationS: 450, endedReason: "completed", transcript, ...o });
const extraction = (o: Record<string, unknown>) => ({ ...emptyExtraction(), language: "en", intent: "new_enquiry", ...o });
const preload = (id: string, e: unknown) => call("/api/dev/extractions", { vendorCallId: id, extraction: e });

await scenario("POST-CALL 1: clean agent call, live tools -> booking -> pipeline (outcome booked, note drafted, deal + email queued)", async () => {
  const id = "sim-pc-1";
  await call("/api/tools/lookup-caller", { phone: "9000000021", call_id: id, intent: "new_enquiry" });
  const fit = await call("/api/tools/check-fit", { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, deadline_date: "2027-03-31", decision_maker: "owner",
    owners_attending: true, call_id: id, phone: "9000000021", caller_name: "Priya", caller_email: "priya@example.com" });
  const enq = (fit.body as { enquiry_id: string }).enquiry_id;
  const slots = await call("/api/tools/get-slots", { enquiry_id: enq });
  await call("/api/tools/book-slot", { enquiry_id: enq, start: (slots.body as { slots: { start: string }[] }).slots[1]!.start });
  await preload(id, extraction({ caller_name: "Priya", caller_email: "priya@example.com", location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400,
    decision_maker: "owner", owners_attending: true, deadline: { kind: "month", date: null, month: 3, year: null, festival: null, value: null, unit: null, text: "by March" }, summary: "3BHK full redesign in Kothrud; owners will attend." }));
  const turns = [{ speaker: "agent", text: OPEN }, { speaker: "caller", text: "We have a 3BHK in Kothrud, about 1,400 sq ft, and want to redo the whole thing." },
    { speaker: "agent", text: "I have Thursday at 11 or Friday at 10. Which suits you?" }, { speaker: "caller", text: "Friday." }, { speaker: "agent", text: "Booked." }];
  show("process", await call("/api/calls/process", callRec(id, turns)));
  show("state", { status: 200, body: await get(`/api/dev/state?call=${id}`) });
});

await scenario("POST-CALL 2: the human desk's REAL T10 call (it quoted a floor: the agent must never do this)", async () => {
  const id = "sim-pc-2";
  await preload(id, extraction({ location: "Kharadi", project_type: "home", scope: "partial_home", rooms_count: 2, bhk: 1, carpet_sqft: 550, budget_inr: 150000 }));
  show("process", await call("/api/calls/process", callRec(id, loadTurns("T10"), { callerPhone: "+919000000022" })));
  show("state", { status: 200, body: await get(`/api/dev/state?call=${id}`) });
});

await scenario("POST-CALL 3: the REAL T09 complaint, handled as if the agent had qualified it instead of escalating", async () => {
  const id = "sim-pc-3";
  await preload(id, extraction({ intent: "complaint", location: "Viman Nagar", complaint_signals: ["my designer hasn't replied in five days"] }));
  show("process", await call("/api/calls/process", callRec(id, loadTurns("T09"), { callerPhone: "+919000000023" })));
  show("state", { status: 200, body: await get(`/api/dev/state?call=${id}`) });
});

await scenario("DRAIN alerts: what the owner and Nikhil would receive on Telegram", async () => {
  show("drain", await call("/api/outbox/drain", {}));
  const st = (await get("/api/dev/state")) as { alertsSent: { chatId: number; text: string }[] };
  for (const al of st.alertsSent) console.log(`  -> chat ${al.chatId}: ${al.text.replace(/\n/g, " | ")}`);
});
