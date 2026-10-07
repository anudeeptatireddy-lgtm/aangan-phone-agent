// Local simulator: drives the real tool endpoints on localhost the way the voice agent would.
// Usage: pnpm dev (terminal 1)  |  pnpm simulate (terminal 2)
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH = { authorization: `Bearer ${process.env.TOOL_SHARED_SECRET}`, "content-type": "application/json" };
const call = async (path: string, body: unknown) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: AUTH, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const show = (label: string, r: { status: number; body: unknown }) => console.log(`  ${label} -> ${r.status}`, JSON.stringify(r.body));

async function scenario(name: string, run: () => Promise<void>) { console.log(`\n=== ${name}`); await run(); }

await scenario("T01-style new enquiry (stub engine => human review, never auto-booked)", async () => {
  show("lookup_caller", await call("/api/tools/lookup-caller", { phone: "9000000001", intent: "new_enquiry", first_utterance: "We have a 3BHK in Kothrud and want to redo the whole thing" }));
  show("check_fit", await call("/api/tools/check-fit", { location: "Kothrud", scope: "full redesign", carpet_sqft: 1400, timeline: "by March", owners_attending: true }));
  show("request_human(review)", await call("/api/tools/request-human", { reason: "review", phone: "9000000001", summary: "stub engine" }));
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

await scenario("Booking tools are not built (must never fake a slot)", async () => {
  show("get_slots", await call("/api/tools/get-slots", {}));
});

await scenario("Auth: wrong secret is rejected", async () => {
  const r = await fetch(`${BASE}/api/tools/lookup-caller`, { method: "POST", headers: { authorization: "Bearer wrong" }, body: "{}" });
  console.log("  ->", r.status);
});
