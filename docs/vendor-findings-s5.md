# Session 5 vendor facts (Telegram, HubSpot, Resend, Vercel cron), verified against the raw docs on 2026-10-07

Nothing here is from memory. Pages fetched raw: core.telegram.org/bots/api, developers.hubspot.com (CRM deals, contacts, associations v4, pipelines),
resend.com/docs (send email, idempotency keys), vercel.com/docs/cron-jobs.

| Vendor | Verified fact we rely on |
|---|---|
| Telegram | `sendMessage(chat_id, text, reply_markup)`; inline buttons carry `callback_data`; after a press the bot **must** call `answerCallbackQuery(callback_query_id, text?)`; `editMessageText(chat_id, message_id, text, reply_markup?)`. Webhook: `setWebhook(url, secret_token)`, every update then carries header `X-Telegram-Bot-Api-Secret-Token` (1-256 chars, `A-Za-z0-9_-`). Responses are `{ok, description?, parameters?: {retry_after}}`. `callback_query` has `id`, `from`, `message`, `data`. |
| HubSpot deals | `POST /crm/v3/objects/deals` with `properties` (`dealname`, `dealstage`, `pipeline`) and an `associations` array `[{to:{id}, types:[{associationCategory:"HUBSPOT_DEFINED", associationTypeId:3}]}]`; **3 = deal to contact** (docs' association type table). Stage and pipeline must be **internal ids**. |
| HubSpot contacts | `POST /crm/v3/objects/contacts/batch/upsert` with `inputs:[{id:<email>, idProperty:"email", properties:{...}}]` (create or update by email). A contact without an email can only be created (`POST /crm/v3/objects/contacts`), which can duplicate. |
| Resend | `POST https://api.resend.com/emails`, `Authorization: Bearer re_...`, body `{from, to:[...], subject, html|text}`, response `{id}`. Header `Idempotency-Key` (<= 256 chars, kept 24 hours) prevents duplicate sends on retry. |
| Vercel cron | Set env `CRON_SECRET` (>= 16 chars); Vercel then calls the cron path with `Authorization: Bearer <CRON_SECRET>`. |

## HubSpot: the supplied token is missing scopes (checked read-only, status codes only)
| Call | Result |
|---|---|
| `GET /crm/v3/objects/contacts?limit=1` | 200 (contacts readable) |
| `GET /crm/v3/objects/deals?limit=1` | **403 MISSING_SCOPES** |
| `GET /crm/v3/pipelines/deals` | **403 MISSING_SCOPES** |
| `GET /crm/v3/properties/deals` | **403** |
| `GET /crm/v3/owners?limit=1` | **403 MISSING_SCOPES** |

So the private app cannot create deals or even read pipeline and stage ids yet. **Owner action:** in HubSpot > Settings > Integrations > Private Apps > (this app) > Scopes, add the deal
read/write scopes, pipeline read, and contacts write. The exact scope names are in the "Scope requirements" panel on HubSpot's deals / pipelines / owners API pages (a collapsed element I could not
read programmatically). Then tell me, and I will read the pipelines and give you the real `HUBSPOT_PIPELINE_ID` / `HUBSPOT_DEAL_STAGE_ID`. Until then the HubSpot step runs against an in-memory fake and the
real adapter fails closed with a clear "not configured" error (never guesses ids).
