import { describe, it, expect } from "vitest";
import { mapStage, parseStageMap, CRM_STAGES } from "@/core/crm/stage-sync";
import { getEnv } from "@/lib/env";

const info = (o: Partial<{ id: string; label: string; closed: boolean | null; probability: number | null }> = {}) => ({ id: "s", label: "Some stage", closed: false, probability: 0.2, ...o });
const BASE = { PHONE_HASH_PEPPER: "pepper-0123456789ab", TOOL_SHARED_SECRET: "tool-secret-0123456789" };

describe("mapStage: which of OUR six stages a HubSpot stage is", () => {
  it("the studio's own mapping always wins", () => {
    expect(mapStage({ stageId: "101", info: info(), map: { "101": "quote_sent" }, startStageId: "100" })).toBe("quote_sent");
    expect(mapStage({ stageId: "101", info: info({ probability: 1, closed: true }), map: { "101": "quote_sent" } })).toBe("quote_sent"); // even over 'closed won'
  });
  it("closed stages map by HubSpot's own probability: 1.0 is won, 0.0 is lost, with no configuration", () => {
    expect(mapStage({ stageId: "w", info: info({ closed: true, probability: 1 }), map: {} })).toBe("won");
    expect(mapStage({ stageId: "l", info: info({ closed: true, probability: 0 }), map: {} })).toBe("lost");
  });
  it("the stage new deals start in is 'new'", () => {
    expect(mapStage({ stageId: "100", info: info(), map: {}, startStageId: "100" })).toBe("new");
  });
  it("anything else is unknown (null): the sync keeps the stage it had and the owner is told", () => {
    expect(mapStage({ stageId: "x", info: info(), map: {}, startStageId: "100" })).toBeNull();
    expect(mapStage({ stageId: "x", info: undefined, map: {} })).toBeNull();
    expect(mapStage({ stageId: "c", info: info({ closed: true, probability: 0.5 }), map: {} })).toBeNull(); // closed but neither won nor lost: do not guess
    expect(mapStage({ stageId: null, map: {} })).toBeNull();
  });
});

describe("HUBSPOT_STAGE_MAP", () => {
  it("is a JSON object of stage id -> one of our six stages", () => {
    expect(parseStageMap(undefined)).toEqual({});
    expect(parseStageMap("")).toEqual({});
    expect(parseStageMap('{"101":"consult_held","102":"quote_sent"}')).toEqual({ "101": "consult_held", "102": "quote_sent" });
    expect(CRM_STAGES).toEqual(["new", "consult_booked", "consult_held", "quote_sent", "won", "lost"]);
  });
  it("anything else is refused with a message naming what is wrong (never a value)", () => {
    expect(() => parseStageMap("{nope")).toThrow(/HUBSPOT_STAGE_MAP.*JSON/);
    expect(() => parseStageMap('["a"]')).toThrow(/object/);
    expect(() => parseStageMap('{"101":"negotiating"}')).toThrow(/101.*new, consult_booked, consult_held, quote_sent, won, lost/);
  });
  it("a bad map stops the app at boot, so a silently empty funnel cannot happen", () => {
    expect(() => getEnv({ ...BASE, HUBSPOT_STAGE_MAP: "{nope" })).toThrow(/HUBSPOT_STAGE_MAP/);
    expect(getEnv({ ...BASE, HUBSPOT_STAGE_MAP: '{"1":"won"}' }).HUBSPOT_STAGE_MAP).toBe('{"1":"won"}');
  });
});
