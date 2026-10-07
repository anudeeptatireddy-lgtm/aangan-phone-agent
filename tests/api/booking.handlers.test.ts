import { describe, it, expect, beforeEach } from "vitest";
import { makeDeps, MemoryDeps as Deps } from "@/server/deps";
import { handleTool } from "@/server/handlers/tools";

const SECRET = "tool-secret-0123456789";
const NOW = new Date("2026-10-07T06:30:00Z"); // Wednesday 12:00 IST
const mk = () => makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: SECRET }, now: () => NOW });
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const call = async (tool: Parameters<typeof handleTool>[0], body: unknown, d: Deps) => { const r = await handleTool(tool, post(body), d); return { status: r.status, json: await r.json() }; };

const T01 = { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, deadline_date: "2027-03-31", decision_maker: "owner", owners_attending: true };
let d: Deps;
beforeEach(() => { d = mk(); });

describe("check_fit persists the enquiry and returns its id", () => {
  it("fit -> enquiry_id, stamped with the rule version", async () => {
    const { json } = await call("check_fit", { ...T01, caller_name: "Priya", caller_email: "priya@example.com" }, d);
    expect(json).toMatchObject({ result: "fit", rule_version: "v1" });
    expect(json.enquiry_id).toBeTruthy();
    expect(d.enquiries.get(json.enquiry_id)).toMatchObject({ fit: "fit", ruleVersion: "v1", callerName: "Priya", callerEmail: "priya@example.com" });
  });
  it("re-running with an enquiry_id updates the SAME enquiry (T07: caller accepts a later start)", async () => {
    const first = await call("check_fit", { ...T01, deadline_date: "2026-10-28" }, d);
    expect(first.json).toMatchObject({ result: "not_fit", next_action: "offer_later_start" });
    const second = await call("check_fit", { ...T01, deadline_date: "2027-01-31", enquiry_id: first.json.enquiry_id }, d);
    expect(second.json).toMatchObject({ result: "fit", enquiry_id: first.json.enquiry_id });
    expect(d.enquiries.get(first.json.enquiry_id)!.fit).toBe("fit");
  });
  it("unknown enquiry_id -> 404", async () => {
    expect((await call("check_fit", { ...T01, enquiry_id: "nope" }, d)).status).toBe(404);
  });
});

describe("get_slots + book_slot end to end", () => {
  it("fit -> slots -> booked; designer notified; calendar event created; nothing sensitive in the responses", async () => {
    const { json: fit } = await call("check_fit", { ...T01, caller_name: "Priya", caller_email: "priya@example.com" }, d);
    const slots = await call("get_slots", { enquiry_id: fit.enquiry_id }, d);
    expect(slots.status).toBe(200);
    expect(slots.json).toMatchObject({ next_action: "offer_slots" });
    expect(slots.json.slots).toHaveLength(3);
    expect(slots.json.slots[0].label).toBe("Wednesday 7 October, 2:00 pm"); // 12:00 now + 2h minimum lead
    const booked = await call("book_slot", { enquiry_id: fit.enquiry_id, start: slots.json.slots[1].start }, d);
    expect(booked.json).toMatchObject({ ok: true, handoff_sent: true });
    expect(d.fakeCalendar!.events).toHaveLength(1);
    expect(d.fakeNotifier!.handoffs).toHaveLength(1);
    const text = JSON.stringify([slots.json, booked.json]);
    expect(text).not.toMatch(/TEST Designer|priya@example\.com|\+?\d{10}/);
  });
  it("preferences pass through: weekday evening / weekend only / a specific date", async () => {
    const { json: fit } = await call("check_fit", T01, d);
    const eve = await call("get_slots", { enquiry_id: fit.enquiry_id, weekday_only: true, after_time: "18:00" }, d);
    for (const s of eve.json.slots) expect(s.label).toMatch(/6:00 pm$/);
    const sat = await call("get_slots", { enquiry_id: fit.enquiry_id, weekend_only: true }, d);
    for (const s of sat.json.slots) expect(s.label).toMatch(/^Saturday/);
    const one = await call("get_slots", { enquiry_id: fit.enquiry_id, on_date: "2026-10-09" }, d);
    for (const s of one.json.slots) expect(s.label).toMatch(/^Friday 9 October/);
  });
  it("wants_principal books a principal", async () => {
    const { json: fit } = await call("check_fit", T01, d);
    const slots = await call("get_slots", { enquiry_id: fit.enquiry_id, wants_principal: true }, d);
    const b = await call("book_slot", { enquiry_id: fit.enquiry_id, start: slots.json.slots[0].start, wants_principal: true }, d);
    expect(b.json).toMatchObject({ ok: true, designer_role: "principal" });
  });
  it("a retried book_slot (same idempotency key) does not double-book", async () => {
    const { json: fit } = await call("check_fit", { ...T01, caller_email: "p@example.com" }, d);
    const start = (await call("get_slots", { enquiry_id: fit.enquiry_id }, d)).json.slots[0].start;
    const a = await call("book_slot", { enquiry_id: fit.enquiry_id, start, idempotency_key: "call-1" }, d);
    const b = await call("book_slot", { enquiry_id: fit.enquiry_id, start, idempotency_key: "call-1" }, d);
    expect(b.json).toMatchObject({ ok: true, replayed: true, booking_id: a.json.booking_id });
    expect(d.fakeCalendar!.events).toHaveLength(1);
  });
});

describe("guards at the tool boundary", () => {
  it("a non-fit enquiry can be neither offered slots nor booked, whatever the model asks (hard rule 2)", async () => {
    for (const bad of [{ ...T01, location: "Nashik" }, { ...T01, location: "Talegaon" }, { location: "Kothrud" }]) {
      const { json: fit } = await call("check_fit", bad, d);
      expect(fit.result).not.toBe("fit");
      expect((await call("get_slots", { enquiry_id: fit.enquiry_id }, d)).json).toMatchObject({ ok: false, error: "not_bookable" });
      expect((await call("book_slot", { enquiry_id: fit.enquiry_id, start: "2026-10-08T05:30:00.000Z" }, d)).json).toMatchObject({ ok: false, error: "not_bookable" });
    }
    expect(d.fakeCalendar!.events).toHaveLength(0);
  });
  it("missing enquiry_id -> 400, unknown -> 404, bad date -> invalid_slot", async () => {
    expect((await call("get_slots", {}, d)).status).toBe(400);
    expect((await call("get_slots", { enquiry_id: "nope" }, d)).status).toBe(404);
    expect((await call("book_slot", { enquiry_id: "nope", start: "2026-10-08T05:30:00.000Z" }, d)).status).toBe(404);
    const { json: fit } = await call("check_fit", T01, d);
    expect((await call("book_slot", { enquiry_id: fit.enquiry_id, start: "garbage" }, d)).json).toMatchObject({ ok: false, error: "invalid_slot" });
    expect((await call("book_slot", { enquiry_id: fit.enquiry_id }, d)).status).toBe(400);
  });
  it("auth is still required", async () => {
    const r = await handleTool("get_slots", new Request("http://localhost/x", { method: "POST", body: "{}" }), d);
    expect(r.status).toBe(401);
  });
  it("calendar outage while booking -> ok:false with next_action request_human_review", async () => {
    const { json: fit } = await call("check_fit", T01, d);
    const start = (await call("get_slots", { enquiry_id: fit.enquiry_id }, d)).json.slots[0].start;
    d.fakeCalendar!.failNext("createEvent");
    expect((await call("book_slot", { enquiry_id: fit.enquiry_id, start }, d)).json).toMatchObject({ ok: false, error: "calendar_unavailable", next_action: "request_human_review" });
  });
});
