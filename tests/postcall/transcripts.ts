import { readFileSync } from "node:fs";
import type { CallTurn } from "@/core/postcall/types";

// Parses docs/enquiries/<id>.md into turns. 'Front Desk' = the agent; everyone else = the caller. Wrapped lines are joined;
// bracketed annotations, 'Note:' / 'Status:' lines and headings are dropped. Handles the phone ("Front Desk: ...") and
// WhatsApp ("3 Sept, 7:14pm — Kiran Mazumdar: ...") layouts.
const START = /^(?:\d{1,2} \w+, [^—]*— )?(Front Desk|Caller|Unknown number|[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)(?: \([^)]*\))?:\s*(.*)$/;
const ANNOTATION = /^(\[|Note:|Status:|First call|Second call|Missed call|#|Phone ·|WhatsApp ·|Web Form ·)/;

export function loadTurns(id: string): CallTurn[] {
  const turns: CallTurn[] = [];
  let cur: CallTurn | null = null;
  for (const raw of readFileSync(`docs/enquiries/${id}.md`, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line) { cur = null; continue; }
    if (ANNOTATION.test(line)) { cur = null; continue; }
    const m = START.exec(line);
    if (m && !/^(Name|Phone|Email|Project type|Location)$/.test(m[1]!)) {
      cur = { speaker: m[1] === "Front Desk" ? "agent" : "caller", text: m[2]!.replace(/\(gives number\)/, "").trim() };
      turns.push(cur);
    } else if (cur) cur.text += " " + line;
  }
  return turns;
}

export const agentText = (id: string) => loadTurns(id).filter((t) => t.speaker === "agent").map((t) => t.text).join("\n");
export const callerText = (id: string) => loadTurns(id).filter((t) => t.speaker === "caller").map((t) => t.text).join("\n");
