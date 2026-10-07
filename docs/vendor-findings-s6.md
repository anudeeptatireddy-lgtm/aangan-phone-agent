# Session 6 vendor facts (Google Calendar), verified against developers.google.com on 2026-10-07

| Call | Verified fact we rely on |
|---|---|
| Free/busy | `POST https://www.googleapis.com/calendar/v3/freeBusy`, body `{timeMin, timeMax, items:[{id}]}` (RFC3339), response `calendars.<id>.busy[{start,end}]` and `calendars.<id>.errors[{domain,reason}]`; max 50 calendars per query (`calendarExpansionMax`). Scope `calendar.freebusy` or `calendar`. |
| Create event | `POST /calendar/v3/calendars/{calendarId}/events?sendUpdates=none`; body `summary, description, start{dateTime,timeZone}, end{...}, attendees[{email}], location`; response `id`. Scope `calendar` or `calendar.events`. |
| **Attendees** | Google: "Service accounts need to use domain-wide delegation of authority to populate the attendee list." So the adapter adds attendees **only** when `GOOGLE_IMPERSONATE_USER` is set; otherwise the caller is told by the Resend email (their calendar invite is not needed). |
| Delete event | `DELETE /calendar/v3/calendars/{calendarId}/events/{eventId}?sendUpdates=none`, 200 with empty body. The docs do not state codes for an already-deleted event; **assumption:** 404/410 are treated as "already gone" (success). |
| Auth (service account, no client library) | JWT header `{alg:RS256,typ:JWT}`, claims `iss` (service-account email), `scope`, `aud=https://oauth2.googleapis.com/token`, `iat`, `exp` (<= 1 h), optional `sub` (impersonated user); sign SHA256withRSA; `POST https://oauth2.googleapis.com/token` with `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>` returns `access_token`, `expires_in`. |

## What the owner has to do (nothing is wired to a real calendar yet)
1. Google Cloud: create a project, enable the Google Calendar API, create a service account, download its JSON key.
2. Each designer shares their calendar with the service account's email (permission: "Make changes to events").
3. Put each designer's calendar id (usually their email) in `designers.calendar_id`.
4. Set `GOOGLE_SERVICE_ACCOUNT_JSON` (the JSON, or base64 of it). Optional: Workspace admin grants domain-wide delegation for scope `https://www.googleapis.com/auth/calendar`, then set `GOOGLE_IMPERSONATE_USER` so invites reach callers.

## Behaviour choices
- An unreadable or missing calendar in a free/busy answer **fails the whole check** (the booking says "calendar unavailable" and the call goes to a human) rather than treating it as free.
- Events are always created with `sendUpdates=none`; nothing is emailed by Google.
