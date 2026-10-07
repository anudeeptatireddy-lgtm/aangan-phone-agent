import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// App-level AES-256-GCM for the caller's phone number (stored in callers.phone_enc). Layout: nonce(12) | tag(16) | ciphertext.
// The key lives in PHONE_ENC_KEY (64 hex chars) and is never logged or stored with the data.
function key(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("PHONE_ENC_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(hex, "hex");
}

export function encryptPhone(e164: string, keyHex: string): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(keyHex), nonce);
  const ct = Buffer.concat([c.update(e164, "utf8"), c.final()]);
  return Buffer.concat([nonce, c.getAuthTag(), ct]);
}

export function decryptPhone(blob: Buffer, keyHex: string): string {
  const d = createDecipheriv("aes-256-gcm", key(keyHex), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8");
}
