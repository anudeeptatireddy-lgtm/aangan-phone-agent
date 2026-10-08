import { dashContext, type SP } from "../context";
import { designerStats } from "@/db/dash-calls";
import { Empty, Page, gateFor, mins, periodTitle } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan: designers" };
const SLA_MIN = 30; // a designer has 30 working minutes to accept

export default async function Designers({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await dashContext(await searchParams);
  if (ctx.state !== "ok") return gateFor(ctx);
  const rows = await designerStats(ctx.db, ctx.q);
  const anyProgress = rows.some((r) => r.consultations > 0 || r.quotes > 0 || r.wins > 0);
  const none = <span className="muted">no data yet</span>;
  return (
    <Page ctx={ctx} page="designers" path="/dashboard/designers">
      <div className="head">
        <div className="eyebrow">{periodTitle(ctx.from, ctx.to)}</div>
        <h1>How each designer is doing</h1>
        <p className="lead">Consultations given to each designer, how quickly they accepted, and what came of them. A designer has {SLA_MIN} working minutes to accept before it moves to the next.</p>
      </div>
      {rows.length === 0 ? <Empty><b>No consultation was booked in this period.</b> Designers appear here once a booked call is given to them. Try “Last 30 days”{ctx.demo ? "." : ", or press Demo to see sample designers."}</Empty> : (
        <table className="tbl">
          <thead><tr><th scope="col">Designer</th><th scope="col" className="right">Given</th><th scope="col" className="right">Accepted</th><th scope="col" className="after-bar">Typical time to accept (working minutes)</th><th scope="col" className="right">Consultations held</th><th scope="col" className="right">Quotes sent</th><th scope="col" className="right">Won</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.name}</th>
                <td className="right num">{r.assigned}</td>
                <td className="right num">{r.accepted}{r.assigned ? <span className="muted"> of {r.assigned}</span> : null}</td>
                <td className="num after-bar">{r.medianAcceptWorkingMinutes == null ? <span className="muted">—</span> : <><span className={`mini${r.medianAcceptWorkingMinutes > SLA_MIN ? " over" : ""}`} style={{ width: Math.max(4, Math.min(160, (r.medianAcceptWorkingMinutes / SLA_MIN) * 100)) }} />{mins(r.medianAcceptWorkingMinutes)}</>}</td>
                <td className="right num">{anyProgress ? r.consultations : none}</td><td className="right num">{anyProgress ? r.quotes : none}</td><td className="right num">{anyProgress ? r.wins : none}</td>
              </tr>))}
          </tbody>
        </table>
      )}
      <p className="muted small" style={{ marginTop: 18 }}>“Given” counts consultations that belong to the designer now, after any reassignment. The bar is drawn against the {SLA_MIN}-minute limit. Consultations held, quotes and wins come from the designers' own updates in HubSpot{anyProgress ? "." : ", which have not arrived yet."}</p>
    </Page>
  );
}
