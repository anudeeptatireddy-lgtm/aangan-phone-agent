import type { CallTurn } from "@/core/postcall/types";

// call_details.transcription is a string of "AGENT: ...\n\n USER: ..." blocks (docs.vaanivoice.ai, call-details example).
const LABEL = /^\s*(agent|user|caller)\s*:\s*/i;

export function parseTranscription(raw: unknown): CallTurn[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((x: { role?: string; speaker?: string; content?: string; text?: string }) => {
      const who = String(x.role ?? x.speaker ?? "").toLowerCase();
      const text = String(x.content ?? x.text ?? "").trim();
      if (!text) return [];
      return [{ speaker: who === "user" || who === "caller" ? ("caller" as const) : ("agent" as const), text }];
    });
  }
  if (typeof raw !== "string") return [];
  const turns: CallTurn[] = [];
  for (const block of raw.split(/\n\s*\n/)) {
    const m = LABEL.exec(block);
    if (m) turns.push({ speaker: m[1]!.toLowerCase() === "agent" ? "agent" : "caller", text: block.slice(m[0].length).replace(/\s*\n\s*/g, " ").trim() });
    else if (turns.length) turns[turns.length - 1]!.text += ` ${block.replace(/\s*\n\s*/g, " ").trim()}`; // a paragraph break inside a turn
  }
  return turns.filter((t) => t.text);
}
