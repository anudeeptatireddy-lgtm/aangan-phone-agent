import { dashContext, carry, type SP } from "../context";
import { listCalls } from "@/db/dash-calls";
import { LoginScreen, Message, Pill, Shell, label, outcomeTone, when } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan phone agent: calls" };
const PAGE = 50;

export default async function Calls({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await dashContext(sp);
  if (ctx.state === "unconfigured") return <Message title="Dashboard" body="Not configured: set DASHBOARD_TOKEN." />;
  if (ctx.state === "login") return <LoginScreen error={ctx.error} />;
  if (ctx.state === "nodb") return <Message title="Dashboard" body="No database is configured." />;
  const page = Math.max(1, Number(sp.page) || 1);
  const f = { outcome: sp.outcome || undefined, fit: sp.fit || undefined, designerId: sp.designer || undefined, afterHours: sp.after === "yes" ? true : sp.after === "no" ? false : undefined, search: sp.q || undefined };
  const [r, designers] = await Promise.all([
    listCalls(ctx.db, { ...ctx.q, ...f, limit: PAGE, offset: (page - 1) * PAGE }),
    ctx.db.query("select id, name from designers where is_demo = $1 and (not coalesce(is_test, false) or $1) order by name", [ctx.demo]),
  ]);
  const keep = { outcome: f.outcome, fit: f.fit, designer: f.designerId, after: sp.after, q: f.search };
  const pages = Math.max(1, Math.ceil(r.total / PAGE));
  const api = new URLSearchParams({ from: ctx.from, to: ctx.to, format: "csv" }); // the export honours the same filters as the table
  if (ctx.demo) api.set("data", "demo");
  for (const [k, v] of Object.entries({ outcome: f.outcome, fit: f.fit, designerId: f.designerId, afterHours: f.afterHours === undefined ? undefined : String(f.afterHours), search: f.search })) if (v) api.set(k, v);
  const csv = `/api/dashboard/calls?${api}`;

  return (
    <Shell ctx={ctx} page="calls" path="/dashboard/calls" title="Calls">
      <form className="bar f" method="get" action="/dashboard/calls">
        <input type="hidden" name="from" value={ctx.from} /><input type="hidden" name="to" value={ctx.to} />{ctx.demo && <input type="hidden" name="data" value="demo" />}
        <label>Search<input name="q" defaultValue={sp.q ?? ""} placeholder="name, locality, number, call id" /></label>
        <label>Outcome<select name="outcome" defaultValue={sp.outcome ?? ""}><option value="">All</option>{["booked", "not_fit", "review", "escalated", "closed_other", "dropped", "missed"].map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></label>
        <label>Rules said<select name="fit" defaultValue={sp.fit ?? ""}><option value="">All</option><option value="fit">Fit</option><option value="not_fit">Not fit</option><option value="unclear">Unclear</option></select></label>
        <label>Designer<select name="designer" defaultValue={sp.designer ?? ""}><option value="">All</option>{designers.rows.map((d) => <option key={String(d.id)} value={String(d.id)}>{String(d.name)}</option>)}</select></label>
        <label>Time<select name="after" defaultValue={sp.after ?? ""}><option value="">Any</option><option value="yes">After hours</option><option value="no">In hours</option></select></label>
        <button className="btn" type="submit">Filter</button>
        <a className="btn ghost" href={csv} download>Export CSV</a>
      </form>
      <p className="muted small">{r.total} call{r.total === 1 ? "" : "s"}. Phone numbers are masked; open a call to reveal one (logged).</p>
      <div className="card scroll" style={{ padding: 4 }}>
        <table className="tbl">
          <thead><tr><th>Time</th><th>Caller</th><th>Phone</th><th>Locality</th><th>Scope</th><th>Outcome</th><th>Booking</th><th>Designer</th><th>Status</th></tr></thead>
          <tbody>
            {r.rows.map((c) => (
              <tr key={c.id}>
                <td><a href={`/dashboard/calls/${encodeURIComponent(c.id)}${carry(ctx)}`}>{when(c.rangAt)}</a>{c.afterHours ? <> <Pill tone="a">after hrs</Pill></> : null}</td>
                <td>{c.callerName ?? "—"}</td><td className="muted">{c.phoneMasked ?? "—"}</td><td>{c.locality ?? "—"}</td><td>{label(c.scope)}</td>
                <td><Pill tone={outcomeTone(c.outcome)}>{label(c.outcome)}</Pill></td>
                <td>{c.bookingStartsAt ? <>{when(c.bookingStartsAt)}</> : "—"}</td><td>{c.designer ?? "—"}</td><td>{label(c.status)}</td>
              </tr>))}
            {r.rows.length === 0 && <tr><td colSpan={9} className="muted">No calls match.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && <p className="small">Page {page} of {pages} {page > 1 && <a href={`/dashboard/calls${carry(ctx, { ...keep, page: String(page - 1) })}`}>‹ Newer</a>} {page < pages && <a href={`/dashboard/calls${carry(ctx, { ...keep, page: String(page + 1) })}`}>Older ›</a>}</p>}
    </Shell>
  );
}
