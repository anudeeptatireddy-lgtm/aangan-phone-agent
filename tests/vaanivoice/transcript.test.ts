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

describe("the real Vaani transcript format (seen on the first live call): a [hh:mm:ss] stamp on every line, one turn per line", () => {
  const raw = "[09:48:43] AGENT: Namaste, Aangan Studio. I am Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?\n[09:48:51] USER: Hi. I have a three BHK in about 1,400 square feet.\n[09:48:53] USER: The design, and the execution.\n[09:48:59] AGENT: Where in Pune is your home located?\n[09:49:27] AGENT: \n[09:49:30] USER: Kutrad.";
  it("parses every turn with the right speaker and drops the stamps and empty turns", () => {
    const t = parseTranscription(raw);
    expect(t.map((x) => x.speaker)).toEqual(["agent", "caller", "caller", "agent", "caller"]);
    expect(t[0]!.text).toMatch(/^Namaste, Aangan Studio\./);
    expect(t[1]!.text).toBe("Hi. I have a three BHK in about 1,400 square feet.");
    expect(t.some((x) => /\[\d\d:/.test(x.text))).toBe(false);
  });
  it("a continuation line without a speaker joins the turn before it", () => {
    expect(parseTranscription("[09:00:00] USER: first line\nsecond line\n[09:00:05] AGENT: ok").map((x) => x.text)).toEqual(["first line second line", "ok"]);
  });
});
