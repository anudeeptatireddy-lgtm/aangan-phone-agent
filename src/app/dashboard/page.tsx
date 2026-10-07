import { cookies } from "next/headers";
import { dashboardAuthorized, summaryFor } from "@/server/handlers/dashboard";
import { getDeps } from "@/server/deps";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const LABEL: Record<string, string> = { booked: "Booked", escalated: "Sent to a person", not_fit: "Not a fit", review: "Needs review", dropped: "Dropped", unprocessed: "Not yet processed" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ days?: string; error?: string }> }) {
  const deps = getDeps();
  const sp = await searchParams;
  const token = deps.env.DASHBOARD_TOKEN;
  const jar = await cookies();
  const authed = !!token && dashboardAuthorized(new Request("http://x", { headers: { cookie: `dash=${jar.get("dash")?.value ?? ""}` } }), token);

  if (!token) return <main style={page}><h1>Dashboard</h1><p>Not configured: set DASHBOARD_TOKEN.</p></main>;
  if (!authed) return (
    <main style={page}>
      <h1>Aangan phone agent</h1>
      <form method="post" action="/api/dashboard/login" style={{ display: "flex", gap: 8 }}>
        <input name="token" type="password" placeholder="Dashboard token" autoComplete="current-password" style={{ padding: 8, flex: 1 }} />
        <button type="submit" style={{ padding: "8px 16px" }}>Open</button>
      </form>
      {sp.error && <p style={{ color: "#b00020" }}>That token did not match.</p>}
    </main>
  );

  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const s = await summaryFor(deps, days);
  const maxCalls = Math.max(1, ...s.daily.map((d) => d.calls));
  return (
    <main style={page}>
      <h1>Aangan phone agent</h1>
      <p>{[7, 30, 90].map((d) => <a key={d} href={`/dashboard?days=${d}`} style={{ marginRight: 12, fontWeight: d === days ? 700 : 400 }}>Last {d} days</a>)}</p>

      <section style={grid}>
        <Stat label="Calls" value={String(s.totals.calls)} sub={`${s.totals.afterHours} after hours`} />
        <Stat label="Booked" value={String(s.outcomes.booked)} sub={`${pct(s.rates.booked)} of calls`} />
        <Stat label="Total cost" value={inr(s.cost.totalInr)} sub={`${inr(s.cost.perCallInr)} per call`} />
        <Stat label="Cost per booking" value={s.cost.perBookingInr === null ? "n/a" : inr(s.cost.perBookingInr)} sub={`${s.totals.totalMinutes} minutes talked`} />
      </section>
      {s.cost.unpricedCalls ? <p style={warn}>{s.cost.unpricedCalls} call(s) have no cost recorded yet, so the totals are understated.</p> : null}
      {(s.attention.extractionFailed > 0 || Object.keys(s.attention.openFlags).length > 0) && (
        <p style={warn}>Needs attention: {s.attention.extractionFailed ? `${s.attention.extractionFailed} call(s) not processed; ` : ""}{Object.entries(s.attention.openFlags).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(", ")}</p>
      )}

      <h2>What happened to the calls</h2>
      <table style={table}><tbody>{Object.entries(s.outcomes).filter(([, v]) => v > 0).map(([k, v]) => <tr key={k}><td>{LABEL[k] ?? k}</td><td style={num}>{v}</td></tr>)}</tbody></table>

      <h2>Designer handoffs</h2>
      <table style={table}><tbody>{Object.entries(s.handoffs).filter(([, v]) => v > 0).map(([k, v]) => <tr key={k}><td>{k.replace("_", " ")}</td><td style={num}>{v}</td></tr>)}
        <tr><td><b>Accepted</b></td><td style={num}><b>{pct(s.rates.handoffAccepted)}</b></td></tr></tbody></table>

      <h2>Calls per day</h2>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 100 }} role="img" aria-label="Calls per day">
        {s.daily.map((d) => <div key={d.date} title={`${d.date}: ${d.calls} calls, ${d.booked} booked, ${inr(d.costInr)}`} style={{ flex: 1, minWidth: 2, height: `${(d.calls / maxCalls) * 100}%`, background: d.calls ? "#2d6a4f" : "#ddd" }} />)}
      </div>
      <p style={{ color: "#666", fontSize: 13 }}>Counts only. No caller names, numbers or emails are shown here.</p>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}><div style={{ color: "#666", fontSize: 13 }}>{label}</div><div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div><div style={{ color: "#666", fontSize: 13 }}>{sub}</div></div>;
}
const page = { fontFamily: "system-ui", padding: 24, maxWidth: 860, margin: "0 auto" } as const;
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 } as const;
const table = { borderCollapse: "collapse", width: "100%" } as const;
const num = { textAlign: "right" } as const;
const warn = { background: "#fff3cd", padding: 10, borderRadius: 6 } as const;
