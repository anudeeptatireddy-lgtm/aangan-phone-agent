# Gemini (post-call extraction): facts verified against Google's raw docs, 2026-10-07

Fetched the raw pages (not a summary): https://ai.google.dev/gemini-api/docs/models, `/structured-output`, `/pricing`, and the API reference
https://ai.google.dev/api/interactions-api. Nothing below is from memory.

| Item | Verified value |
|---|---|
| Pinned model | `gemini-3.5-flash-lite` (listed **Stable**). Alternative: `gemini-3.1-flash-lite` (Stable, cheaper). Never an alias or `-preview`. |
| Endpoint | `POST https://generativelanguage.googleapis.com/v1beta/interactions` (structured output now documented on the Interactions API) |
| Auth | header `x-goog-api-key` |
| Structured output | body `response_format: { type: "text", mime_type: "application/json", schema: <JSON Schema> }`; nullable = `"type": ["string","null"]`; keywords `properties, required, additionalProperties, enum, items, minimum, maximum` |
| Retention | request field `store` (boolean): "whether to store the response and request for later retrieval". We send `store: false` (caller data, hard rule 6). Default not stated in the docs. |
| Generation config | `generation_config`: `max_output_tokens`, `seed`, `thinking_level` (`minimal|low|medium|high`). No `temperature` field is documented; we use `seed` + minimal thinking. |
| Response | `status: "completed"`; text at `steps[].content[].text` where step `type` is `model_output` |
| Usage | `usage.total_input_tokens`, `usage.total_output_tokens`, `usage.total_thought_tokens`, `usage.total_cached_tokens`, `usage.total_tokens` |
| Price (paid tier, per 1M tokens) | `gemini-3.5-flash-lite`: $0.30 in / $2.50 out. `gemini-3.1-flash-lite`: $0.25 in / $1.50 out (audio $0.50 in) |
| Data use | Paid tier content is "not used to improve our products"; free tier is. **Hard rule 6: a billing-enabled (paid) key only.** |

Assumptions to confirm: thought tokens are billed as output tokens (we count them as output, the conservative reading); the cost model's ₹88/$.
The research plan's "Gemini 3.8 Flash doubles in price on 1 Jan 2027" concerns a different model; recheck `3.5-flash-lite` pricing before 1 Jan 2027.
Not verified live: no `GEMINI_API_KEY` yet, so the adapter is tested against recorded request/response shapes only (`scripts/gemini-smoke.ts` runs one live call once a paid key exists).
