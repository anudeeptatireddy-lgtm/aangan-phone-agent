import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { makeDeps, Deps } from "@/server/deps";
import { handleTool } from "@/server/handlers/tools";
import { handleVaaniWebhook } from "@/server/handlers/vaani-webhook";

const TOOL_SECRET = "tool-secret-0123456789";
const WHK = "vv_whk_secret";
const NOW = new Date("2026-10-07T06:30:00Z"); // 12:00 IST Wednesday (working hours)
const NIGHT = new Date("2026-10-07T16:40:00Z"); // 22:10 IST

let deps: Deps;
const mkDeps = (now = NOW) =>
  makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: TOOL_SECRET, VAANI_WEBHOOK_SECRET: WHK, FRONT_DESK_NUMBER: "+919000000000", DESIGN_LEAD_NUMBER: "+919000000001" }, now: () => now });

const post = (path: string, body: unknown, auth: string | null = `Bearer ${TOOL_SECRET}`) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

beforeEach(() => { deps = mkDeps(); });

describe("tool auth", () => {
  it("rejects missing or wrong bearer", async () => {
    expect((await handleTool("lookup_caller", post("/x", { phone: "9876543210" }, null), deps)).status).toBe(401);
    expect((await handleTool("lookup_caller", post("/x", { phone: "9876543210" }, "Bearer nope"), deps)).status).toBe(401);
  });
  it("400 on invalid body", async () => {
    expect((await handleTool("check_fit", post("/x", { carpet_sqft: "big" }), deps)).status).toBe(400);
  });
});

describe("lookup_caller", () => {
  it("returns flags + recommended route, never the full number", async () => {
    deps.repo.upsertCaller({ phone: "+919876543210", isExistingClient: true });
    const res = await handleTool("lookup_caller", post("/x", { phone: "+919876543210" }), deps);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("9876543210");
    const j = JSON.parse(text);
    expect(j.is_existing_client).toBe(true);
    expect(j.recommended_route).toBe("escalate_complaint");
  });
  it("T09 utterance from an unknown number still routes to escalation", async () => {
    const res = await handleTool("lookup_caller", post("/x", { phone: "9000000009",
      first_utterance: "My project has been going for three months and my designer hasn't replied in five days" }), deps);
    expect((await res.json()).recommended_route).toBe("escalate_complaint");
  });
  it("new enquirer continues", async () => {
    const res = await handleTool("lookup_caller", post("/x", { phone: "9000000001", intent: "new_enquiry" }), deps);
    expect((await res.json()).recommended_route).toBe("continue");
  });
});

describe("check_fit (real engine)", () => {
  const T01 = { location: "Kothrud", project_type: "home", scope: "full_home", bhk: 3, carpet_sqft: 1400, deadline_date: "2027-03-31", decision_maker: "owner" };
  it("T01 -> fit, proceed to booking, rule version recorded", async () => {
    const j = await (await handleTool("check_fit", post("/x", T01), deps)).json();
    expect(j).toMatchObject({ result: "fit", next_action: "proceed_to_booking", rule_version: "v1" });
  });
  it("T10 budget is consumed but never echoed; routes to human review", async () => {
    const res = await handleTool("check_fit", post("/x", { location: "Kharadi", project_type: "home", scope: "partial_home", rooms_count: 2, bhk: 1, budget_inr: 150000 }), deps);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ result: "unclear", next_action: "human_review" });
    expect(text).not.toMatch(/150000|400000|lakh|₹/i);
  });
  it("timeline not_fit returns the approved decline text in the caller's language, with its review status", async () => {
    const body = { ...T01, deadline_date: "2026-10-20", language: "hi" };
    const j = await (await handleTool("check_fit", post("/x", body), deps)).json();
    expect(j).toMatchObject({ result: "not_fit", next_action: "offer_later_start" });
    expect(j.caller_messages[0]).toMatchObject({ key: "not_fit.timeline", status: "draft_pending_native_review" });
    expect(j.caller_messages[0].text).toContain("हफ़्ते");
  });
  it("missing info asks for exactly that field", async () => {
    const j = await (await handleTool("check_fit", post("/x", { ...T01, scope: undefined }), deps)).json();
    expect(j).toMatchObject({ result: "unclear", next_action: "ask_caller", missing_fields: ["scope"] });
  });
});

describe("request_human", () => {
  it("complaint in hours -> live transfer to the design lead, approved script returned, recorded without the phone", async () => {
    const j = await (await handleTool("request_human", post("/x", { reason: "complaint", phone: "9000000009", summary: "designer silent 5 days" }), deps)).json();
    expect(j).toMatchObject({ mode: "live_transfer", transfer_target: "design_lead" });
    expect(j.caller_message).toBe("I'm sorry this has happened. I'm connecting you to a senior member of our team now.");
    expect(deps.repo.escalations).toHaveLength(1);
    expect(JSON.stringify(deps.repo.escalations)).not.toContain("9000000009");
  });
  it("'I want a person' goes to the front desk, never to Nikhil", async () => {
    const j = await (await handleTool("request_human", post("/x", { reason: "human_requested" }), deps)).json();
    expect(j).toMatchObject({ mode: "live_transfer", transfer_target: "front_desk", nikhil_alert_pending: false });
    expect(j.caller_message).toBe("Of course. I'm connecting you to our front desk now.");
  });
  it("complaint transfer failed in hours -> 15-minute SLA, design lead alerted now, Nikhil if unacknowledged in 10 min", async () => {
    const j = await (await handleTool("request_human", post("/x", { reason: "complaint", transfer_failed: true }), deps)).json();
    expect(j).toMatchObject({ mode: "callback_sla", sla_minutes: 15, alert_design_lead_now: true, alert_nikhil_if_unacked_min: 10, nikhil_alert_pending: false });
    expect(j.callback_due_at).toBe("2026-10-07T06:45:00.000Z");
    expect(j.caller_message).toBe("I couldn't connect you just now. I've alerted our senior team, and a senior person will call you back within 15 minutes.");
  });
  it("person requested, transfer failed in hours -> front desk queue item, 30-minute SLA, escalating to the design lead", async () => {
    const j = await (await handleTool("request_human", post("/x", { reason: "human_requested", transfer_failed: true }), deps)).json();
    expect(j).toMatchObject({ mode: "callback_sla", sla_minutes: 30, queue: "front_desk", queue_escalates_to: "design_lead" });
    expect(j.caller_message).toContain("front desk to call you back within 30 minutes");
  });
  it("no transfer number configured -> never pretends to transfer (falls to the failed-transfer path)", async () => {
    const d = makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: TOOL_SECRET }, now: () => NOW });
    expect((await (await handleTool("request_human", post("/x", { reason: "complaint" }), d)).json()).mode).toBe("callback_sla");
  });
  it("complaint after hours -> callback by 10am next working day + Nikhil alert pending", async () => {
    const d = mkDeps(NIGHT);
    const j = await (await handleTool("request_human", post("/x", { reason: "complaint" }), d)).json();
    expect(j).toMatchObject({ mode: "callback_promised", callback_due_at: "2026-10-08T04:30:00.000Z", nikhil_alert_pending: true });
    expect(j.caller_message).toContain("by 10am on Thursday");
  });
  it("complaint transfer failed with <15 minutes of hours left -> after-hours script", async () => {
    const d = mkDeps(new Date("2026-10-07T13:16:00Z")); // 18:46 IST
    const j = await (await handleTool("request_human", post("/x", { reason: "complaint", transfer_failed: true }), d)).json();
    expect(j).toMatchObject({ mode: "callback_promised", nikhil_alert_pending: true });
  });
  it("review: tells the caller to expect a call in working hours (today)", async () => {
    const j = await (await handleTool("request_human", post("/x", { reason: "review" }), deps)).json();
    expect(j).toMatchObject({ mode: "queued_review", caller_script: "expect_call" });
    expect(j.caller_message).toContain("Monday to Friday, 10am to 7pm, today");
  });
  it("rejects unknown reasons", async () => {
    expect((await handleTool("request_human", post("/x", { reason: "chitchat" }), deps)).status).toBe(400);
  });

  describe("after hours: 'I want a person' offers a choice", () => {
    it("first call records a pending item and offers the choice", async () => {
      const d = mkDeps(NIGHT);
      const j = await (await handleTool("request_human", post("/x", { reason: "human_requested" }), d)).json();
      expect(j).toMatchObject({ mode: "offer_choice", nikhil_alert_pending: false });
      expect(j.caller_message).toContain("I can take your details so they call you on Thursday morning, or I can book your consultation myself right now.");
      expect(d.repo.escalations).toHaveLength(1);
    });
    it("choice=callback -> promised for the next working morning (updates the same item)", async () => {
      const d = mkDeps(NIGHT);
      const first = await (await handleTool("request_human", post("/x", { reason: "human_requested" }), d)).json();
      const j = await (await handleTool("request_human", post("/x", { reason: "human_requested", escalation_id: first.escalation_id, choice: "callback" }), d)).json();
      expect(j).toMatchObject({ mode: "callback_promised", escalation_id: first.escalation_id, callback_due_at: "2026-10-08T04:30:00.000Z" });
      expect(d.repo.escalations).toHaveLength(1);
      expect(d.repo.escalations[0]!.mode).toBe("callback_promised");
    });
    it("choice=book -> carries on qualifying and booking", async () => {
      const d = mkDeps(NIGHT);
      const first = await (await handleTool("request_human", post("/x", { reason: "human_requested" }), d)).json();
      const j = await (await handleTool("request_human", post("/x", { reason: "human_requested", escalation_id: first.escalation_id, choice: "book" }), d)).json();
      expect(j).toMatchObject({ mode: "continue_booking", next: "continue_qualifying" });
    });
    it("unknown escalation id -> 404", async () => {
      expect((await handleTool("request_human", post("/x", { reason: "human_requested", escalation_id: "nope", choice: "book" }), deps)).status).toBe(404);
    });
  });
});

describe("resolve_date (festival_dates)", () => {
  const sep8 = () => mkDeps(new Date("2026-09-08T05:00:00Z"));
  it("resolves Diwali and returns the approved read-back", async () => {
    const j = await (await handleTool("resolve_date", post("/x", { text: "before Diwali" }), sep8())).json();
    expect(j).toMatchObject({ resolved: true, date: "2026-11-08", readback: "Diwali is on 8 November, so about nine weeks from now. Is that your deadline?", readback_status: "approved" });
  });
  it("a Hindi caller still gets the English read-back (HI/MR pending native review)", async () => {
    const j = await (await handleTool("resolve_date", post("/x", { text: "दिवाली से पहले", language: "hi" }), sep8())).json();
    expect(j.readback).toBe("Diwali is on 8 November, so about nine weeks from now. Is that your deadline?");
  });
  it("unknown events must be asked for as a calendar date, never inferred from a stated distance", async () => {
    const j = await (await handleTool("resolve_date", post("/x", { text: "before Ganesh Chaturthi, it's two weeks away" }), sep8())).json();
    expect(j).toMatchObject({ resolved: false, reason: "unknown_event" });
    expect(j.instruction).toMatch(/calendar date/i);
  });
  it("400 on missing text", async () => {
    expect((await handleTool("resolve_date", post("/x", {}), sep8())).status).toBe(400);
  });
});

describe("vaani webhook", () => {
  const body = JSON.stringify({ id: "evt_42", type: "call.completed", created: 1714003200, data: { phone: "+91 98••••••10" } });
  const sig = "sha256=" + createHmac("sha256", WHK).update(body).digest("hex");
  const req = (s: string | null, b = body) => new Request("http://localhost/api/vaani/webhook", { method: "POST",
    headers: { ...(s ? { "x-vaanivoice-signature": s } : {}), "x-vaanivoice-event": "call.completed", "x-vaanivoice-delivery": "7" }, body: b });

  it("401 on bad or missing signature", async () => {
    expect((await handleVaaniWebhook(req("sha256=" + "0".repeat(64)), deps)).status).toBe(401);
    expect((await handleVaaniWebhook(req(null), deps)).status).toBe(401);
  });
  it("200 on valid, and de-duplicates retries by envelope id", async () => {
    const a = await handleVaaniWebhook(req(sig), deps);
    expect(a.status).toBe(200);
    expect((await a.json()).duplicate).toBe(false);
    const b = await handleVaaniWebhook(req(sig), deps);
    expect(b.status).toBe(200);
    expect((await b.json()).duplicate).toBe(true);
    expect(deps.repo.webhookEvents).toHaveLength(1);
  });
  it("503 if no webhook secret is configured (never accept unsigned events)", async () => {
    const d = makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: TOOL_SECRET }, now: () => NOW });
    expect((await handleVaaniWebhook(req(sig), d)).status).toBe(503);
  });
});
