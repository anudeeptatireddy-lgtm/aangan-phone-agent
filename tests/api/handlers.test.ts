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
  makeDeps({ env: { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: TOOL_SECRET, VAANI_WEBHOOK_SECRET: WHK }, now: () => now });

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

describe("check_fit (stub)", () => {
  it("returns unclear and never fit", async () => {
    const res = await handleTool("check_fit", post("/x", { location: "Kothrud", carpet_sqft: 1400, budget_inr: 150000 }), deps);
    const text = await res.text();
    expect(JSON.parse(text).result).toBe("unclear");
    expect(text).not.toMatch(/150000/);
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
