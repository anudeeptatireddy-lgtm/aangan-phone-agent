# Go-live checklist

Written 2026-10-08. Goal: **a first real test call**, then everything else.
How to read it: Part 1 is every environment variable. Part 2 is every external setup step, one system at a time, as checkboxes. **Part 3 is the order to do them in** (fewest steps to the first call).

Facts marked *(Vaani docs)*, *(Cal.com docs)* and so on were read from the vendor's own documentation on 2026-10-08. Anything a vendor does not document is marked **not documented**; it is a thing to check, not a thing I know.

## 0. Four things that decide the order

1. **The deployed app needs a database.** Without `DATABASE_URL` a deployed app falls back to in-memory storage, which is wiped between requests on Vercel. So Supabase comes before any real call.
2. **The app needs the Gemini key to process any call.** In production the post-call pipeline only exists when the Gemini extractor is configured (paid tier, confirmed). Without it every Vaani webhook answers 503 `extractor_not_configured`.
3. **Cron every minute needs Vercel Pro.** `vercel.json` schedules `/api/cron/tick` every minute. On Hobby, Vercel refuses the deployment *(Vercel docs: "Cron expressions that would run more frequently [than daily] will fail during deployment")*. The tick runs alerts, the HubSpot/email outbox and the 30-minute designer timeout. The first call does not depend on it, but everything after does.
4. **Google is parked, and that is fine.** With no `GOOGLE_SERVICE_ACCOUNT_JSON` in production the app treats the Cal.com booking as the booking: designers need no calendar id, and a designer who declines or does not accept in 30 working minutes is replaced by the next free designer, judged from our own bookings table (fixed 2026-10-08).

---

## 1. Environment variables (every one in `.env.example`)

**When** column: **First call** = needed before the first real test call. **With deploy** = set when you deploy, not strictly needed for the call. **Later** = can wait until after the first call. **Parked** = not used now.

Secrets that we make up ourselves (run in Terminal; store each in a password manager, because some can never be changed once real data exists):

| Variable | Generate with |
|---|---|
| `PHONE_HASH_PEPPER` | `openssl rand -hex 24` |
| `PHONE_ENC_KEY` | `openssl rand -hex 32` (must be exactly 64 hex characters) |
| `TOOL_SHARED_SECRET` | `openssl rand -hex 24` |
| `VAANIVOICE_WEBHOOK_SECRET` | `openssl rand -hex 24` (24 to 128 characters of letters, digits, `_`, `-`) |
| `CALCOM_SIGNING_SECRET` | `openssl rand -hex 24` |
| `TELEGRAM_WEBHOOK_SECRET` | `openssl rand -hex 24` (16 to 256 characters of letters, digits, `_`, `-`) |
| `CRON_SECRET` | `openssl rand -hex 24` |
| `DASHBOARD_PASSWORD` | a passphrase of at least 12 characters |
| `DASHBOARD_OPEN` | `true` only for a public read-only demo (no password; phone reveal and review changes are refused). Not for real caller data. |

> **Never change `PHONE_HASH_PEPPER` or `PHONE_ENC_KEY` after real calls exist.** The pepper is how a returning caller is recognised, and the key is the only way to read stored phone numbers. Use new values for production (do not reuse the ones in your local `.env.local`), and keep a copy somewhere safe.

### Voice (Vaani) and booking (Cal.com)

| Variable | What it is for | Where to get it | When |
|---|---|---|---|
| `VAANIVOICE_API_KEY` | After each call the app re-fetches the transcript, extracted fields, caller number and times from Vaani with this key (nothing in the webhook body is trusted). | Vaani dashboard → **Settings → API Keys → Generate API Key**, give it a name *(Vaani docs)*. Sent as header `X-API-Key`. | **First call** |
| `VAANIVOICE_WEBHOOK_SECRET` | Vaani documents no webhook signature, so the secret is part of the URL: `https://<your-site>/api/vaanivoice/webhook/<this value>`. A wrong value gets a 404. | You generate it (above). You paste the full URL into Vaani, see 2.1. | **First call** |
| `VAANIVOICE_CLIENT_ID` | Fallback only: if Vaani's call lookup answers 404/422, the app retries the OpenAPI form that includes a client id. | Not mentioned in Vaani's docs, and the call-history 500 is not caused by its absence (the OpenAPI file lists no client id for that endpoint). **Leave empty.** | Later (only if lookups fail) |
| `VAANIVOICE_RATE_INR_PER_MIN` | Turns call minutes into an estimated rupee cost on the dashboard. Without it the cost panel has no voice line. | Your per-minute price from your Vaani plan (the dashboard estimate we noted on 2026-10-07 was 5.31). Vaani's public docs do not say where the price is shown. | Later |
| `CALCOM_SIGNING_SECRET` | The secret you type on Cal.com's webhook; the app checks every booking notification against it (header `x-cal-signature-256`). | You generate it (above). You paste it into Cal.com, see 2.2. | **First call** |

### Storage and our own secrets

| Variable | What it is for | Where to get it | When |
|---|---|---|---|
| `DATABASE_URL` | The Postgres database (Supabase). Without it the deployed app uses in-memory storage and loses everything. | Supabase dashboard → open the project → **Connect** (top of the page) → choose the **Transaction pooler** string *(Supabase docs: recommended for serverless such as Vercel)*; replace `[YOUR-PASSWORD]` with the database password and add `?sslmode=require` at the end. | **First call** |
| `PHONE_ENC_KEY` | Encrypts caller phone numbers in the database. The app refuses to start with a database and no key. | You generate it (above). | **First call** |
| `PHONE_HASH_PEPPER` | Lets the app recognise a returning caller and match a Cal.com booking to its call, without storing the number in the clear. | You generate it (above). | **First call** |
| `TOOL_SHARED_SECRET` | Must be set or the app will not boot. It protects the endpoints a tool-calling voice agent would use. The prompt-only Vaani agent does not call them. | You generate it (above). | **First call** (to boot) |
| `LOCAL_DB_DIR` | A local database folder for your laptop. | **Do not set this on Vercel** (its disk is not kept). | Local only |
| `FRONT_DESK_NUMBER`, `DESIGN_LEAD_NUMBER` | Phone numbers for live transfers of complaints and "I want a person". Only the tool-calling flow uses them; the prompt-only agent does not transfer calls. | Leave empty. | Later (only if a tool-capable agent is built) |

### Reading each call (Gemini)

| Variable | What it is for | Where to get it | When |
|---|---|---|---|
| `GEMINI_API_KEY` | After each call, Gemini reads the transcript and fills the fields Vaani left empty. The app uses the pinned model `gemini-3.5-flash-lite`. | A Google AI Studio API key **on a project with billing enabled**. The Gemini documentation we read does not give menu labels, so this path is not verified: open Google AI Studio, create the key, and attach billing to its project. | **First call** |
| `GEMINI_PAID_TIER_CONFIRMED` | Hard rule 6: caller data must only go to a paid tier that does not train on it. Set to the word `true` **only after** billing is enabled. A key without this makes the app send nothing and log an error. | You set it by hand. | **First call** |

### Designers' notes and alerts (Telegram)

| Variable | What it is for | Where to get it | When |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | The bot that sends each designer their note with Accept / Can't take it buttons, and sends alerts. | In Telegram, message **@BotFather**, send `/newbot`, give it a name and a username ending in `bot`; it replies with the token *(Telegram docs)*. | **First call** (strongly recommended: it is how a designer gets the note) |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram sends it back on every button press so the app knows the press is genuine. | You generate it (above); you also pass it to Telegram as `secret_token` in 2.3. | **First call** |
| `OWNER_TELEGRAM_CHAT_ID` | Where system alerts go (a call that could not be processed, an alert that failed five times). A number. | The owner presses **Start** on the bot, then see 2.3 for reading the number. | **First call** (recommended) |
| `NIKHIL_TELEGRAM_CHAT_ID` | Where the alerts meant for Nikhil go (complaints, VIP referrers). Alerts wait if it is empty; nothing is lost. | Nikhil presses **Start** on the bot; same method. | Later |

### CRM and email (can wait until after the first call)

| Variable | What it is for | Where to get it | When |
|---|---|---|---|
| `HUBSPOT_ACCESS_TOKEN` | Creates the deal (and contact) for each qualified call. | HubSpot → **Development → Legacy apps → Create legacy app → Private**; on the **Scopes** tab add `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.schemas.deals.read`; **Create app**; then the **Auth** tab → **Show token** *(HubSpot docs; HubSpot calls private apps "legacy")*. | Later |
| `HUBSPOT_PIPELINE_ID` | Which deal pipeline new deals go into. It is an internal id, never the name. | `GET https://api.hubapi.com/crm/v3/pipelines/deals` with the token: each pipeline has an `id` *(HubSpot docs)*. | Later |
| `HUBSPOT_DEAL_STAGE_ID` | The stage new deals start in (an internal id). | `GET /crm/v3/pipelines/deals/{pipelineId}/stages`: each stage has an `id` *(HubSpot docs)*. | Later |
| `HUBSPOT_STAGE_MAP` | Tells the app what each of the studio's own HubSpot stages means, so the dashboard can count consultations held, quotes sent and deals won, and show the designers' quote values. A JSON list like `{"101":"consult_held","102":"quote_sent"}`; the right-hand names are `new`, `consult_booked`, `consult_held`, `quote_sent`, `won`, `lost`. Closed won and closed lost are recognised from HubSpot's own settings and need no entry. | Run `pnpm hubspot:stages` once the HubSpot scopes are in (it lists the stage ids and suggests a starting map). **Only the studio knows what its stages mean**, so check every line. | Later (until set, those funnel steps say "no data yet") |
| `HUBSPOT_PORTAL_ID` | Only turns a deal number on the dashboard's call page into a clickable link. | The number after `/contacts/` in any HubSpot web address. | Later (optional) |
| `RESEND_API_KEY` | Sends the caller's confirmation email. | resend.com → API keys (the exact menu label is not in the pages we read). | Later |
| `RESEND_FROM` | The "from" address. It **must** be on a domain you have verified in Resend. | An address at your verified domain, for example `consultations@mail.<yourdomain>` (Resend recommends a subdomain). See 2.5. | Later |
| `RESEND_REPLY_TO` | Where a caller's reply goes (the email tells them to reply to change the time). | An inbox the studio reads. | Later |

Until HubSpot and Resend are set, each deal and each email fails five times and then raises one alert to the owner (the call itself is not affected). That is expected noise after the first call; set them soon after.

### Google Calendar: **parked**

| Variable | Status |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Parked.** Booking now goes through Vaani's Cal.com integration, and the app never reads or writes a Google calendar for those bookings. Leave empty. |
| `GOOGLE_IMPERSONATE_USER` | **Parked.** Leave empty. |

With these empty in production, designers do not need a `calendar_id` and reassignment works without Google (section 4). In development and tests the in-memory fake calendar is still used.

### Dashboard, cron, and what `.env.example` mentions but the code does not read

| Variable | What it is for | Where to get it | When |
|---|---|---|---|
| `DASHBOARD_PASSWORD` | The one password for the owner dashboard in production (12+ characters). **If it is not set, the dashboard is locked and nothing opens.** Locally there is no login. | You choose it. | **First call** (to see the result) |
| `CRON_SECRET` | Vercel sends it as a bearer token when it runs the every-minute tick; the app refuses any other caller. | You generate it (above); set it in Vercel and Vercel uses it automatically *(Vercel docs)*. | With deploy |
| `NODE_ENV` | Vercel sets `production` itself. It is what turns the dashboard login on. | Nothing to do. | Automatic |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `.env.example` lists them under "Later", but **the code does not read them**: the app talks to the database only through `DATABASE_URL`. | Not needed. | Never |

---

## 2. External setup steps (checkboxes, one system at a time)

### 2.1 Vaani (vaanivoice.ai)

- [ ] **Create the production agent.** Duplicate or replace the dashboard's "Aangan Test Agent v0" (the label for creating an agent is not in Vaani's public docs). Its **instructions** (system prompt) must be the contents of [`agent/prompt.v1.md`](../agent/prompt.v1.md). **Do not use `agent/prompt.md`**: that is the older prompt for a tool-calling agent and refers to tools the prompt-only agent does not have.
- [ ] **Set the greeting (first line) to the approved opening, word for word:** *"Namaste, Aangan Studio. I'm Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?"* `prompt.v1.md` does not contain the disclosure line, so this must be the agent's greeting; the system checks that the first thing the agent says includes both "virtual assistant" and "recorded", and raises an alert on any call that does not (hard rule 3). Also make sure recording is switched on in Vaani, because the greeting says the call is recorded. (The label of the greeting setting is not in Vaani's public docs.)
- [ ] **Turn on the Cal.com integration:** Vaani dashboard → **Settings → Integrations → Cal.com** *(Vaani docs)*. Paste your Cal.com API key (Cal.com → **Settings → Security** → API keys; live keys start `cal_live_` *(Cal.com docs)*). Select the **"Aangan consultation"** event type as the one the agent books *(the field name for this is not documented by Vaani)*. The prompt's booking section already names the event "Aangan consultation".
- [ ] **Set the Entities Extraction data points** (Vaani's name for them is `extraction.data_collection.data_points`; names are limited to 30 characters). The names must match **exactly** what [`src/adapters/voice/vaanivoice/entities.ts`](../src/adapters/voice/vaanivoice/entities.ts) reads, or that field silently stays empty. All 23, copied from the code:

  | Group | Exact field names |
  |---|---|
  | The caller | `caller_name`, `caller_email`, `language` (English / Hindi / Marathi) |
  | The property | `locality`, `project_type` (home / office / other), `bhk`, `carpet_area_sqft`, `current_state`, `is_rental` (yes/no), `landlord_consent` (yes/no) |
  | The work | `scope`, `service_wanted` (design_and_execution / design_only / execution_only), `completion_deadline`, `budget_volunteered` |
  | Who and how | `owners_attend` (yes/no), `referral_source`, `referrer_name` |
  | Routing | `intent` (new_enquiry / existing_client / other), `is_complaint` (yes/no), `asked_price` (yes/no), `wants_person` (yes/no) |
  | **The booking claim** | **`booked_consultation`** (yes/no), **`booked_time`**, plus `wants_person` above |

  `booked_consultation` must be `yes` **only** when the Cal.com booking tool confirmed the booking during the call; the app never trusts it alone (the real booking comes from Cal.com), but it is what lets the app match a booking to the call when the phone number or email do not, and what raises the urgent "caller was told booked but no booking found" alert.
  - **Fastest way:** the ready-made body is [`docs/vaani-data-points.json`](vaani-data-points.json) (a test keeps it identical to the code). Apply it with `PATCH https://api.vaanivoice.ai/api/agent/{agent_id}/analysis`, header `X-API-Key: <your key>`, that file as the JSON body *(Vaani docs)*. Vaani's docs say included fields are merged but **do not say whether the data_points list replaces or adds to an existing one**, so afterwards open the agent and check that exactly these 23 exist (delete any duplicates).
  - Or enter them by hand in the dashboard (the screen label is not in Vaani's public docs; its fields are name, prompt, allowed values, nullable).
- [ ] **Set the webhook URL:** Vaani dashboard → **Settings → Webhooks** → add `https://<your-site>/api/vaanivoice/webhook/<VAANIVOICE_WEBHOOK_SECRET>` *(Vaani docs: there is no API for this, it is a dashboard setting)*. Vaani sends several event types to that one URL; the app ignores all but `call_postprocessing`. **Not documented by Vaani:** whether it retries a failed delivery, and any signature.
- [ ] **Get a phone number onto the agent:** Vaani → **Settings → Telephony** → **Provision a Number** (country and area code) or **Connect SIP Trunk**; then assign it to the agent *(Vaani docs)*. **Vaani's docs describe only outbound use of numbers; whether a provisioned number answers inbound calls is not documented.** The first test call is the proof: call the number from your phone. Earlier notes found no Pune or Maharashtra numbers offered (Vobiz), so how callers will reach this number (publish it, or forward the studio's number to it) is a separate owner decision.
- [ ] **Ask Vaani support to fix `call-history`** (see 4.3a): it returns HTTP 500 "Invalid client_id format" for our key. Until then the caller's number is missing from every call. Test it any time with `curl -H "X-API-Key: <key>" "https://api.vaanivoice.ai/api/call-history?page=1&page_size=5"`; it should answer 200 with a `data` list.
- [ ] **Confirm Vaani's data handling** for caller audio and transcripts (training, sub-processors, region). Vaani's docs say nothing; hard rule 6 needs an answer.
- [ ] Generate the API key (`VAANIVOICE_API_KEY`, 1) and paste it into Vercel.

### 2.2 Cal.com

- [ ] **Create the event type "Aangan consultation"** (one event type; the name must match the prompt). Set its length to the consultation length you want (the app records each booking's start and end from Cal.com).
- [ ] **Make the phone number a REQUIRED question.** In the event type's **Advanced** tab, **Booking questions**, add a **Phone** question and tick **Required** *(Cal.com help: "Booking Questions"; Cal.com's newer layout may call this the Booking form, so the exact path depends on your version)*. The app tries to match a booking to its call by phone number first (hashed), then email, then "the only candidate", so a phone on the booking is what makes matching reliable. **Not verified:** whether Vaani's booking tool passes the phone number into that question. Check on the first test booking (query in Part 3, step 11).
- [ ] **Create the webhook:** Cal.com → `/settings/developer/webhooks` → **Subscriber URL** `https://<your-site>/api/calcom/webhook`; **triggers**: Booking Created, Booking Cancelled, Booking Rescheduled, Booking Rejected; **Secret** = your `CALCOM_SIGNING_SECRET` *(Cal.com docs; the subscriber URL must be https)*. The signature arrives in header `x-cal-signature-256`.
- [ ] Create the API key for Vaani (Settings → Security) and give it to Vaani in 2.1.

### 2.3 Telegram

- [ ] **Make the bot:** in Telegram message **@BotFather**, send `/newbot`, choose a name and a username ending in `bot`. Copy the token into `TELEGRAM_BOT_TOKEN`.
- [ ] **Each person presses Start on the bot** (every designer, the design lead, the owner, later Nikhil). A bot cannot message someone who has not started it.
- [ ] **Read each chat id (do this BEFORE the webhook step):** after people have pressed Start, open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser; each message shows `message.chat.id`, a number. Telegram's `getUpdates` stops working the moment a webhook is set *(Telegram docs)*; if you set the webhook too early, call `deleteWebhook` first. Put the owner's number in `OWNER_TELEGRAM_CHAT_ID` and each designer's in their `designers.telegram_chat_id` (2.6).
- [ ] **Set the webhook (after the site is deployed):** `curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" -d "url=https://<your-site>/api/telegram/webhook" -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"` *(Telegram docs)*. The app answers button presses only when Telegram sends that secret.

### 2.4 HubSpot (can wait until after the first call)

- [ ] Create the private app and token as in Part 1 (**Development → Legacy apps → Create legacy app → Private**), with the five scopes listed there. HubSpot does not map scopes to individual calls in the page we read; if a call is refused, HubSpot's error names the missing scope, so add it.
- [ ] Decide which **deal pipeline and first stage** agent-sourced deals start in; read their ids with the two GET calls in Part 1; set `HUBSPOT_PIPELINE_ID` and `HUBSPOT_DEAL_STAGE_ID`. (I can read the ids for you once the token has the scopes: say so.)
- [x] **Map the studio's stages** (done 2026-10-08). Pipeline `default` ("Sales Pipeline"): `HUBSPOT_PIPELINE_ID=default`, `HUBSPOT_DEAL_STAGE_ID=qualifiedtobuy` (New enquiry), `HUBSPOT_STAGE_MAP={"appointmentscheduled":"consult_booked","presentationscheduled":"consult_held","contractsent":"quote_sent"}`. `hubspot:stages` reads the account live with the new deal scopes (the read path is now live-checked). "Client approved" (`decisionmakerboughtin`) is deliberately unmapped: the deal keeps its quote_sent stage and one owner alert names it. Still to do: set the same three values in Vercel, rotate the service key (its value was shown in a screenshot), and move one test deal to confirm the dashboard shows it within ~5 minutes.
- [ ] **How the sync works (built 2026-10-08):** every minute the app re-reads the deals it created, open deals every 5 minutes and won/lost deals every 6 hours, and copies each deal's stage and quote amount (rupees only) into its own database. A consultation-done or later stage also marks the booking as attended. The dashboard's "Consultation held / Quote sent / Won" steps, the quote values and the designers' page fill in from that. If a deal sits in a stage that is not mapped, the owner gets one Telegram alert naming the stage, and the deal keeps its last known stage.

### 2.5 Resend (can wait until after the first call)

- [ ] resend.com → **Domains** → add a domain you own; Resend recommends a **subdomain** (for example `mail.yourdomain`) *(Resend docs)*. Add the DNS records Resend shows (its "Add a domain" guide lists them; we did not read it) at your DNS host, wait for the domain to show verified.
- [ ] Create an API key; set `RESEND_API_KEY`, `RESEND_FROM` (an address at that domain), `RESEND_REPLY_TO`.

### 2.6 Supabase

- [ ] **Create the project:** region **South Asia (Mumbai), `ap-south-1`** *(Supabase docs; the docs do not say whether the region can be changed later, so choose it correctly now)*. Save the database password.
- [ ] **Apply the schema** from this repo's `supabase/migrations` (5 migrations). In Terminal, in the project folder: `supabase login`, `supabase link --project-ref <ref>`, `supabase db push` *(Supabase docs)*. Use `supabase db push --dry-run` first to see what it will do.
- [ ] **Load the starting data** (`supabase/seed.sql`: the rules version, the approved wording, festival dates, studio hours). `db push` only includes seed data with the `--include-seed` flag *(Supabase docs; the page does not name the file)*; if in doubt, open the Supabase **SQL editor**, paste `supabase/seed.sql`, and run it (it is safe to run twice).
- [ ] **Add the real designers.** The seed adds three placeholder "TEST" designers. Turn them off and add yours in the SQL editor:
  ```sql
  update designers set active = false where is_test;
  insert into designers (name, areas, project_types, calendar_id, telegram_chat_id, is_principal, is_design_lead, active, is_test)
  values ('Designer name', '{}', array['home','office'], null, 123456789, false, false, true, false);
  ```
  `areas '{}'` means any area. Exactly one designer should have `is_design_lead = true` (alerts go to them) and, if you want a principal, one `is_principal = true`. `telegram_chat_id` is the number from 2.3. Leave `calendar_id` null: Google is parked and the app does not need it. (Add each designer's Google calendar id later only if you switch Google on.)
- [ ] **Copy `DATABASE_URL`** (Connect → Transaction pooler, add `?sslmode=require`). If the first deploy cannot connect and complains about a certificate, tell me: it is a one-line change in `src/db/open.ts`.
- [ ] Row-level security is on for every table with no public access; the app connects with the connection string's own login (the same kind of login the local Supabase test run used). Never put the project's public ("anon") key anywhere.

### 2.7 Vercel

- [ ] **Be on the Pro plan** (see 0.3).
- [ ] **Import the GitHub repo** `anudeeptatireddy-lgtm/aangan-phone-agent` as a new project. The framework is detected as Next.js and pnpm is detected from `pnpm-lock.yaml`.
- [ ] **Region:** already set to Mumbai (`bom1`) in `vercel.json` (Vercel's default would be Washington). Check **Settings → Functions → Function Regions** shows Mumbai after the first deploy *(Vercel docs)*.
- [ ] **Add the environment variables** (project **Settings → Environment Variables**) for the **Production** environment: everything marked First call or With deploy in Part 1, with **`DASHBOARD_PASSWORD`** among them. **Do not add `LOCAL_DB_DIR`.**
- [ ] **Deploy.** Then open `https://<your-site>/api/health`: it should answer `{"ok":true,...}`.
- [ ] Open `https://<your-site>/dashboard`: it should ask for the password. If it says "The dashboard is locked", `DASHBOARD_PASSWORD` is missing.
- [ ] After the first deploy, check **Settings → Cron Jobs** lists `/api/cron/tick` every minute.

---

## 3. The order to reach a first real test call (fewest steps)

Steps marked **(can wait)** are *not* needed for the first call.

1. **Generate the secrets** (Part 1 table). ~5 minutes.
2. **Supabase** (2.6): create the project in Mumbai, `db push`, load the seed, add the designer rows (use placeholder numbers for `telegram_chat_id` until step 4). Copy `DATABASE_URL`.
3. **Gemini:** create a key on a billed project; `GEMINI_PAID_TIER_CONFIRMED=true`.
4. **Telegram** (2.3): make the bot, everyone presses Start, read chat ids, fill the designers' `telegram_chat_id` and `OWNER_TELEGRAM_CHAT_ID`. *(Do not set the webhook yet.)*
5. **Vaani, part 1:** generate the API key (`VAANIVOICE_API_KEY`).
6. **Vercel** (2.7): import, set the env vars, deploy, check `/api/health` and the dashboard password screen. Now you know your real site address.
7. **Telegram webhook** (2.3 last step) now that the site exists.
8. **Cal.com** (2.2): event type "Aangan consultation", required phone question, the webhook to `https://<site>/api/calcom/webhook` with the signing secret, an API key.
9. **Vaani, part 2** (2.1): production agent with `prompt.v1.md` and the opening greeting, Cal.com integration, the 23 data points, the webhook URL, a phone number assigned.
10. **Make the first test call.** Call the Vaani number from your phone. Book a consultation for a home in Pune, give an email, and let it finish. Wait about two minutes after hanging up.
11. **Check it worked**, in this order:
    - **Vercel → project → Logs:** a request to `/api/vaanivoice/webhook/…` answering 200 (a 503 means: no Gemini key, no database, or Vaani lookup failed; the owner alert in Telegram says which), and one to `/api/calcom/webhook` answering 200.
    - **Telegram:** the designer who was assigned received the note with **Accept / Can't take it**; press Accept and the message changes to "Accepted".
    - **Dashboard** (`/dashboard`; make sure **Live** is selected, not Demo): the call appears under Calls; open it and check the disclosure says "Yes", the booking and designer are filled, and "Bookings matched to calls" shows 1 matched.
    - **Was the caller's number captured?** The call's row on the dashboard shows a masked number only if Vaani's call history works (4.3a).
    - **Was the phone number on the booking?** In the Supabase SQL editor: `select uid, attendee_contact_hash is not null as has_phone, claimed_by_call from calcom_bookings order by received_at desc limit 3;` (`has_phone` should be true, `claimed_by_call` filled). If `has_phone` is false the match worked by email or "only candidate"; tell me and I will adjust.
    - **Did Vaani fill the data points?** `GET https://api.vaanivoice.ai/api/call_details/<call_id>` with your key; the `entity` object should contain the 23 names. (Missing ones mean the data point names do not match.)
12. **After the first call (can wait, in this order):** HubSpot (2.4), Resend (2.5), `VAANIVOICE_RATE_INR_PER_MIN`, Nikhil's chat id, the real designers' chat ids (if you used placeholders), publishing the number (or forwarding the studio's number), and a short note to staff.

**What you can skip entirely for the first call:** HubSpot, Resend, Nikhil's Telegram id, the rate, `HUBSPOT_PORTAL_ID`, Google, `FRONT_DESK_NUMBER`, `DESIGN_LEAD_NUMBER`, `VAANIVOICE_CLIENT_ID`, and `LOCAL_DB_DIR`. Vercel Pro and `CRON_SECRET` are needed to deploy but the first call does not depend on the every-minute tick.

---

## 4. Known limits (engineering follow-ups, not owner steps)

1. ~~Google parked: designers need a placeholder `calendar_id`.~~ **Fixed 2026-10-08.** In production without `GOOGLE_SERVICE_ACCOUNT_JSON`, a designer with no calendar id is eligible for Cal.com bookings.
2. ~~Google parked: no automatic reassignment.~~ **Fixed 2026-10-08.** A designer who declines or does not accept in 30 working minutes is replaced by the next eligible designer who is free in our own bookings table; the booking keeps its Cal.com id; no calendar is read, written or deleted. If everyone has been tried, the design lead (then the owner) is alerted, as before. Switching Google on later restores calendar-aware behaviour with no code change.
3. ~~Vaani retries are not documented.~~ **Fixed 2026-10-08 (needs Vaani's call history to work, see 3a).** Every tick (every minute) the app reads Vaani's call history and processes any inbound call it has no finished record of: it waits 10 minutes after the call ends (the webhook is probably coming), retries a half-processed call after 30, does at most 5 per tick, and a call that still cannot be read an hour after it ended is recorded as **failed** on the dashboard and the owner is told once. It never touches outbound calls.
3a. **Vaani's `call-history` endpoint returns HTTP 500 for this account** (checked read-only on 2026-10-08: `Error fetching call history: 400: Invalid client_id format`; Vaani's own OpenAPI file says the endpoint takes only the key, `page` and `page_size`, so this is on Vaani's side; the call lookup `call_details` works). Consequences until Vaani fixes it: (a) **calls arrive without the caller's phone number** (the number exists only in the history, not in the webhook or the call details), so the dashboard shows no number and returning callers are not recognised; booking matching falls back to email, then "the only candidate"; (b) the recovery described above cannot run, and the owner gets one alert a day saying so. Calls themselves are **not** rejected. **Owner step: ask Vaani support to fix it.**
4. **The phone-number question reaching the Cal.com booking is unverified** (2.2). The first test call answers it.
5. **Hosted storage of Telegram/Vaani delivery de-duplication is per server instance** (the webhook inbox is still in memory). Button presses are safe to repeat; the cost of the gap is a duplicate log line.
6. ~~Funnel steps after "With a designer" have no live source.~~ **Fixed 2026-10-08.** The tick reads each deal's stage and amount from HubSpot (see 2.4). **Unverified against live HubSpot:** your token cannot read deals yet (it returns 403 MISSING_SCOPES), so the request and response shapes were built from HubSpot's documentation and tested against recorded shapes only. Once the scopes are added, run `corepack pnpm hubspot:stages`, and after the first test deal is moved in HubSpot check that its stage appears on the dashboard within about 5 minutes.
7. **Fixed monthly costs** (phone number, hosting) have no entry screen: add rows to `usage_costs` with `source = 'manual_fixed'`.
8. **Complaints "called back within 15 minutes"** shows "no data yet" until someone marks a complaint resolved; there is no screen for that yet.
9. **One shared dashboard password** in production: reveals are logged as "dashboard" and reviewers type their own name.
10. **The old HubSpot path in `docs/vendor-findings-s5.md`** ("Settings → Integrations → Private Apps") is out of date; HubSpot now calls these **Development → Legacy apps**. This checklist has the current path.
