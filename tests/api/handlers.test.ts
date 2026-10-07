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
  it("complaint in hours -> live transfer, recorded", async () => {
    const res = await handleTool("request_human", post("/x", { reason: "complaint", phone: "9000000009", summary: "designer silent 5 days" }), deps);
    const j = await res.json();
    expect(j.mode).toBe("live_transfer");
    expect(deps.repo.escalations).toHaveLength(1);
    expect(JSON.stringify(deps.repo.escalations)).not.toContain("9000000009");
  });
  it("complaint in hours goes to the design lead; the approved script is returned", async () => {
    const j = await (await handleTool("request_human", post("/x", { reason: "complaint" }), deps)).json();
    expect(j.transfer_target).toBe("design_lead");
    expect(j.caller_message).toBe("I'm sorry this has happened. I'm connecting you to a senior member of our team now.");
  });
  it("'I want a person' goes to the front desk, never to Nikhil", async () => {
    const j = await (await handleTool("request_human", post("/x", { reason: "human_requested" }), deps)).json();
    expect(j).toMatchObject({ mode: "live_transfer", transfer_target: "front_desk", nikhil_alert_pending: false });
  });
  it("transfer failed -> callback by 10am next working day + Nikhil alert (complaint)", async () => {
    const j = await (await handleTool("request_human", post("/x", { reason: "complaint", transfer_failed: true }), deps)).json();
    expect(j).toMatchObject({ mode: "callback_promised", nikhil_alert_pending: true, caller_script: "complaint_after_hours" });
    expect(j.caller_message).toContain("by 10am on Thursday");
  });
  it("no transfer number configured -> never pretends to transfer", async () => {
    const d = makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: TOOL_SECRET }, now: () => NOW });
    expect((await (await handleTool("request_human", post("/x", { reason: "complaint" }), d)).json()).mode).toBe("callback_promised");
  });
  it("review: tells the caller to expect a call in working hours (today)", async () => {
    const j = await (await handleTool("request_human", post("/x", { reason: "review" }), deps)).json();
    expect(j).toMatchObject({ mode: "queued_review", caller_script: "expect_call" });
    expect(j.caller_message).toContain("Monday to Friday, 10am to 7pm, today");
  });
  it("complaint after hours -> callback by 10am + Nikhil alert pending", async () => {
    const d = mkDeps(NIGHT);
    const j = await (await handleTool("request_human", post("/x", { reason: "complaint" }), d)).json();
    expect(j.mode).toBe("callback_promised");
    expect(j.callback_due_at).toBe("2026-10-08T04:30:00.000Z");
    expect(j.nikhil_alert_pending).toBe(true);
  });
  it("rejects unknown reasons", async () => {
    expect((await handleTool("request_human", post("/x", { reason: "chitchat" }), deps)).status).toBe(400);
  });
});

describe("booking tools are not built yet", () => {
  it("get_slots / book_slot return 501, never a fake slot", async () => {
    expect((await handleTool("get_slots", post("/x", {}), deps)).status).toBe(501);
    expect((await handleTool("book_slot", post("/x", {}), deps)).status).toBe(501);
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
