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

/**
 * The first and last "[hh:mm:ss]" stamps of a real transcript, as UTC instants on the day of `ref` (the webhook's arrival). Used only when Vaani's call history,
 * which carries the real times, is unavailable. A stamp later than `ref` belongs to the previous day (a call that ran past midnight).
 */
export function transcriptSpan(raw: unknown, ref: Date): { start: Date; end: Date } | null {
  if (typeof raw !== "string") return null;
  const at = (hh: string, mm: string, ss: string) => {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), Number(hh), Number(mm), Number(ss)));
    return d.getTime() > ref.getTime() + 60_000 ? new Date(d.getTime() - 86_400_000) : d;
  };
  const stamps = [...raw.matchAll(/^\s*\[(\d\d):(\d\d):(\d\d)\]/gm)].map((m) => at(m[1]!, m[2]!, m[3]!));
  return stamps.length ? { start: stamps[0]!, end: stamps[stamps.length - 1]! } : null;
}
