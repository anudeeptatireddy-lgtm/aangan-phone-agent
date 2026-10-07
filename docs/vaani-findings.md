# Vaani Labs — what is documented vs. what we still need (read 2026-10-07)

Sources: https://vaanilabs.in/docs, /docs/api, /docs/integrations, /docs/api/webhooks and the OpenAPI spec at
https://www.vaanilabs.in/openapi/v1/vaanivoice.yaml. (Hard rule 7: nothing below is guessed.)

## Documented (and used)
- Base URL `https://www.vaanilabs.in`, `Authorization: Bearer vv_live_<32 chars>` keys minted at vaanilabs.in/api-keys.
- Signed webhooks: `X-VaaniVoice-Signature: sha256=<hex HMAC-SHA256 of raw body>` keyed with a `vv_whk_` secret; also
  `X-VaaniVoice-Event`, `X-VaaniVoice-Delivery`; envelope `{id, type, created, data}`; envelope `id` is reused across retries
  (idempotency key); events: `call.completed`, `call.failed`, `meeting.ended`, `lead.created`, `usage.charged`.
  Delivery is async (drained ~once a minute), 8 retries with backoff. **`data` is "defensive-parse", phone numbers are masked.**
  → implemented + tested in `src/adapters/voice/vaani/webhook.ts`.
- Voice sessions are minted as short-TTL WebSocket URLs (`/api/public/v1/textvoice/session`, `/voicebot/session`) with an optional `flow_id`.
- Billing signals: voice surfaces 4 paise/sec (docs/api page); spec says "per-minute, env-driven rate". Usage endpoints are dashboard-session only.

## NOT documented anywhere I can reach (blocks the live-call parts)
1. **Inbound phone numbers** (Twilio/SIP setup, number → agent mapping). Marketing says Twilio/SIP are supported; no how-to.
2. **In-call tool / function calls** (how a flow calls our `lookup_caller` etc., request/response format, auth/signature, timeout).
3. **Call transfer** (warm/cold) mechanics and how to give it a target number.
4. **`call.completed` payload fields**: transcript? recording URL? duration? caller number (masked!) / call id? cost?
5. **Caller ID** delivered to the agent/flow, and how our tool endpoint receives it.
6. **Recordings** retrieval and retention.
7. **Usage/cost** for API-key callers (the usage endpoints are dashboard-cookie only) — needed for the cost dashboard.
8. **Test/simulation mode** for the Session 7 replay harness.
9. **Data handling** (training on call data, sub-processors, India region) — hard rule 6.
10. The **flow builder** (where the prompt/tools are configured): is it UI-only or is there an API?

## Blockers on our side
- **API key format mismatch.** The key supplied starts `vaani_…`; this platform's keys are `vv_live_…`. It may belong to a
  different Vaani product, or be a dashboard/other token. I have **not** sent it to any endpoint. Please confirm where it was
  created (which site/dashboard).
- `npx vaanivoice-mcp` (named in their marketing) is **not on npm** (404) and github.com/vaanilabs/vaanivoice is 404.
  No MCP server or Claude Skill could be installed.
- Webhook payload masks phone numbers, so post-call matching to a caller must use the call id (or data captured by our own
  tool calls during the call), not the number in the webhook.
- Webhook delivery is batched ~1/min, which eats into the "designer note within 2 minutes of hang-up" target.

## Ask Vaani (hello@vaanilabs.in) or get the docs
Items 1–10 above, in writing, plus the all-in per-minute rate for Indian inbound calls.
