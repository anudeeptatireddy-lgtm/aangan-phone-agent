import { dashContext, carry, type SP } from "../context";
import { listCalls } from "@/db/dash-calls";
import { Empty, Outcome, Page, gateFor, periodTitle, plural, scopeName, when, weekdayDate, clock } from "../ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan: every call" };
const PAGE = 50;

export default async function Calls({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await dashContext(sp);
  if (ctx.state !== "ok") return gateFor(ctx);
  const page = Math.max(1, Number(sp.page) || 1);
  const f = { outcome: sp.outcome || undefined, fit: sp.fit || undefined, designerId: sp.designer || undefined, afterHours: sp.after === "yes" ? true : sp.after === "no" ? false : undefined, search: sp.q || undefined };
  const filtered = Object.values(f).some((v) => v !== undefined);
  const [r, designers] = await Promise.all([
    listCalls(ctx.db, { ...ctx.q, ...f, limit: PAGE, offset: (page - 1) * PAGE }),
    ctx.db.query("select id, name from designers where is_demo = $1 and (not coalesce(is_test, false) or $1) order by name", [ctx.demo]),
  ]);
  const keep = { outcome: f.outcome, fit: f.fit, designer: f.designerId, after: sp.after, q: f.search };
  const pages = Math.max(1, Math.ceil(r.total / PAGE));
  const api = new URLSearchParams({ from: ctx.from, to: ctx.to, format: "csv" }); // the export honours the same filters as the table
  if (ctx.demo) api.set("data", "demo");
  for (const [k, v] of Object.entries({ outcome: f.outcome, fit: f.fit, designerId: f.designerId, afterHours: f.afterHours === undefined ? undefined : String(f.afterHours), search: f.search })) if (v) api.set(k, v);
  const period = periodTitle(ctx.from, ctx.to);

  return (
    <Page ctx={ctx} page="calls" path="/dashboard/calls">
      <div className="head" style={{ paddingBottom: 4 }}>
        <div className="eyebrow">{period}</div>
        <h1>Every call</h1>
        <p className="lead" style={{ marginBottom: 0 }}>{plural(r.total, "call")}{filtered ? " match" + (r.total === 1 ? "es" : "") + " these filters" : ""}. Phone numbers are hidden; open a call to see one (each look is logged). ☾ marks a call after hours: evenings, nights and weekends. <a href={`/api/dashboard/calls?${api}`} download>Download as a spreadsheet (CSV)</a></p>
      </div>
      <form className="filters" method="get" action="/dashboard/calls">
        <input type="hidden" name="from" value={ctx.from} /><input type="hidden" name="to" value={ctx.to} />{ctx.demo && <input type="hidden" name="data" value="demo" />}
        <label>Search<input name="q" defaultValue={sp.q ?? ""} placeholder="name, area, number, call id" style={{ width: 230 }} /></label>
        <label>What happened<select name="outcome" defaultValue={sp.outcome ?? ""}><option value="">Anything</option>{["booked", "not_fit", "review", "escalated", "closed_other", "dropped", "missed"].map((o) => <option key={o} value={o}>{({ booked: "Booked", not_fit: "Not a fit", review: "Needs a person", escalated: "Passed to a person", closed_other: "Not an enquiry", dropped: "Call dropped", missed: "Missed" } as Record<string, string>)[o]}</option>)}</select></label>
        <label>The rules said<select name="fit" defaultValue={sp.fit ?? ""}><option value="">Anything</option><option value="fit">Fit</option><option value="not_fit">Not a fit</option><option value="unclear">Unclear</option></select></label>
        <label>Designer<select name="designer" defaultValue={sp.designer ?? ""}><option value="">Anyone</option>{designers.rows.map((d) => <option key={String(d.id)} value={String(d.id)}>{String(d.name)}</option>)}</select></label>
        <label>Time<select name="after" defaultValue={sp.after ?? ""}><option value="">Any time</option><option value="yes">After hours</option><option value="no">Working hours</option></select></label>
        <button className="btn" type="submit">Show</button>
        {filtered && <a href={`/dashboard/calls${carry(ctx)}`} className="muted">Clear filters</a>}
      </form>
      {r.rows.length === 0 ? <Empty><b>{filtered ? "No calls match these filters." : `No calls in ${period}.`}</b> {filtered ? "Clear the filters, or widen the dates at the top right." : "Try “Last 30 days” from the dates at the top right, or press Demo to see sample calls."}</Empty> : (
        <table className="tbl calls">
          <thead><tr><th scope="col">When</th><th scope="col">Caller</th><th scope="col">Phone</th><th scope="col">Area</th><th scope="col">Wanted</th><th scope="col">What happened</th><th scope="col">With</th></tr></thead>
          <tbody>
            {r.rows.map((c) => (
              <tr key={c.id}>
                <td className="num" style={{ whiteSpace: "nowrap" }}><a href={`/dashboard/calls/${encodeURIComponent(c.id)}${carry(ctx)}`}>{when(c.rangAt)}</a>{c.afterHours ? <span className="moon" title="After hours">☾<span className="vh"> after hours</span></span> : null}</td>
                <td>{c.callerName ?? <span className="muted">no name</span>}</td>
                <td className="muted phone num">{c.phoneMasked ?? "—"}</td>
                <td>{c.locality ?? <span className="muted">—</span>}</td>
                <td>{scopeName(c.scope)}</td>
                <td><Outcome o={c.outcome} extra={c.bookingStartsAt ? `for ${weekdayDate(c.bookingStartsAt)}, ${clock(c.bookingStartsAt)}` : undefined} /></td>
                <td>{c.designer ?? <span className="muted">—</span>}</td>
              </tr>))}
          </tbody>
        </table>
      )}
      {pages > 1 && <div className="pager small"><span>Page {page} of {pages}</span>{page > 1 && <a href={`/dashboard/calls${carry(ctx, { ...keep, page: String(page - 1) })}`}>‹ Newer</a>}{page < pages && <a href={`/dashboard/calls${carry(ctx, { ...keep, page: String(page + 1) })}`}>Older ›</a>}</div>}
    </Page>
  );
}
