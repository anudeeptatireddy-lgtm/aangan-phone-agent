import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyVaaniSignature, parseVaaniEnvelope } from "@/adapters/voice/vaani/webhook";

// Documented at https://www.vaanilabs.in/openapi/v1/vaanivoice.yaml (webhooks.event-delivery):
// X-VaaniVoice-Signature = "sha256=" + lowercase hex HMAC-SHA256 of the exact raw body, keyed with the vv_whk_ secret.
const secret = "vv_whk_testsecret";
const body = JSON.stringify({ id: "evt_1", type: "call.completed", created: 1714003200, data: { x: 1 } });
const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("verifyVaaniSignature", () => {
  it("accepts a valid signature", () => expect(verifyVaaniSignature(body, sig, secret)).toBe(true));
  it("rejects wrong secret, tampered body, malformed header, missing header", () => {
    expect(verifyVaaniSignature(body, sig, "other")).toBe(false);
    expect(verifyVaaniSignature(body + " ", sig, secret)).toBe(false);
    expect(verifyVaaniSignature(body, "sha256=zz", secret)).toBe(false);
    expect(verifyVaaniSignature(body, sig.replace("sha256=", ""), secret)).toBe(false);
    expect(verifyVaaniSignature(body, undefined, secret)).toBe(false);
  });
});
describe("parseVaaniEnvelope", () => {
  it("parses id/type/created/data defensively", () => {
    expect(parseVaaniEnvelope(body)).toMatchObject({ id: "evt_1", type: "call.completed" });
  });
  it("returns null for junk", () => {
    expect(parseVaaniEnvelope("not json")).toBeNull();
    expect(parseVaaniEnvelope("{}")).toBeNull();
  });
});
