import { describe, it, expect } from "vitest";
import { ResendEmail } from "@/adapters/email/resend";

const KEY = "re_secret_key_value";
function make(res: Response, o: { replyTo?: string } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }); return res; }) as unknown as typeof fetch;
  return { mail: new ResendEmail({ apiKey: KEY, from: "Aangan Studio <hello@aangan.example>", ...o, fetch: f }), calls };
}
const msg = { to: "p@example.com", subject: "Your consultation", text: "Hello", idempotencyKey: "confirmation_email:b1" };

describe("ResendEmail", () => {
  it("posts to /emails with the idempotency key header and returns the id", async () => {
    const { mail, calls } = make(new Response(JSON.stringify({ id: "em_1" }), { status: 200 }), { replyTo: "front@aangan.example" });
    expect(await mail.send(msg)).toEqual({ id: "em_1" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.headers["idempotency-key"]).toBe("confirmation_email:b1");
    expect(calls[0]!.body).toEqual({ from: "Aangan Studio <hello@aangan.example>", to: ["p@example.com"], subject: "Your consultation", text: "Hello", reply_to: "front@aangan.example" });
  });
  it("rejects an idempotency key over 256 chars before calling out", async () => {
    const { mail, calls } = make(new Response("{}"));
    await expect(mail.send({ ...msg, idempotencyKey: "k".repeat(257) })).rejects.toThrow(/256/);
    expect(calls).toHaveLength(0);
  });
  it("errors carry the status but never the key or the recipient", async () => {
    const { mail } = make(new Response(JSON.stringify({ message: `bad ${KEY} p@example.com` }), { status: 422 }));
    const e = await mail.send(msg).then(() => new Error("no error"), (x) => x as Error);
    expect(e.message).toMatch(/422/);
    expect(e.message).not.toContain(KEY);
    expect(e.message).not.toContain("p@example.com");
  });
  it("a success response without an id is an error", async () => {
    const { mail } = make(new Response("{}", { status: 200 }));
    await expect(mail.send(msg)).rejects.toThrow(/id/);
  });
});
