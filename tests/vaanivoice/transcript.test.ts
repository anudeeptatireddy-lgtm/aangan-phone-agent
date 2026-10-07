import { describe, it, expect } from "vitest";
import { parseTranscription } from "@/adapters/voice/vaanivoice/transcript";

describe("parseTranscription (Vaani call_details.transcription)", () => {
  it("splits AGENT:/USER: blocks into speaker turns", () => {
    const t = "AGENT: Hi! You've reached Aangan.\n\n USER: Hello. I have a 3BHK in Kothrud.\n\n AGENT: Great, how big is it?";
    expect(parseTranscription(t)).toEqual([
      { speaker: "agent", text: "Hi! You've reached Aangan." },
      { speaker: "caller", text: "Hello. I have a 3BHK in Kothrud." },
      { speaker: "agent", text: "Great, how big is it?" },
    ]);
  });
  it("keeps multi-line turns together and tolerates other casing and spacing", () => {
    const t = "agent : first line\nsecond line\n\nUser:  reply";
    expect(parseTranscription(t)).toEqual([{ speaker: "agent", text: "first line second line" }, { speaker: "caller", text: "reply" }]);
  });
  it("text before any label is attached to nothing and ignored; empty input gives no turns", () => {
    expect(parseTranscription("")).toEqual([]);
    expect(parseTranscription("Transcript is not available for further evaluations.")).toEqual([]);
  });
  it("a colon inside speech is not mistaken for a label", () => {
    expect(parseTranscription("AGENT: So that's: a 3BHK, right?\n\nUSER: Yes: exactly")).toEqual([
      { speaker: "agent", text: "So that's: a 3BHK, right?" }, { speaker: "caller", text: "Yes: exactly" }]);
  });
  it("accepts an already-structured array of turns (defensive)", () => {
    expect(parseTranscription([{ role: "assistant", content: "Hi" }, { role: "user", content: "Hello" }] as never)).toEqual([
      { speaker: "agent", text: "Hi" }, { speaker: "caller", text: "Hello" }]);
  });
});
