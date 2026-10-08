import type { StageInfo } from "../ports";
import { parseStageMap, type StageMap } from "./stage-sync";

const SUGGEST: [RegExp, string][] = [[/consult|meeting|site visit|visit done/i, "consult_held"], [/quote|proposal|estimate|quotation/i, "quote_sent"]];

/** The text `pnpm hubspot:stages` prints: stages with their ids, what HubSpot itself says, and a map to start from. Pure. */
export function formatStageReport(i: { pipelines: { id: string; label: string }[]; chosenPipelineId?: string; stages: StageInfo[]; startStageId?: string; currentMap?: string }): string {
  const out: string[] = [];
  out.push("Deal pipelines in this HubSpot account:", ...i.pipelines.map((p) => `  ${p.id}   ${p.label}${p.id === i.chosenPipelineId ? "   <- HUBSPOT_PIPELINE_ID" : ""}`));
  if (!i.chosenPipelineId) { out.push("", "Set HUBSPOT_PIPELINE_ID to one of the ids above (in .env.local and in Vercel), then run this again to see its stages."); return out.join("\n"); }

  let map: StageMap = {};
  try { map = parseStageMap(i.currentMap); } catch { /* shown below */ }
  const known = (s: StageInfo): string | null => (map[s.id] ? `${map[s.id]} (set in HUBSPOT_STAGE_MAP)` : s.closed && s.probability === 1 ? "won (HubSpot's own: no entry needed)" : s.closed && s.probability === 0 ? "lost (HubSpot's own: no entry needed)" : s.id === i.startStageId ? "new (the start stage)" : null);
  out.push("", `Stages of pipeline ${i.chosenPipelineId} (id, name, what the dashboard will treat it as):`);
  for (const s of i.stages) out.push(`  ${s.id}   ${s.label}   ->   ${known(s) ?? "not mapped"}`);

  const suggestion: StageMap = {};
  const unsuggested: StageInfo[] = [];
  for (const s of i.stages) {
    if (known(s)) continue;
    const m = SUGGEST.find(([re]) => re.test(s.label));
    if (m) suggestion[s.id] = m[1] as StageMap[string]; else unsuggested.push(s);
  }
  if (i.currentMap?.trim()) out.push("", `HUBSPOT_STAGE_MAP is already set: ${i.currentMap.trim()}`);
  const open = i.stages.filter((s) => !known(s));
  if (open.length) {
    out.push("", "SUGGESTION from the stage names (check every line; only you know what your stages mean):");
    out.push(`  HUBSPOT_STAGE_MAP='${JSON.stringify({ ...map, ...suggestion })}'`);
    for (const s of unsuggested) out.push(`  ${s.id}   ${s.label}: not suggested (the name does not say). Choose one of: consult_booked, consult_held, quote_sent, or leave it out.`);
    out.push("", "Meanings: consult_held = the consultation has happened; quote_sent = the designer has sent a quote. Closed won / closed lost need no entry.");
  } else out.push("", "Every stage is covered.");
  return out.join("\n");
}
