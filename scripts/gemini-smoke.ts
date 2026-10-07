// One LIVE extraction call, to run once the owner provides a PAID-tier key (never the free tier: it trains on data).
//   GEMINI_API_KEY=... GEMINI_PAID_TIER_CONFIRMED=true pnpm tsx scripts/gemini-smoke.ts
// Uses a SYNTHETIC transcript only (no caller data) and prints the parsed extraction, token usage and cost.
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
import { GeminiExtractor } from "../src/adapters/llm/gemini";
import { buildExtractionRequest } from "../src/core/postcall/extraction";
import { computeAiCost } from "../src/core/postcall/costs";

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error("Set GEMINI_API_KEY (paid tier) to run this."); process.exit(1); }

const turns = [
  { speaker: "agent" as const, text: "Namaste, Aangan Studio. I'm Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?" },
  { speaker: "caller" as const, text: "Hi, I'm Smita. I'm getting possession of my flat in Undri in about six weeks. 2BHK, 875 sq ft. I want to start the design right away." },
  { speaker: "agent" as const, text: "What would you like done?" },
  { speaker: "caller" as const, text: "Full home, kitchen, wardrobes, living room. My husband and I are the owners and we'll both come." },
  { speaker: "agent" as const, text: "I can't give you a figure before a designer sees your home. The consultation is free." },
  { speaker: "caller" as const, text: "Okay. My budget is around 8 lakh. We'd like it done before Diwali." },
];
const ex = new GeminiExtractor({ apiKey: key, paidTierConfirmed: process.env.GEMINI_PAID_TIER_CONFIRMED === "true" });
const r = await ex.extract(buildExtractionRequest(turns, new Date()));
console.log(JSON.stringify(r.data, null, 2));
console.log("model:", r.model, "usage:", r.usage, "cost INR:", computeAiCost(r.usage, r.model).totalInr.toFixed(4));
console.log("expected: budget_inr 800000 (the CALLER's figure), deadline.kind festival/Diwali (no date), tenure unknown, owners_attending true");
