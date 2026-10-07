# vaanivoice.ai (Vaani AI Research): what is documented, 2026-10-07

**Two different products share the name.** `docs/vaani-findings.md` is about **vaanilabs.in** (keys `vv_live_…`). The dashboard the owner uses,
app.vaanivoice.ai, is **Vaani AI Research** (API `https://api.vaanivoice.ai`, header `X-API-Key: vaani_…`, docs https://docs.vaanivoice.ai).
The owner's `vaani_…` key is valid there: `GET /api/agents` returned HTTP 200 and lists the dashboard-built "Aangan Test Agent v0"
(id 71488786-49d9-4e9f-bfe4-6434cd697c7e, unpublished, status running). Which product we build on is an owner decision; this file is for vaanivoice.ai.

Sources read (raw): docs.vaanivoice.ai llms.txt, concepts, webhook-setup, byol, setup-telephony, call-details, list-agents.

| Need | vaanivoice.ai documents | Gap |
|---|---|---|
| Inbound number | Setup page covers **outbound only** (Vaani-provisioned number or SIP trunk: Twilio/Telnyx/Vonage). Dashboard shows Vobiz numbers (no Pune/Maharashtra seen) | Inbound routing, forwarding, caller ID: undocumented |
| **Mid-call tools** (`check_fit`, `book_slot`, ...) | **No custom function/webhook tool is documented.** Dashboard built-ins: Hold, Transfer, Schedule Callback, Agent Transfer | Our rules engine cannot be called mid-call by the prompt-only agent |
| **Bring Your Own LLM (BYOL)** | WebSocket we host: handshake `{"interaction_type":"config"}` + `{"interaction_type":"greeting"}`; Vaani sends `{"interaction_type":"response_required","response_id","call_id","transcript"[],"req_body":{agent_id,contact_number,name,primary_language,...}}`; we stream `{"response_type":"response","response_id","content","content_complete"}`, `end_call:true` hangs up; Bearer token on upgrade; `ping_pong` keep-alive | Tool calls not mentioned (we would run them server-side ourselves). Inbound behaviour of `req_body.contact_number` unknown. Latency budget unspecified |
| End-of-call data | Webhook events `call_started/ringing/ended/postprocessing`, `human_transfer_*`; `call_postprocessing.data` = `call_id, timestamp, summary, entities, dispositions, recording_url, transcript`; `call_ended` has `call_duration` (s), `end_reason`; `GET /api/call_details/{id}` = transcription, entity, summary, conversation_eval, call_eval_tag | **No webhook signing/auth documented** (must not trust an unauthenticated POST: use an unguessable path secret + verify by re-fetching `call_details`). No caller number, cost or timestamps documented in the payloads we read |
| Recordings | `recording_url` in postprocessing; `GET` stream-audio endpoint exists | Retention / deletion / 90-day policy undocumented |
| Transfer | Webhook events `human_transfer_initiated/successful/failed` imply live transfer works (warm); tool currently off | Mechanics undocumented |
| Data handling (hard rule 6) | Nothing found | Ask: training on call data, sub-processors, region |
| Languages | One primary language per agent (+ `secondary_language` in req_body). Marathi/Hindi available | Mid-call following of caller language untested |
| Cost | Dashboard estimate Rs 5.31/min | Number rental extra (Vobiz Rs 500-999/month, Rs 100 setup) |

## What the dashboard agent can and cannot do today
It is a prompt-only agent: no tools, no webhooks. It can test voice, greeting and language in the browser (Start Test). It cannot call our rules engine, so
hard rule 2 (code decides) is **not enforced** on that agent, and rule 1 (never state a price) rests on the prompt alone. Treat it as a voice/language trial only.

## Architecture options (owner decision)
1. **BYOL (recommended to evaluate):** Vaani handles telephony, STT and TTS; our server is the brain behind the WebSocket. Each turn we run the model and our tools (`check_fit`, slots, booking) in-process, so the rules engine decides and the price scan can run on every outgoing sentence before it is spoken. Needs: inbound confirmation, latency check, an LLM on a paid no-training tier.
2. **Prompt-only agent + post-call webhook:** works today, but no live booking and no deterministic fit check during the call. Does not meet the brief.
3. **Stay on vaanilabs.in:** documents webhooks and web voice; phone side undocumented (see vaani-findings.md).
