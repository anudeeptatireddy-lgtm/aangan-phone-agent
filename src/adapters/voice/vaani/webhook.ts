import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Source: https://www.vaanilabs.in/openapi/v1/vaanivoice.yaml (webhooks.event-delivery), read 2026-10-07.
// Header X-VaaniVoice-Signature = "sha256=" + lowercase hex HMAC-SHA256 over the EXACT raw body bytes,
// keyed with the vv_whk_ secret shown once at registration. Compare in constant time.
export function verifyVaaniSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const got = Buffer.from(header.slice("sha256=".length), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Envelope is documented; `data` is explicitly "defensive-parse, no sub-field guaranteed", and phone numbers in it are masked.
export const VaaniEnvelope = z.object({
  id: z.string(),
  type: z.string(),
  created: z.number().int(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type VaaniEnvelope = z.infer<typeof VaaniEnvelope>;

export function parseVaaniEnvelope(rawBody: string): VaaniEnvelope | null {
  try {
    const r = VaaniEnvelope.safeParse(JSON.parse(rawBody));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
