import type { CallTurn } from "./types";

// Hard rule 3: the FIRST thing the agent says must disclose that it is a virtual assistant AND that the call is recorded.
const VIRTUAL = /virtual\s+assistant|वर्चुअल\s*असिस्टेंट|व्हर्च्युअल\s*असिस्टंट|वर्चुअल\s*असिस्टन्ट/i;
const RECORDED = /record(ed|ing)?|रिकॉर्ड|रेकॉर्ड|रिकार्ड/i;

export type DisclosureResult = { ok: true } | { ok: false; missing: ("virtual_assistant" | "recording")[] };

export function checkDisclosure(turns: CallTurn[]): DisclosureResult {
  const first = turns.find((t) => t.speaker === "agent");
  if (!first) return { ok: false, missing: ["virtual_assistant", "recording"] };
  const missing: ("virtual_assistant" | "recording")[] = [];
  if (!VIRTUAL.test(first.text)) missing.push("virtual_assistant");
  if (!RECORDED.test(first.text)) missing.push("recording");
  return missing.length ? { ok: false, missing } : { ok: true };
}
