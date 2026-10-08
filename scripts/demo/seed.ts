import { readdirSync, readFileSync } from "node:fs";
import { makeDeps } from "../../src/server/deps";
import { demoScoped } from "../../src/db/open";
import type { SqlClient } from "../../src/db/pg-booking-repo";
import { hashPhone } from "../../src/lib/phone";
import { addWorkingMinutes } from "../../src/core/booking/working-minutes";
import { emptyExtraction, type Extraction } from "../../src/core/postcall/extraction";
import type { CallRecordInput, CallTurn } from "../../src/core/postcall/types";
import { FIXTURES, type Fixture } from "../../tests/fixtures/enquiries";
import { loadTurns } from "../../tests/postcall/transcripts";
import { resetDemo } from "./reset";

// The demo: all 40 September enquiries (docs/enquiries/) replayed as phone calls through the REAL pipeline, rules engine, router, booking service,
// handoff service and outbox, with fake Vaani / Cal.com / Telegram / HubSpot / Resend / Gemini. Every row is marked is_demo (migration 0005).
// Nothing here talks to a real service: the environment handed to makeDeps carries no API keys, so every adapter is its in-memory fake.

const RATE_INR_PER_MIN = 5.31;          // the Vaani dashboard's per-minute rate (docs/vaanivoice-findings.md)
const DEMO_NOW = new Date("2026-09-30T14:30:00Z"); // end of September, 20:00 IST: consultations before this have happened
const OPEN = "Namaste, Aangan Studio. I'm Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?";
const NEUTRAL = ["Understood, thank you.", "Got it. Tell me a little more.", "That helps. What is your timeline?", "Thanks. Who will be deciding on the project?", "Noted. How did you hear about us?", "Thank you. Anything else I should pass on to the designer?"];
const PRICE_EXPLAINED = "I can't give a number before a designer has seen the site, because materials alone can change the cost of one kitchen a great deal. The consultation is free, and it ends with a real number.";
const FIRST = ["Priya", "Rahul", "Sneha", "Amit", "Kavita", "Vikram", "Anjali", "Rohan", "Neha", "Sanjay", "Pooja", "Arjun", "Divya", "Karan", "Meena", "Nitin", "Isha", "Manish", "Rekha", "Yash"];
const LAST = ["Kulkarni", "Joshi", "Patil", "Deshmukh", "Shah", "Rao", "Mehta", "Bhosale", "Iyer", "Naik"];
const DESIGNERS: [string, boolean, boolean][] = [["Aryan Kulkarni", true, false], ["Meera Joshi", false, true], ["Rohan Patil", false, false], ["Sneha Deshmukh", false, false], ["Kabir Shah", false, false], ["Ananya Rao", false, false]];

function rngOf(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const MONTHS: Record<string, number> = { september: 9, sept: 9, sep: 9 };

interface Item { id: string; at: Date; durationS: number; fixture?: Fixture; header: string; index: number }

/** IST wall-clock -> instant. */
const ist = (y: number, m: number, d: number, hh: number, mm: number) => new Date(Date.UTC(y, m - 1, d, hh, mm) - 330 * 60_000);
const istParts = (t: Date) => { const x = new Date(t.getTime() + 330 * 60_000); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), dow: x.getUTCDay(), h: x.getUTCHours(), min: x.getUTCMinutes() }; };

function parseItems(rand: () => number): Item[] {
  const ids = readdirSync("docs/enquiries").filter((f) => /^[TWF]\d\d\.md$/.test(f)).map((f) => f.replace(".md", "")).sort();
  const items = ids.map((id, index) => {
    const text = readFileSync(`docs/enquiries/${id}.md`, "utf8");
    const fixture = FIXTURES.find((f) => f.id === id);
    const header = text.split("\n").slice(0, 4).join(" ");
    const day = Number(/(\d{1,2})(?:[–-]\d{1,2})? (?:September|Sept)/i.exec(header)?.[1] ?? fixture?.call_date.slice(8) ?? 15);
    const tm = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(text);
    let hh = tm ? Number(tm[1]) % 12 + (tm[3]!.toLowerCase() === "pm" ? 12 : 0) : 10 + Math.floor(rand() * 8), mm = tm ? Number(tm[2]) : Math.floor(rand() * 60);
    // spread: every sixth enquiry is moved to the evening or night, so the dashboard has a real after-hours share (the missed call T08 is already 10:47pm)
    if (index % 6 === 4 && id !== "T08" && id !== "T09") { hh = 19 + (index % 4); mm = (index * 13) % 60; }
    const dur = /(\d+) min (\d+) sec/.exec(header);
    const durationS = dur ? Number(dur[1]) * 60 + Number(dur[2]) : 150 + Math.floor(rand() * 330);
    void MONTHS;
    return { id, at: ist(2026, 9, day, hh, mm), durationS, fixture, header, index } satisfies Item;
  });
  return items.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
}

/** The caller's own name from the document (form field, WhatsApp sender, or "I'm ..."); a made-up one only when the document never gives it. */
function nameFrom(id: string, fallback: string): string {
  const text = readFileSync(`docs/enquiries/${id}.md`, "utf8");
  const cap = "[A-Z][a-z]+(?: [A-Z][a-z]+)?";
  const m = new RegExp(`Name:\\s*(${cap})`).exec(text) ?? new RegExp(`your name[\\s\\S]*?Caller:\\s*(${cap})[.,]`).exec(text) ?? new RegExp(`— (${cap}):`).exec(text) ?? new RegExp(`(?:I'm|I’m|I am|This is|my name is)\\s+(${cap})`).exec(text.split("\n").filter((l) => /^Caller:/.test(l) || /^[^A-Z]*Caller/.test(l)).join(" "));
  const n = m?.[1]?.trim();
  return n && !/^(Front|Aangan|Caller|Unknown)/.test(n) ? n : fallback;
}

function extractionFor(it: Item, name: string, language: "en" | "hi" | "mr", withEmail: boolean): Extraction {
  const i = (it.fixture?.input ?? {}) as Record<string, unknown>;
  const e = emptyExtraction();
  const str = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : null), num = (k: string) => (typeof i[k] === "number" ? (i[k] as number) : null), bool = (k: string) => (typeof i[k] === "boolean" ? (i[k] as boolean) : null);
  const dl = str("deadline_date");
  const scope = (str("scope") ?? "unspecified") as Extraction["scope"];
  Object.assign(e, {
    language, intent: it.id === "T09" ? "complaint" : "new_enquiry", caller_name: name, caller_email: withEmail ? `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com` : null,
    location: str("location"), project_type: (str("project_type") ?? "unknown") as Extraction["project_type"], scope, rooms_count: num("rooms_count"), bhk: num("bhk"), is_villa: bool("is_villa"),
    carpet_sqft: num("carpet_sqft"), deadline: dl ? { kind: "date", date: dl, month: null, year: null, festival: null, value: null, unit: null, text: `by ${dl}` } : null,
    start_date: str("start_date"), possession_date: str("possession_date"), decision_maker: (str("decision_maker") ?? "unknown") as Extraction["decision_maker"], owners_attending: bool("owners_attending"),
    tenure: (str("tenure") ?? "unknown") as Extraction["tenure"], landlord_consent: bool("landlord_consent"), structural_work: (str("structural_work") ?? "unknown") as Extraction["structural_work"],
    budget_inr: num("budget_inr"), referrer: str("referrer"), asked_for_price: !!i.price_asked, frustrated: !!i.frustrated, exploring_only: !!i.exploring_only,
  } satisfies Partial<Extraction>);
  const bits = [e.bhk ? `${e.bhk}BHK` : null, scope !== "unspecified" ? scope.replace(/_/g, " ") : null, e.location ? `in ${e.location.split(",")[0]}` : null].filter(Boolean);
  const said = bits.join(" ");
  e.summary = it.id === "T09" ? "Existing client; no reply from the designer for five days; wants a senior callback."
    : !bits.length ? "General enquiry; few details given."
    : scope === "unspecified" && !e.bhk ? `Enquiry ${said}; few other details given.`
    : `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
  return e;
}

function transcriptFor(it: Item, e: Extraction, booked: { label: string } | null, expected: string | undefined): CallTurn[] {
  const caller = loadTurns(it.id).filter((t) => t.speaker === "caller").map((t) => t.text).filter(Boolean);
  const said = caller.length ? caller : [`Hello, I'd like help with ${e.scope === "unspecified" ? "my home" : e.scope.replace(/_/g, " ")}${e.location ? ` in ${e.location.split(",")[0]}` : ""}${e.bhk ? `, a ${e.bhk}BHK` : ""}${e.carpet_sqft ? `, about ${e.carpet_sqft} square feet` : ""}.`];
  const turns: CallTurn[] = [{ speaker: "agent", text: OPEN }];
  said.slice(0, 8).forEach((t, j) => {
    turns.push({ speaker: "caller", text: t });
    const askedCost = /cost|price|rate|how much|budget/i.test(t) && e.asked_for_price;
    turns.push({ speaker: "agent", text: it.id === "T09" ? "I'm very sorry. I'm getting this to a senior person now, and someone will call you back." : askedCost ? PRICE_EXPLAINED : NEUTRAL[j % NEUTRAL.length]! });
  });
  const close = booked ? `I have ${booked.label}. Booked. The designer will already know what you've told me, and you'll get a confirmation email.`
    : expected === "not_fit" ? "Thank you for explaining. That is outside what we take on right now, so I won't waste your time. If your plans change, please call again."
    : it.id === "T09" ? "" : expected === "unclear" ? "Thank you. I'll have a person from our team call you in working hours." : "Thank you. Our team will be in touch.";
  if (close) turns.push({ speaker: "agent", text: close });
  return turns;
}

const nextWorkday = (t: Date, plusDays: number) => { let x = new Date(t.getTime() + plusDays * 86_400_000); for (;;) { const p = istParts(x); if (p.dow >= 1 && p.dow <= 5) return p; x = new Date(x.getTime() + 86_400_000); } };

export interface SeedReport { calls: number; booked: number; handoffs: number; deals: number }

export async function seedDemo(db: SqlClient, env: { PHONE_HASH_PEPPER: string; PHONE_ENC_KEY: string }, opts: { force?: boolean; log?: (s: string) => void } = {}): Promise<SeedReport> {
  const log = opts.log ?? (() => {});
  await resetDemo(db, { force: opts.force });          // refuses while real calls exist; a re-run never duplicates
  await demoScoped(db, true);                          // every row this connection creates is marked demo
  try { return await run(db, env, log); } finally { await demoScoped(db, false); }
}

async function run(db: SqlClient, env: { PHONE_HASH_PEPPER: string; PHONE_ENC_KEY: string }, log: (s: string) => void): Promise<SeedReport> {
  const rand = rngOf(20260930);
  const clock = { t: new Date("2026-09-01T04:00:00Z") };
  // No API keys in this environment: every adapter is its in-memory fake (Gemini, Telegram, HubSpot, Resend, Vaani), whatever the real .env.local holds.
  const deps = makeDeps({ db, now: () => clock.t, pipelineMode: "prompt_only", designerNames: ["Aryan", "Meera"],
    env: { NODE_ENV: "development", PHONE_HASH_PEPPER: env.PHONE_HASH_PEPPER, PHONE_ENC_KEY: env.PHONE_ENC_KEY, TOOL_SHARED_SECRET: "demo-seed-not-a-real-secret", VAANIVOICE_RATE_INR_PER_MIN: String(RATE_INR_PER_MIN) } });
  if (!deps.fakeExtractor || !deps.fakeNotifier || !deps.fakeCrm || !deps.fakeEmail) throw new Error("demo seed must run on fakes only");

  for (const [i, [name, principal, lead]] of DESIGNERS.entries())
    await db.query("insert into designers(name, areas, project_types, calendar_id, telegram_chat_id, is_principal, is_design_lead, active, is_test) values ($1,'{}',array['home','office'],$2,$3,$4,$5,true,false)", [name, `demo-cal-${i + 1}`, 7001 + i, principal, lead]);

  const items = parseItems(rand);
  const MISSING = new Set(["F06"]);                    // the agent says it booked; Cal.com never shows one: the router's urgent case
  let booked = 0, deals = 0;

  // a Cal.com booking nobody called about (a stray, or one made another way). The router reports it 45 minutes after Cal.com created it,
  // so it is created, and the router run, at that moment of the month (in production the router runs every minute).
  const orphanAt = ist(2026, 9, 17, 12, 0), orphanReportAt = new Date(orphanAt.getTime() + 50 * 60_000);
  let orphanDone = false;
  const orphan = async () => {
    orphanDone = true;
    await deps.calStore.upsert({ uid: "demo-bk-orphan", eventTypeId: 1, title: "Aangan consultation", status: "accepted", startsAt: ist(2026, 9, 22, 11, 0), endsAt: ist(2026, 9, 22, 12, 0), attendeeEmail: "walk.in@example.com", attendeeName: "Walk In", attendeePhoneHash: null, createdAt: orphanAt });
    clock.t = orphanReportAt; await deps.router.routePending();
  };

  for (const it of items) {
    if (!orphanDone && it.at > orphanReportAt) await orphan();
    const n = it.index + 1;
    const name = nameFrom(it.id, `${FIRST[(n * 7) % FIRST.length]} ${LAST[(n * 3) % LAST.length]}`);
    const phone = `+9190000${String(10000 + n)}`;
    const language = n % 10 === 7 || n % 10 === 8 ? "hi" : n % 10 === 9 ? "mr" : "en";
    const callId = `demo-${it.id}`;
    const end = new Date(it.at.getTime() + it.durationS * 1000);
    const isFit = it.fixture?.expected.result === "fit";
    const wantsBooking = isFit && (MISSING.has(it.id) || rand() < 0.85);
    const missing = MISSING.has(it.id);

    // ---- the call record, as the vaanivoice adapter would hand it to the pipeline ----
    if (it.id === "T08") {
      clock.t = new Date(end.getTime() + 20_000);
      await deps.pipeline!.process({ vendor: "vaanivoice", vendorCallId: callId, rangAt: it.at.toISOString(), endedAt: it.at.toISOString(), durationS: 0, endedReason: "missed", transcript: [] });
      continue;
    }
    const e = extractionFor(it, name, language, wantsBooking && rand() < 0.8);
    const sp = nextWorkday(end, 1 + Math.floor(rand() * 4));
    const startsAt = ist(sp.y, sp.m, sp.d, n % 2 ? 11 : 15, 0);
    const label = `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][sp.dow]} ${sp.d} September, ${n % 2 ? "11:00 am" : "3:00 pm"}`;
    deps.fakeExtractor.set(callId, e);
    const rec: CallRecordInput = { vendor: "vaanivoice", vendorCallId: callId, callerPhone: phone, rangAt: it.at.toISOString(), answeredAt: new Date(it.at.getTime() + (2 + Math.floor(rand() * 5)) * 1000).toISOString(),
      endedAt: end.toISOString(), durationS: it.durationS, endedReason: "completed", transcript: transcriptFor(it, e, wantsBooking && !missing ? { label } : null, it.fixture?.expected.result), recordingRef: `https://recordings.example.invalid/${callId}`,
      voiceCostInr: Math.round((it.durationS / 60) * RATE_INR_PER_MIN * 100) / 100, voiceRateInrPerMin: RATE_INR_PER_MIN, signals: { claimedBooking: wantsBooking, wantsPerson: it.id === "T09" } };

    const calBooking = wantsBooking && !missing ? { uid: `demo-bk-${it.id}`, eventTypeId: 1, title: "Aangan consultation", status: "accepted" as const, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000),
      attendeeEmail: e.caller_email, attendeeName: name, attendeePhoneHash: hashPhone(phone, env.PHONE_HASH_PEPPER), createdAt: new Date(it.at.getTime() + it.durationS * 600) } : null;
    const bookingFirst = n % 2 === 0;                  // both arrival orders, as in real life (Cal.com's webhook can beat or trail the post-call webhook)
    if (calBooking && bookingFirst) await deps.calStore.upsert(calBooking);
    clock.t = new Date(end.getTime() + 20_000);
    await deps.pipeline!.process(rec);
    if (calBooking && !bookingFirst) { clock.t = new Date(end.getTime() + 90_000); await deps.calStore.upsert(calBooking); await deps.router.routePending(); }

    // ---- the designer's side: Accept / decline / no answer, through the real handoff service ----
    if (calBooking) {
      booked++;
      const b = await deps.bookingRepo.findByIdempotencyKey(`cal:${calBooking.uid}`);
      if (b) await designerResponds(deps, clock, b.id, rand);
    }
    await deps.router.routePending();
    await deps.outbox.run(); await deps.alerts.drain();
  }

  if (!orphanDone) await orphan();
  // the sweeps (call end + 15 min) and the orphan report happen once real time has passed
  clock.t = new Date("2026-09-30T10:00:00Z");
  await deps.router.routePending(); await deps.outbox.run(); await deps.alerts.drain();

  // fixed monthly fees (assumptions: see docs/decisions.md, "demo data")
  await db.query(`insert into usage_costs(occurred_at, period_month, line, provider, quantity, unit, unit_cost, currency, fx_inr_per_usd, amount_inr, source) values
    ('2026-09-01T00:00:00+05:30','2026-09-01','phone_number','vobiz',1,'month',750,'INR',null,750,'manual_fixed'),
    ('2026-09-01T00:00:00+05:30','2026-09-01','hosting','vercel-pro',1,'month',20,'USD',88,1760,'manual_fixed'),
    ('2026-09-01T00:00:00+05:30','2026-09-01','other_fixed','supabase-pro',1,'month',25,'USD',88,2200,'manual_fixed')`);

  deals = await afterTheConsultations(db, rand);
  await normalizeTimestamps(db);
  const handoffs = Number((await db.query("select count(*)::int n from handoffs where is_demo")).rows[0]!.n);
  log(`seeded ${items.length} calls, ${booked} booked, ${handoffs} handoffs, ${deals} deals`);
  return { calls: items.length, booked, handoffs, deals };
}

/** Accept (most), decline, or no answer in time (then the 30-working-minute sweep reassigns), all through HandoffService. */
async function designerResponds(deps: ReturnType<typeof makeDeps>, clock: { t: Date }, bookingId: string, rand: () => number) {
  const press = async (kind: "a" | "d") => {
    const hs = await deps.bookingRepo.handoffsForBooking(bookingId);
    const h = [...hs].reverse().find((x) => x.status === "sent" || x.status === "pending");
    if (!h) return;
    const d = await deps.bookingRepo.getDesigner(h.designerId);
    if (!d?.telegramChatId) return;
    await deps.handoff.handleCallback({ callbackQueryId: "demo", fromChatId: d.telegramChatId, data: `h:${h.id}:${kind}` });
  };
  const at = (from: Date, lo: number, hi: number) => addWorkingMinutes(from, lo + Math.floor(rand() * (hi - lo)));
  const first = (await deps.bookingRepo.handoffsForBooking(bookingId)).at(-1);
  if (!first?.sentAt) return;
  const r = rand();
  if (r < 0.68) { clock.t = at(first.sentAt, 3, 26); await press("a"); }
  else if (r < 0.82) { clock.t = at(first.sentAt, 4, 20); await press("d"); const nx = (await deps.bookingRepo.handoffsForBooking(bookingId)).at(-1); if (nx?.sentAt && nx.status === "sent") { clock.t = at(nx.sentAt, 3, 15); await press("a"); } }
  else { clock.t = new Date(first.dueAt.getTime() + 60_000); await deps.handoff.sweep(); const nx = (await deps.bookingRepo.handoffsForBooking(bookingId)).at(-1); if (nx?.sentAt && nx.status === "sent") { clock.t = at(nx.sentAt, 5, 20); await press("a"); } }
}

/** What happens after the call that no code of ours drives yet: consultations held, quotes, wins (designers' updates, via HubSpot). Demo values only. */
async function afterTheConsultations(db: SqlClient, rand: () => number): Promise<number> {
  const rows = (await db.query("select b.id, b.starts_at, b.enquiry_id, l.id as crm_id from bookings b left join crm_links l on l.enquiry_id = b.enquiry_id where b.is_demo and b.status in ('confirmed','held') order by b.starts_at")).rows;
  let deals = 0;
  for (const r of rows) {
    const starts = new Date(String(r.starts_at));
    if (starts > DEMO_NOW) { if (r.crm_id) await db.query("update crm_links set stage='consult_booked', stage_changed_at=$2::timestamptz where id=$1", [r.crm_id, starts.toISOString()]); continue; }
    const x = rand();
    if (x > 0.9) { await db.query("update bookings set status='no_show' where id=$1", [r.id]); if (r.crm_id) await db.query("update crm_links set stage='lost', stage_changed_at=$2::timestamptz where id=$1", [r.crm_id, starts.toISOString()]); continue; }
    await db.query("update bookings set status='attended' where id=$1", [r.id]);
    if (!r.crm_id) continue;
    const day = (k: number) => new Date(starts.getTime() + k * 86_400_000).toISOString();
    const y = rand();
    if (y < 0.4) await db.query("update crm_links set stage='consult_held', stage_changed_at=$2::timestamptz where id=$1", [r.crm_id, starts.toISOString()]);
    else if (y < 0.72) { await db.query("update crm_links set stage='quote_sent', deal_amount_inr=$3, stage_changed_at=$2::timestamptz where id=$1", [r.crm_id, day(3), 100_000 * Math.round(8 + rand() * 40)]); deals++; }
    else if (y < 0.9) { await db.query("update crm_links set stage='won', deal_amount_inr=$3, stage_changed_at=$2::timestamptz where id=$1", [r.crm_id, day(9), 100_000 * Math.round(8 + rand() * 40)]); deals++; }
    else { await db.query("update crm_links set stage='lost', deal_amount_inr=null, stage_changed_at=$2::timestamptz where id=$1", [r.crm_id, day(6)]); }
  }
  // deals created for fit enquiries that never booked sit at 'new'
  await db.query("update crm_links set stage='new' where is_demo and stage is null");
  return deals;
}

/** Rows that take the database's own now() as their creation time get the time the thing happened in the demo month (the dashboard reads those columns). */
async function normalizeTimestamps(db: SqlClient) {
  await db.query("update calls set created_at = coalesce(rang_at, ended_at, created_at) where is_demo");
  await db.query("update escalations e set created_at = coalesce(c.ended_at, c.rang_at) from calls c where c.id = e.call_id and e.is_demo");
  await db.query("update escalations set resolved_at = created_at + interval '12 minutes' where is_demo and reason = 'complaint'");
  await db.query("update audit_flags f set created_at = coalesce(c.ended_at, c.rang_at) from calls c where c.id = f.call_id and f.is_demo");
  await db.query("update outbox o set created_at = c.ended_at + interval '15 minutes' from calls c where o.is_demo and c.vaani_call_id = o.payload->>'vendorCallId'");
  await db.query("update outbox o set created_at = c.ended_at + interval '1 minute' from calls c where o.is_demo and not (o.payload ? 'vendorCallId') and o.payload ? 'enquiryId' and c.enquiry_id::text = o.payload->>'enquiryId'");
  await db.query("update outbox o set created_at = (select b.created_at + interval '45 minutes' from calcom_bookings b where b.uid = o.payload->>'bookingUid') where o.is_demo and o.payload ? 'bookingUid' and o.payload->>'kind' = 'booking_orphan'");
}
