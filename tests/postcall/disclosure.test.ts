import { describe, it, expect } from "vitest";
import { checkDisclosure } from "@/core/postcall/disclosure";
import { SCRIPTS } from "@/core/scripts";
import type { CallTurn } from "@/core/postcall/types";

const t = (speaker: CallTurn["speaker"], text: string): CallTurn => ({ speaker, text });
const OPEN = "Namaste, Aangan Studio. I'm Aangan's virtual assistant, and this call is recorded so our designers have your details. How can I help?";

describe("disclosure check (hard rule 3)", () => {
  it("passes the approved opening", () => expect(checkDisclosure([t("agent", OPEN), t("caller", "Hi")])).toEqual({ ok: true }));
  it("Hindi and Marathi openings", () => {
    expect(checkDisclosure([t("agent", "नमस्ते, आंगन स्टूडियो। मैं आंगन की वर्चुअल असिस्टेंट हूँ और यह कॉल रिकॉर्ड की जा रही है।")]).ok).toBe(true);
    expect(checkDisclosure([t("agent", "नमस्कार, आंगन स्टुडिओ. मी व्हर्च्युअल असिस्टंट आहे आणि हा कॉल रेकॉर्ड होत आहे.")]).ok).toBe(true);
  });
  it("fails when the first agent line omits either part", () => {
    expect(checkDisclosure([t("agent", "Namaste, Aangan Studio. How can I help?")])).toMatchObject({ ok: false });
    expect(checkDisclosure([t("agent", "Hi, I'm Aangan's virtual assistant. How can I help?")])).toMatchObject({ ok: false, missing: ["recording"] });
    expect(checkDisclosure([t("agent", "Namaste, this call is recorded. How can I help?")])).toMatchObject({ ok: false, missing: ["virtual_assistant"] });
  });
  it("only the FIRST agent line counts (disclosure 'at the start')", () => {
    expect(checkDisclosure([t("agent", "Hello?"), t("caller", "Hi"), t("agent", OPEN)]).ok).toBe(false);
  });
  it("a caller speaking first is fine; no agent line at all fails", () => {
    expect(checkDisclosure([t("caller", "Hello?"), t("agent", OPEN)]).ok).toBe(true);
    expect(checkDisclosure([t("caller", "Hello?")])).toMatchObject({ ok: false });
    expect(checkDisclosure([])).toMatchObject({ ok: false });
  });
  it("the opening line in agent/prompt.md satisfies it", async () => {
    const { readFileSync } = await import("node:fs");
    const m = /"(Namaste, Aangan Studio\.[^"]+)"/.exec(readFileSync("agent/prompt.md", "utf8"));
    expect(checkDisclosure([t("agent", m![1]!)]).ok).toBe(true);
    expect(SCRIPTS.robot_confirm.en.text).toMatch(/virtual assistant/i);
  });
});
