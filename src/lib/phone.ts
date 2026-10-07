import { createHmac } from "node:crypto";

/** Normalize an Indian-default phone number to E.164, or null if it is not plausible. */
export function normalizeE164(raw: string, defaultCountry = "91"): string | null {
  if (!raw) return null;
  const hasPlus = raw.trim().startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (hasPlus) {
    // already has a country code
  } else if (d.length === 10) {
    d = defaultCountry + d;
  } else if (d.length === 11 && d.startsWith("0")) {
    d = defaultCountry + d.slice(1);
  } else if (d.length === 12 && d.startsWith(defaultCountry)) {
    // 91XXXXXXXXXX
  } else {
    return null;
  }
  if (d.length < 11 || d.length > 15) return null;
  return "+" + d;
}

/** `+91 98••••••10` — safe for logs and tool responses. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  const cc = d.length > 10 ? d.slice(0, d.length - 10) : "";
  const national = d.slice(cc.length);
  const masked = national.slice(0, 2) + "•".repeat(Math.max(national.length - 4, 0)) + national.slice(-2);
  return `${cc ? "+" + cc + " " : ""}${masked}`;
}

/** Keyed lookup hash so the number itself need not be the join key. */
export function hashPhone(e164: string, pepper: string): string {
  return createHmac("sha256", pepper).update(e164).digest("hex");
}
