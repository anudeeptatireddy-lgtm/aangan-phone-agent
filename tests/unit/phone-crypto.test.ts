import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptPhone, decryptPhone } from "@/lib/phone-crypto";

const KEY = randomBytes(32).toString("hex");

describe("phone encryption (AES-256-GCM, app-level)", () => {
  it("round-trips", () => expect(decryptPhone(encryptPhone("+919876543210", KEY), KEY)).toBe("+919876543210"));
  it("never contains the plaintext and uses a fresh nonce each time", () => {
    const a = encryptPhone("+919876543210", KEY), b = encryptPhone("+919876543210", KEY);
    expect(a.toString("latin1")).not.toContain("9876543210");
    expect(a.equals(b)).toBe(false);
  });
  it("rejects tampering and the wrong key", () => {
    const c = encryptPhone("+919876543210", KEY);
    const bad = Buffer.from(c); bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    expect(() => decryptPhone(bad, KEY)).toThrow();
    expect(() => decryptPhone(c, randomBytes(32).toString("hex"))).toThrow();
  });
  it("requires a 64-hex-char key and never echoes it in the error", () => {
    expect(() => encryptPhone("+919876543210", "short")).toThrow(/PHONE_ENC_KEY/);
    try { encryptPhone("+919876543210", "short-secret-value"); } catch (e) { expect(String(e)).not.toContain("short-secret-value"); }
  });
});
