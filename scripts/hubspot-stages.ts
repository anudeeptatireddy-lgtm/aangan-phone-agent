// pnpm hubspot:stages   (read-only) lists your HubSpot deal pipelines and stages with their ids, to fill in HUBSPOT_PIPELINE_ID, HUBSPOT_DEAL_STAGE_ID and HUBSPOT_STAGE_MAP.
// It reads no deals and prints no contact or deal data.
import { existsSync } from "node:fs";
import { HubSpotCrm } from "../src/adapters/crm/hubspot";
import { formatStageReport } from "../src/core/crm/stage-report";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const token = process.env.HUBSPOT_ACCESS_TOKEN;
if (!token) { console.error("HUBSPOT_ACCESS_TOKEN is not set."); process.exit(1); }
const crm = new HubSpotCrm({ token, pipelineId: process.env.HUBSPOT_PIPELINE_ID, dealStageId: process.env.HUBSPOT_DEAL_STAGE_ID });
try {
  const pipelines = await crm.dealPipelines();
  const chosen = process.env.HUBSPOT_PIPELINE_ID;
  const stages = chosen ? await crm.dealStages(chosen) : [];
  console.log(formatStageReport({ pipelines, chosenPipelineId: chosen, stages, startStageId: process.env.HUBSPOT_DEAL_STAGE_ID, currentMap: process.env.HUBSPOT_STAGE_MAP }));
} catch (e) {
  console.error(String((e as Error).message));
  if (/403|MISSING_SCOPES/.test(String((e as Error).message))) console.error("The HubSpot app is missing a permission. Add crm.schemas.deals.read, crm.objects.deals.read and crm.objects.deals.write under Development > Legacy apps > your app > Scopes, then run this again.");
  process.exitCode = 1;
}
