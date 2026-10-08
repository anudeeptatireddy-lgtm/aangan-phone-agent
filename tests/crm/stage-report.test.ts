import { describe, it, expect } from "vitest";
import { formatStageReport } from "@/core/crm/stage-report";

const stages = [
  { id: "100", label: "Enquiry", closed: false, probability: 0.1 }, { id: "101", label: "Consultation done", closed: false, probability: 0.3 }, { id: "102", label: "Quote sent", closed: false, probability: 0.6 },
  { id: "103", label: "Site measurement", closed: false, probability: 0.4 }, { id: "104", label: "Closed won", closed: true, probability: 1 }, { id: "105", label: "Closed lost", closed: true, probability: 0 }];

describe("hubspot:stages report", () => {
  it("with no pipeline chosen: lists the pipelines and says how to choose", () => {
    const t = formatStageReport({ pipelines: [{ id: "default", label: "Sales Pipeline" }, { id: "77", label: "Interiors" }], stages: [] });
    expect(t).toMatch(/default.*Sales Pipeline/); expect(t).toMatch(/77.*Interiors/); expect(t).toMatch(/HUBSPOT_PIPELINE_ID/);
  });
  it("with a pipeline: every stage with its id, label and what HubSpot itself says about it", () => {
    const t = formatStageReport({ pipelines: [{ id: "77", label: "Interiors" }], chosenPipelineId: "77", stages, startStageId: "100" });
    for (const s of stages) expect(t).toContain(s.id);
    expect(t).toMatch(/Closed won.*won \(HubSpot's own: no entry needed\)/); expect(t).toMatch(/Closed lost.*lost \(HubSpot's own: no entry needed\)/);
    expect(t).toMatch(/Enquiry.*new \(the start stage\)/);
  });
  it("suggests a map from the labels, clearly as a suggestion to check, and leaves out what it cannot tell", () => {
    const t = formatStageReport({ pipelines: [], chosenPipelineId: "77", stages, startStageId: "100" });
    expect(t).toMatch(/SUGGESTION/); expect(t).toContain('"101":"consult_held"'); expect(t).toContain('"102":"quote_sent"');
    expect(t).not.toContain('"103"');
    expect(t).toMatch(/103.*Site measurement.*not suggested/s);
  });
  it("says what is already set, and which stages are still missing from it", () => {
    const t = formatStageReport({ pipelines: [], chosenPipelineId: "77", stages, startStageId: "100", currentMap: '{"101":"consult_held"}' });
    expect(t).toMatch(/already set/i); expect(t).toMatch(/102.*Quote sent.*not mapped/); expect(t).toMatch(/103.*not mapped/);
  });
});
