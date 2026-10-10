/** Live or demo data for a dashboard page. An explicit ?data=live / ?data=demo wins. With no choice, a database that has fewer than 10 real calls (a few tests) and has demo data opens on the demo
 *  (so a first-time visitor does not land on an empty page); the demo banner still says it is made-up data, and the Live button still shows the real, empty view. */
export function chooseData(explicit: string | undefined, liveCalls: number, demoCalls: number): "live" | "demo" {
  if (explicit === "demo" || explicit === "live") return explicit;
  return liveCalls < 10 && demoCalls > 0 ? "demo" : "live";
}
