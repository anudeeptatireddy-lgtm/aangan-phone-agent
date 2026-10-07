import { describe, it, expect } from "vitest";
import { mapVaaniCallCompleted, VAANI_CALL_COMPLETED_REQUIREMENTS } from "@/adapters/voice/vaani/call-record";

describe("Vaani call.completed -> CallRecordInput", () => {
  it("is deliberately unmapped: the payload fields are not documented (hard rule 7)", () => {
    expect(mapVaaniCallCompleted({ id: "evt_1", type: "call.completed", created: 1, data: { anything: 1 } })).toBeNull();
  });
  it("lists exactly what Vaani must tell us before this can be implemented", () => {
    expect(VAANI_CALL_COMPLETED_REQUIREMENTS).toEqual(expect.arrayContaining(["call id", "transcript with speaker turns", "start/answer/end times", "recording url"]));
  });
});
