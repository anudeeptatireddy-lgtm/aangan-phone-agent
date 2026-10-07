import { dashContext, type SP } from "../context";
import { designerStats } from "@/db/dash-calls";
import { Card, LoginScreen, Message, Shell, mins } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan phone agent: designers" };

export default async function Designers({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await dashContext(await searchParams);
  if (ctx.state === "unconfigured") return <Message title="Dashboard" body="Not configured: set DASHBOARD_TOKEN." />;
  if (ctx.state === "login") return <LoginScreen error={ctx.error} />;
  if (ctx.state === "nodb") return <Message title="Dashboard" body="No database is configured." />;
  const rows = await designerStats(ctx.db, ctx.q);
  const dash = <span className="muted">—</span>;
  const none = <span className="nodata">no data yet</span>;
  const anyConsult = rows.some((r) => r.consultations > 0 || r.quotes > 0 || r.wins > 0);
  return (
    <Shell ctx={ctx} page="designers" path="/dashboard/designers" title="Designers">
      <Card>
        <div className="scroll">
          <table className="tbl">
            <thead><tr><th>Designer</th><th className="right">Assigned</th><th className="right">Accepted</th><th className="right">Median time to accept</th><th className="right">Consultations</th><th className="right">Quotes</th><th className="right">Wins</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}><td><b>{r.name}</b></td><td className="right">{r.assigned}</td><td className="right">{r.accepted}{r.assigned ? <span className="muted small"> of {r.assigned}</span> : null}</td>
                  <td className="right">{r.medianAcceptWorkingMinutes == null ? dash : mins(r.medianAcceptWorkingMinutes)}</td>
                  <td className="right">{anyConsult ? r.consultations : none}</td><td className="right">{anyConsult ? r.quotes : none}</td><td className="right">{anyConsult ? r.wins : none}</td></tr>))}
              {rows.length === 0 && <tr><td colSpan={7} className="muted">No designers with bookings in this period.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">“Assigned” counts consultations booked in the period that belong to the designer now (after any reassignment). Time to accept is working minutes (Mon–Fri 10:00–19:00) from the note being sent. Consultations, quotes and wins come from the designers' updates in HubSpot.</p>
      </Card>
    </Shell>
  );
}
