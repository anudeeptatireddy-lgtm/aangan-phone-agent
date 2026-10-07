# Vaani Labs — what is documented, what is not, and how to unblock each gap

Sources read 2026-10-07 (nothing guessed, hard rule 7): https://vaanilabs.in/docs, `/docs/api`, `/docs/integrations`,
`/docs/api/webhooks`, and the OpenAPI spec https://www.vaanilabs.in/openapi/v1/vaanivoice.yaml (v1.0.0).
`npx vaanivoice-mcp` (named on their site) is **not on npm** (404) and `github.com/vaanilabs/vaanivoice` returns 404, so there is
no MCP server or Claude Skill we can install.

## 0. The key: verified, and it does not work on this API
The owner confirmed the `vaani_…` key is theirs and is in `.env.local` (`VAANI_API_KEY`, never committed). One documented call was
made with it, `POST https://www.vaanilabs.in/api/public/v1/textvoice/session`:

> **HTTP 401** `{"error":"Missing or malformed Authorization: Bearer vv_live_... header"}`

So vaanilabs.in only accepts keys of the form `vv_live_<32 chars>`. The `vaani_…` key is not a key for this public API (it may be an
account/dashboard token, a different product, or a different vendor). **Check:** sign in at https://www.vaanilabs.in/api-keys and mint
a key (the plaintext is shown once). Note the spec's key scopes are only `textvoice`, `voicebot`, `meeting-agent`, `meeting`: **there
is no telephony/phone scope.** Phone agents may be configured only in the dashboard (see item 1).

## 1. Undocumented features that block live calls (exact list)
| # | Needed for | What the public docs say | Blocks | Ask Vaani | Or check in the dashboard |
|---|---|---|---|---|---|
| 1 | **Inbound phone number → our agent** | Site says Twilio / SIP "supported"; no setup steps; API scopes contain no phone surface | all live calls | "How do I attach an Indian inbound number (or SIP trunk) to a flow so callers reach it? Is it dashboard-only? Which numbers/carriers are supported, and what do they cost?" | Phone numbers / Telephony / Integrations page; Flow → channel settings |
| 2 | **In-call tool (webhook function) calls**: `lookup_caller`, `check_fit`, `resolve_date`, `request_human`, `get_slots`, `book_slot` | "Custom webhook integrations" mentioned; no request/response format, auth or signing, timeouts | agent logic | "Can a flow call our HTTPS endpoint mid-call? Give the exact request body, how it authenticates to us (header? signature?), the timeout, retry behaviour, and whether our JSON response can be read back by the model." | Flow builder → Tools / Functions / Webhook node |
| 3 | **Caller ID inside the flow** (to call `lookup_caller` with the number) | Not documented; webhooks mask numbers | `lookup_caller`, dropped-call continuation | "Is the caller's number available as a variable in the flow and in tool-call requests (unmasked)? How is withheld/private handled?" | Flow variables list |
| 4 | **Call correlation**: tie our tool calls and the end-of-call webhook to one call | Not documented | post-call pipeline | "Is there a stable `call_id` sent with every tool call and in `call.completed`?" | Flow variables; a test call's webhook payload |
| 5 | **Live transfer to a human** (front desk, design lead) | Mentioned as a feature; no mechanics | complaints, "I want a person" | "How do we transfer to a PSTN number (warm/cold)? Can the flow learn the transfer failed or was unanswered, so we can run our fallback (`transfer_failed`)? Can the target number come from our tool response?" | Flow builder → Transfer node |
| 6 | **`call.completed` payload** | Envelope `{id,type,created,data}` documented; `data` is "defensive-parse, no sub-field guaranteed" | post-call pipeline, dashboard | "Please send a real `call.completed` sample. We need: call id, start/answer/end times, ring-to-answer latency, duration, transcript with speaker turns, recording URL, language, tool-call log, cost." | Webhooks page: "Test" sends only `webhook.ping`; place a test call and inspect the delivery log |
| 7 | **Recordings**: retrieval, retention, deletion | "Recordings" listed; nothing else | 90-day retention, delete-on-request | "How do we fetch a recording (signed URL?), where is it stored, can we set 90-day auto-delete and delete on request via API?" | Call logs / Recordings settings |
| 8 | **Usage and cost per call** | Usage endpoints are dashboard-cookie only (`/api/api-keys/{id}/usage`); `usage.charged` event exists with no fields | cost dashboard | "Can usage/cost per call be read with an API key, or does `usage.charged` carry call id + paise + minutes?" | Billing / Usage page; a `usage.charged` delivery |
| 9 | **Test / simulation mode** | Not documented | Session 7 replay harness | "Is there a text-mode or simulated-caller API that runs the same flow and returns agent turns + tool calls, without telephony? (Their `textvoice` WebSocket may serve this: please confirm.)" | Flow → Test / Preview |
| 10 | **Data handling (hard rule 6)** | Site mentions TLS 1.2+, AES-256 at rest, PII masking, audit logging; nothing on training | go-live | "Is call audio/transcript ever used to train any model? Which LLM/STT/TTS sub-processors receive caller data, in which region, on what retention? DPDP-ready DPA?" | /security page, Terms |
| 11 | **Flow definition as code**: keep the prompt and tool list in git (`agent/prompt.md`) and push to Vaani | "Visual flow builder"; no flow API documented | prompt versioning | "Is there an API to create/update a flow, or is it UI-only? Can flows be exported/imported?" | Flow → Export / Versions |
| 12 | **Languages**: Hindi/Marathi quality and mid-call switching | "40+ languages / 12+ Indian languages" | languages | "Does the agent auto-follow a caller's language switch (EN↔HI↔MR)? Which STT/TTS voices? Can we pin the first-line disclosure text verbatim?" | Flow → Language / Voice settings |
| 13 | **Rate for Indian inbound calls** | Docs: voice sessions 4 paise/second (₹2.40/min); spec: "per-minute, env-driven". That is the web-voice rate, not telephony | cost model | "All-in per-minute rate for Indian inbound phone calls (platform + STT + TTS + LLM + telephony) and the monthly number fee, in writing." | Billing → PAYG rate |
| 14 | **Forwarding from the studio's existing number** | Not documented | pilot setup | "Does conditional forwarding (after-hours + no-answer) from a normal Indian number to your number work, and does the forwarded leg bill as outbound on our telco plan?" | Telco plan (not Vaani) |
| 15 | **Operational limits** | Default key limit 60 req/min; webhook delivery drained about once a minute | designer-note latency | "Concurrent-call limit, and can webhook delivery be real-time? (The ~1-minute drain eats into the 2-minute designer-note target.)" | Plan limits |

## 2. What is already built against what IS documented
- Signed-webhook verification and idempotency on the envelope `id` (`src/adapters/voice/vaani/webhook.ts`, tested).
- A `VoicePlatform` interface so the live parts can be filled in (or swapped for Bolna) without touching core code; the Vaani transfer
  method throws `NotDocumentedError` rather than guessing.
- Our own tool endpoints (`/api/tools/*`) with our own contract and bearer auth; the Vaani-side mapping is pending items 2–4.

## 3. Ready-to-send message to Vaani (hello@vaanilabs.in)
> We're building an inbound-only phone enquiry agent for an interior design studio in Pune, on Vaani Labs. The public API/OpenAPI
> covers web voice sessions and webhooks, but not the pieces a phone agent needs. Could you send documentation (or a short call) on:
> (1) attaching an Indian inbound number/SIP trunk to a flow; (2) mid-call HTTPS tool calls: request/response format, auth/signing, timeout;
> (3) caller ID and a stable call id inside the flow and tool calls; (4) live transfer to a PSTN number incl. a failure signal;
> (5) a real `call.completed` payload (transcript, recording URL, latency, duration, language, tool log, cost); (6) recording retrieval,
> 90-day retention and deletion on request; (7) per-call usage/cost via API key or webhook; (8) a text/simulated-call mode for automated tests;
> (9) your data-handling terms: any training on call data, sub-processors, region, DPA; (10) whether flows can be managed by API;
> (11) the all-in per-minute rate for Indian inbound calls and the number fee. Also: our key begins `vaani_…` but the API wants `vv_live_…`. Where do we mint it?
