import { describe, it, expect } from "vitest";
import { redact } from "@/lib/log";

describe("log redaction", () => {
  it("redacts secret-like keys", () => {
    const r = redact({ authorization: "Bearer abc", api_key: "k", token: "t", ok: 1 }) as Record<string, unknown>;
    expect(r.authorization).toBe("[REDACTED]");
    expect(r.api_key).toBe("[REDACTED]");
    expect(r.token).toBe("[REDACTED]");
    expect(r.ok).toBe(1);
  });
  it("masks phone numbers anywhere in strings and nested values", () => {
    const r = JSON.stringify(redact({ msg: "call from +91 98765 43210 now", nested: { p: "9876543210" } }));
    expect(r).not.toContain("98765 43210");
    expect(r).not.toContain("9876543210");
  });
  it("redacts email-ish keys and values", () => {
    const r = JSON.stringify(redact({ email: "a@b.com", note: "mail a@b.com" }));
    expect(r).not.toContain("a@b.com");
  });
});
