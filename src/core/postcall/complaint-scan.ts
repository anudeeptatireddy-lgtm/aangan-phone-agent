import { COMPLAINT_PATTERNS, DESIGNER_WORDS, Intent } from "../routing/route-call";
import type { CallTurn } from "./types";

export interface MissedComplaint { missed: boolean; evidence?: string }

/**
 * Post-call check for hard rule 4: did a complaint / existing-client call get qualified like a lead?
 * Uses the same deterministic patterns as live routing (plus the model's intent label), on the CALLER's words only.
 */
export function scanForMissedComplaint(i: { turns: CallTurn[]; escalated: boolean; intent?: Intent; designerNames?: string[] }): MissedComplaint {
  if (i.escalated) return { missed: false };
  // The caller's own words make the best evidence; fall back to the model's label when it was the only signal.
  let quote: string | undefined;
  for (const t of i.turns) {
    if (t.speaker !== "caller") continue;
    if (COMPLAINT_PATTERNS.some((p) => p.test(t.text)) ||
        (i.designerNames?.some((n) => new RegExp(`\\b${n}\\b`, "i").test(t.text)) && DESIGNER_WORDS.test(t.text))) { quote = t.text.slice(0, 200); break; }
  }
  const modelSays = i.intent === "complaint" || i.intent === "existing_client";
  if (quote) return { missed: true, evidence: modelSays ? `${quote} (model intent: ${i.intent})` : quote };
  if (modelSays) return { missed: true, evidence: `model intent: ${i.intent}` };
  return { missed: false };
}
