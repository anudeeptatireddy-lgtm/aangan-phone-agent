import { createSign } from "node:crypto";
import type { Interval } from "@/core/booking/types";
import type { CalendarEventInput, CalendarPort } from "@/core/ports";

// Endpoints, bodies and the service-account JWT flow verified against developers.google.com (docs/vendor-findings-s6.md).
export interface ServiceAccount { client_email: string; private_key: string }
export interface GoogleCalendarOptions {
  serviceAccount: ServiceAccount;
  /** Domain-wide delegation: the Workspace user to act as. Only then can events carry attendees (Google's rule for service accounts). */
  impersonate?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar";
const MAX_CALENDARS = 50;
const b64u = (v: string | Buffer) => Buffer.from(v).toString("base64url");

export class GoogleCalendar implements CalendarPort {
  private fetchImpl: typeof fetch;
  private now: () => Date;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private o: GoogleCalendarOptions) {
    if (!o.serviceAccount?.client_email || !o.serviceAccount?.private_key) throw new Error("GoogleCalendar needs a service account (client_email + private_key)");
    this.fetchImpl = o.fetch ?? fetch;
    this.now = o.now ?? (() => new Date());
  }

  private async http(url: string, init: RequestInit): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 15_000);
    try { return await this.fetchImpl(url, { ...init, signal: ctl.signal }); }
    catch (e) { throw new Error(`google calendar network error: ${String((e as Error).message).slice(0, 120)}`); }
    finally { clearTimeout(timer); }
  }

  private async accessToken(): Promise<string> {
    const nowS = Math.floor(this.now().getTime() / 1000);
    if (this.token && this.token.expiresAt - 60 > nowS) return this.token.value;
    const claims: Record<string, unknown> = { iss: this.o.serviceAccount.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowS, exp: nowS + 3600 };
    if (this.o.impersonate) claims.sub = this.o.impersonate;
    const unsigned = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64u(JSON.stringify(claims))}`;
    const sig = createSign("RSA-SHA256").update(unsigned).sign(this.o.serviceAccount.private_key);
    const res = await this.http(TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64u(sig)}` }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) throw new Error(`google token request failed: ${res.status}${json.error ? ` ${json.error}` : ""}`);
    this.token = { value: json.access_token, expiresAt: nowS + (json.expires_in ?? 3600) };
    return json.access_token;
  }

  private async call(url: string, method: string, body?: unknown): Promise<Response> {
    return this.http(url, { method, headers: { authorization: `Bearer ${await this.accessToken()}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  }

  async freeBusy(calendarIds: string[], from: Date, to: Date): Promise<Map<string, Interval[]>> {
    const out = new Map<string, Interval[]>();
    for (let i = 0; i < calendarIds.length; i += MAX_CALENDARS) {
      const chunk = calendarIds.slice(i, i + MAX_CALENDARS);
      const res = await this.call(`${API}/freeBusy`, "POST", { timeMin: from.toISOString(), timeMax: to.toISOString(), items: chunk.map((id) => ({ id })) });
      if (!res.ok) throw new Error(`google freeBusy failed: ${res.status}`);
      const json = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> };
      for (const id of chunk) {
        const c = json.calendars?.[id];
        if (!c) throw new Error("google freeBusy: calendar missing from response");   // never treat an unknown calendar as free
        if (c.errors?.length) throw new Error(`google freeBusy: calendar unreadable (${c.errors.map((e) => e.reason).join(",")})`);
        out.set(id, (c.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })));
      }
    }
    return out;
  }

  async createEvent(e: CalendarEventInput): Promise<{ eventId: string }> {
    const body: Record<string, unknown> = {
      summary: e.summary, description: e.description,
      start: { dateTime: e.start.toISOString(), timeZone: "Asia/Kolkata" }, end: { dateTime: e.end.toISOString(), timeZone: "Asia/Kolkata" },
    };
    if (e.location) body.location = e.location;
    if (this.o.impersonate && e.attendeeEmails.length) body.attendees = e.attendeeEmails.map((email) => ({ email }));
    const res = await this.call(`${API}/calendars/${encodeURIComponent(e.calendarId)}/events?sendUpdates=none`, "POST", body);
    if (!res.ok) throw new Error(`google createEvent failed: ${res.status}`);
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    if (!json.id) throw new Error("google createEvent: response had no id");
    return { eventId: json.id };
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const res = await this.call(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, "DELETE");
    if (res.ok || res.status === 404 || res.status === 410) return; // already gone: the goal (no event) is met
    throw new Error(`google deleteEvent failed: ${res.status}`);
  }
}
