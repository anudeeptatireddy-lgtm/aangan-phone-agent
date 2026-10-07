import { describe, it, expect } from "vitest";
import { routeCall } from "@/core/routing/route-call";

const base = { isExistingClient: false, designerNames: ["Aryan", "Meera"] };

describe("routeCall (deterministic, hard rule 4)", () => {
  it("T09: angry existing client is escalated even if intent is unknown", () => {
    const r = routeCall({ ...base, intent: "unknown",
      utterance: "My project has been going for three months and my designer hasn't replied in five days. My designer is Aryan." });
    expect(r.route).toBe("escalate_complaint");
  });
  it("lookup says existing client -> escalate regardless of what the model thinks", () => {
    expect(routeCall({ ...base, isExistingClient: true, intent: "new_enquiry" }).route).toBe("escalate_complaint");
  });
  it("model intent complaint / existing_client -> escalate", () => {
    expect(routeCall({ ...base, intent: "complaint" }).route).toBe("escalate_complaint");
    expect(routeCall({ ...base, intent: "existing_client" }).route).toBe("escalate_complaint");
  });
  it("Hinglish and Marathi complaint keywords", () => {
    expect(routeCall({ ...base, utterance: "mera project ka kaam ruka hai, mujhe shikayat karni hai" }).route).toBe("escalate_complaint");
    expect(routeCall({ ...base, utterance: "माझी तक्रार आहे" }).route).toBe("escalate_complaint");
    expect(routeCall({ ...base, utterance: "मेरी शिकायत है" }).route).toBe("escalate_complaint");
  });
  it("a designer's name alone does not escalate (caller may just be called Aryan)", () => {
    expect(routeCall({ ...base, utterance: "Hi, I'm Aryan, I want to redo my flat" }).route).toBe("continue");
  });
  it("new enquiries continue (T01)", () => {
    expect(routeCall({ ...base, intent: "new_enquiry", utterance: "We have a 3BHK in Kothrud and want to redo the whole thing" }).route).toBe("continue");
  });
  it("vendor / wrong number -> close_other", () => {
    expect(routeCall({ ...base, intent: "other" }).route).toBe("close_other");
  });
  it("a frustrated prospect (T16) is NOT a complaint", () => {
    const r = routeCall({ ...base, intent: "new_enquiry", utterance: "I called on Monday about a project. Someone said they'd get back to me. It's been two days." });
    expect(r.route).toBe("continue");
  });
});
