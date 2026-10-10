import type { CallTurn } from "@/core/postcall/types";

// call_details.transcription is a string of "AGENT: ...\n\n USER: ..." blocks (docs.vaanivoice.ai, call-details example).
const LABEL = /^\s*(?:\[[^\]]*\]\s*)?(agent|user|caller)\s*:[ \t]*/i;

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
  // Real calls (seen live): one turn per line, each stamped "[09:48:51] USER: ...". The docs example has blank-line separated "AGENT: ..." blocks. Both read the same way here.
  const turns: CallTurn[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = LABEL.exec(line);
    if (m) turns.push({ speaker: m[1]!.toLowerCase() === "agent" ? "agent" : "caller", text: line.slice(m[0].length).trim() });
    else if (line.trim() && turns.length) turns[turns.length - 1]!.text += ` ${line.trim()}`; // a line without a speaker continues the turn before it
  }
  return turns.filter((t) => t.text);
}
