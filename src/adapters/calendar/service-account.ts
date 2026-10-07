import type { ServiceAccount } from "./google";

/** Accepts the key file's JSON as is, or base64 of it (easier to paste into an env var). Errors never echo the value. */
export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  let j: Partial<ServiceAccount>;
  try { j = JSON.parse(text); } catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (or base64 of JSON)"); }
  if (!j.client_email || !j.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key");
  return { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n") };
}
