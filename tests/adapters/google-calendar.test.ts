import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { GoogleCalendar } from "@/adapters/calendar/google";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SA = { client_email: "bot@proj.iam.gserviceaccount.com", private_key: privateKey };
const NOW = new Date("2026-10-07T05:00:00Z");

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
function make(handlers: ((c: Call) => Response)[], o: { impersonate?: string } = {}) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const raw = init.body ? String(init.body) : "";
    const c: Call = { url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: raw.startsWith("{") ? JSON.parse(raw) : raw };
    calls.push(c);
    if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 });
    const h = handlers.shift();
    if (!h) throw new Error("unexpected call " + url);
    return h(c);
  }) as unknown as typeof fetch;
  return { cal: new GoogleCalendar({ serviceAccount: SA, fetch: f, now: () => NOW, ...o }), calls };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const b64 = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString());

describe("GoogleCalendar auth", () => {
  it("exchanges a correctly signed RS256 JWT for a token and reuses it", async () => {
    const { cal, calls } = make([() => json({ calendars: { a: { busy: [] } } }), () => json({ calendars: { a: { busy: [] } } })]);
    await cal.freeBusy(["a"], NOW, new Date(NOW.getTime() + 3600_000));
    await cal.freeBusy(["a"], NOW, new Date(NOW.getTime() + 3600_000));
    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    const t = calls[0]!;
    const form = new URLSearchParams(t.body);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, sig] = form.get("assertion")!.split(".");
    expect(b64(h!)).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(b64(c!)).toMatchObject({ iss: SA.client_email, aud: "https://oauth2.googleapis.com/token", iat: NOW.getTime() / 1000, exp: NOW.getTime() / 1000 + 3600 });
    expect(b64(c!).sub).toBeUndefined();
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig!, "base64url"))).toBe(true);
  });
  it("sets sub only when impersonating (domain-wide delegation)", async () => {
    const { cal, calls } = make([() => json({ calendars: { a: { busy: [] } } })], { impersonate: "hello@aangan.example" });
    await cal.freeBusy(["a"], NOW, new Date(NOW.getTime() + 1));
    expect(b64(new URLSearchParams(calls[0]!.body).get("assertion")!.split(".")[1]!).sub).toBe("hello@aangan.example");
  });
  it("a token failure never leaks the private key", async () => {
    const f = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    const cal = new GoogleCalendar({ serviceAccount: SA, fetch: f, now: () => NOW });
    const e = await cal.freeBusy(["a"], NOW, NOW).then(() => new Error("none"), (x) => x as Error);
    expect(e.message).toMatch(/400/);
    expect(e.message).not.toContain("PRIVATE KEY");
  });
});

describe("freeBusy", () => {
  it("posts the query and maps busy intervals per calendar", async () => {
    const { cal, calls } = make([() => json({ calendars: { a: { busy: [{ start: "2026-10-08T05:30:00Z", end: "2026-10-08T06:30:00Z" }] }, b: { busy: [] } } })]);
    const to = new Date(NOW.getTime() + 86_400_000);
    const m = await cal.freeBusy(["a", "b"], NOW, to);
    expect(calls[1]).toMatchObject({ url: "https://www.googleapis.com/calendar/v3/freeBusy", method: "POST" });
    expect(calls[1]!.headers.authorization).toBe("Bearer tok-1");
    expect(calls[1]!.body).toEqual({ timeMin: NOW.toISOString(), timeMax: to.toISOString(), items: [{ id: "a" }, { id: "b" }] });
    expect(m.get("a")).toEqual([{ start: new Date("2026-10-08T05:30:00Z"), end: new Date("2026-10-08T06:30:00Z") }]);
    expect(m.get("b")).toEqual([]);
  });
  it("fails closed if Google reports an error for a calendar (an unreadable calendar must not look free)", async () => {
    const { cal } = make([() => json({ calendars: { a: { errors: [{ domain: "global", reason: "notFound" }] } } })]);
    await expect(cal.freeBusy(["a"], NOW, new Date(NOW.getTime() + 1))).rejects.toThrow(/notFound/);
  });
  it("fails closed if a requested calendar is missing from the response", async () => {
    const { cal } = make([() => json({ calendars: {} })]);
    await expect(cal.freeBusy(["a"], NOW, new Date(NOW.getTime() + 1))).rejects.toThrow(/missing/);
  });
  it("splits more than 50 calendars into several requests", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `c${i}`);
    const reply = (c: Call) => json({ calendars: Object.fromEntries(c.body.items.map((x: { id: string }) => [x.id, { busy: [] }])) });
    const { cal, calls } = make([reply, reply]);
    const m = await cal.freeBusy(ids, NOW, new Date(NOW.getTime() + 1));
    expect(m.size).toBe(51);
    expect(calls.filter((c) => c.url.endsWith("/freeBusy"))).toHaveLength(2);
  });
});

describe("createEvent / deleteEvent", () => {
  const ev = { calendarId: "cal@x", start: new Date("2026-10-08T05:30:00Z"), end: new Date("2026-10-08T06:30:00Z"), summary: "Aangan consultation · Priya", description: "NEW", attendeeEmails: ["p@example.com"] };
  it("creates the event in IST without inviting attendees (service accounts cannot, without delegation)", async () => {
    const { cal, calls } = make([() => json({ id: "evt9" })]);
    expect(await cal.createEvent(ev)).toEqual({ eventId: "evt9" });
    expect(calls[1]!.url).toBe("https://www.googleapis.com/calendar/v3/calendars/cal%40x/events?sendUpdates=none");
    expect(calls[1]!.body).toEqual({ summary: ev.summary, description: "NEW", start: { dateTime: "2026-10-08T05:30:00.000Z", timeZone: "Asia/Kolkata" }, end: { dateTime: "2026-10-08T06:30:00.000Z", timeZone: "Asia/Kolkata" } });
  });
  it("with delegation configured, adds the caller as an attendee", async () => {
    const { cal, calls } = make([() => json({ id: "evt9" })], { impersonate: "hello@aangan.example" });
    await cal.createEvent(ev);
    expect(calls[1]!.body.attendees).toEqual([{ email: "p@example.com" }]);
  });
  it("an event response without an id is an error", async () => {
    const { cal } = make([() => json({})]);
    await expect(cal.createEvent(ev)).rejects.toThrow(/id/);
  });
  it("deletes quietly; an already-gone event (404/410) counts as deleted", async () => {
    const { cal, calls } = make([() => new Response(null, { status: 204 }), () => new Response("{}", { status: 410 })]);
    await cal.deleteEvent("cal@x", "evt9");
    await expect(cal.deleteEvent("cal@x", "evt9")).resolves.toBeUndefined();
    expect(calls[1]).toMatchObject({ method: "DELETE", url: "https://www.googleapis.com/calendar/v3/calendars/cal%40x/events/evt9?sendUpdates=none" });
  });
  it("other delete failures throw", async () => {
    const { cal } = make([() => new Response("{}", { status: 403 })]);
    await expect(cal.deleteEvent("cal@x", "evt9")).rejects.toThrow(/403/);
  });
});

import { parseServiceAccount } from "@/adapters/calendar/service-account";
describe("parseServiceAccount", () => {
  const j = JSON.stringify({ client_email: "a@b.iam", private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n" });
  it("accepts raw JSON or base64 and restores newlines", () => {
    expect(parseServiceAccount(j).client_email).toBe("a@b.iam");
    expect(parseServiceAccount(Buffer.from(j).toString("base64")).private_key).toContain("\n");
  });
  it("rejects junk without echoing it", () => {
    expect(() => parseServiceAccount("SECRETJUNK")).toThrow(/not valid JSON/);
    try { parseServiceAccount("SECRETJUNK"); } catch (e) { expect((e as Error).message).not.toContain("SECRETJUNK"); }
    expect(() => parseServiceAccount("{}")).toThrow(/client_email/);
  });
});
