import type { EmailMessage, EmailPort } from "@/core/ports";

// POST https://api.resend.com/emails with an Idempotency-Key header (<= 256 chars, kept 24h): verified in docs/vendor-findings-s5.md.
export interface ResendOptions { apiKey: string; from: string; replyTo?: string; fetch?: typeof fetch; timeoutMs?: number }

export class ResendEmail implements EmailPort {
  private fetchImpl: typeof fetch;
  constructor(private o: ResendOptions) {
    if (!o.apiKey || !o.from) throw new Error("ResendEmail needs an API key and a from-address on a verified domain");
    this.fetchImpl = o.fetch ?? fetch;
  }

  async send(m: EmailMessage): Promise<{ id: string }> {
    if (m.idempotencyKey.length > 256) throw new Error("Resend idempotency key must be at most 256 characters");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 15_000);
    try {
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json", "idempotency-key": m.idempotencyKey },
        body: JSON.stringify({ from: this.o.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}), ...(this.o.replyTo ? { reply_to: this.o.replyTo } : {}) }),
        signal: ctl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
      if (!res.ok) throw new Error(`resend send failed: ${res.status}${json.name ? ` ${json.name}` : ""}`);
      if (!json.id) throw new Error("resend: response had no id");
      return { id: json.id };
    } catch (e) {
      const msg = (e as Error).message;
      throw new Error(msg.startsWith("resend") ? msg : `resend network error: ${msg.split(this.o.apiKey).join("[key]").slice(0, 120)}`);
    } finally { clearTimeout(timer); }
  }
}
