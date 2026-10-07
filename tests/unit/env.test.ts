import { describe, it, expect } from "vitest";
import { getEnv } from "@/lib/env";

const ok = { NODE_ENV: "test", PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789" };

describe("env validation", () => {
  it("accepts a valid environment", () => expect(getEnv(ok).NODE_ENV).toBe("test"));
  it("names the bad variable but never prints its value", () => {
    try { getEnv({ ...ok, PHONE_HASH_PEPPER: "tiny" }); throw new Error("should have thrown"); }
    catch (e) { expect(String(e)).toContain("PHONE_HASH_PEPPER"); expect(String(e)).not.toContain("tiny"); }
  });
  it("PHONE_ENC_KEY must be 64 hex chars when set", () => {
    expect(() => getEnv({ ...ok, PHONE_ENC_KEY: "nothex" })).toThrow(/PHONE_ENC_KEY/);
    expect(getEnv({ ...ok, PHONE_ENC_KEY: "a".repeat(64) }).PHONE_ENC_KEY).toHaveLength(64);
  });
});
