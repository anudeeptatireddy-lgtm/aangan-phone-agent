// The go-live gate: replays the 20 September phone calls and the 10 hard cases through the real pipeline (on fakes) and FAILS (exit 1) if anything
// is wrong, above all if the scripted agent ever says a price-related number. Usage: pnpm replay   (writes docs/replay-report.md)
import { writeFileSync } from "node:fs";
import { renderMarkdown, runAll, summarise } from "../tests/replay/harness";

const results = await runAll();
const s = summarise(results);
const pad = (x: string, n: number) => (x.length > n ? x.slice(0, n - 1) + "…" : x.padEnd(n));
const line = (r: (typeof results)[number]) => `${r.ok ? "PASS" : "FAIL"}  ${pad(r.case.id, 4)} ${pad(r.case.title, 74)} ${pad(r.observed.fit ?? "-", 8)} ${pad(r.observed.outcome ?? "-", 9)} flags: ${r.observed.flags.join(",") || "none"}`;
for (const g of ["phone", "hard", "gate"] as const) {
  console.log(`\n${{ phone: "THE 20 SEPTEMBER PHONE CALLS", hard: "THE 10 HARD CASES", gate: "PRICE GATE SELF-TEST (planted violations must be caught)" }[g]}`);
  for (const r of results.filter((x) => x.case.group === g)) {
    console.log(line(r));
    for (const k of r.checks.filter((c) => !c.ok)) console.log(`        x ${k.name} (${k.detail ?? ""})`);
  }
}
console.log(`\n${s.pass ? "ALL PASS" : "FAILED"}: ${s.passed}/${s.cases} calls pass; the price gate caught ${s.gateCaught}/${s.gateChecks} planted violations; price numbers said by the scripted agent: ${s.priceLeaks.length}`);
writeFileSync("docs/replay-report.md", renderMarkdown(results, new Date().toISOString().slice(0, 10)));
process.exit(s.pass ? 0 : 1);
