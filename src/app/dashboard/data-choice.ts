/** Live or demo data for a dashboard page. An explicit ?data=live / ?data=demo wins. With no choice, a database that has no real calls yet but has demo data opens on the demo
 *  (so a first-time visitor does not land on an empty page); the demo banner still says it is made-up data, and the Live button still shows the real, empty view. */
export function chooseData(explicit: string | undefined, liveCalls: number, demoCalls: number): "live" | "demo" {
  if (explicit === "demo" || explicit === "live") return explicit;
  return liveCalls === 0 && demoCalls > 0 ? "demo" : "live";
}
