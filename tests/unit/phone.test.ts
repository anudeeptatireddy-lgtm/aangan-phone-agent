import { describe, it, expect } from "vitest";
import { normalizeE164, maskPhone, hashPhone } from "@/lib/phone";

describe("phone", () => {
  it("normalizes common Indian formats", () => {
    expect(normalizeE164("+91 98765 43210")).toBe("+919876543210");
    expect(normalizeE164("098765-43210")).toBe("+919876543210");
    expect(normalizeE164("9876543210")).toBe("+919876543210");
    expect(normalizeE164("919876543210")).toBe("+919876543210");
  });
  it("rejects junk", () => {
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164("12345")).toBeNull();
    expect(normalizeE164("abc")).toBeNull();
  });
  it("masks so the full number never appears", () => {
    const m = maskPhone("+919876543210");
    expect(m).toBe("+91 98••••••10");
    expect(m).not.toContain("76543");
  });
  it("hash is stable, keyed, and does not contain the number", () => {
    const a = hashPhone("+919876543210", "pepper-1");
    expect(a).toBe(hashPhone("+919876543210", "pepper-1"));
    expect(a).not.toBe(hashPhone("+919876543210", "pepper-2"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
