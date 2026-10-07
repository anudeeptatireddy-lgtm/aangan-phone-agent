import { dashContext, type SP } from "./context";
import { overview } from "@/db/dash-metrics";
import { Card, DailyChart, FunnelChart, HBars, HourChart, LoginScreen, Message, Shell, Tile, inr, inrShort, label, mins, pct } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan phone agent: overview" };

export default async function Overview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await dashContext(await searchParams);
  if (ctx.state === "unconfigured") return <Message title="Dashboard" body="Not configured: set DASHBOARD_TOKEN." />;
  if (ctx.state === "login") return <LoginScreen error={ctx.error} />;
  if (ctx.state === "nodb") return <Message title="Dashboard" body="No database is configured. Set LOCAL_DB_DIR (local) or DATABASE_URL (Supabase); the dashboard reads Postgres only." />;
  const o = await overview(ctx.db, ctx.q);
  const k = o.kpis, sp = o.speed, c = o.cost;
  const leak = k.priceLeaks > 0;
  const outcomeRows = [
    { key: "fit", count: o.outcomes.fit }, { key: "not_fit", count: o.outcomes.notFit.total }, { key: "unclear", count: o.outcomes.unclear },
    { key: "complaint", count: o.outcomes.complaint }, { key: "other", count: o.outcomes.other }, { key: "missed", count: o.outcomes.missed }, { key: "dropped", count: o.outcomes.dropped }].filter((r) => r.count > 0);

  return (
    <Shell ctx={ctx} page="overview" path="/dashboard" title="Aangan phone agent">
      <div className="grid" aria-label="Key numbers">
        <Tile k="Calls" v={String(k.calls)} s={`${o.breakdowns.afterHoursShare == null ? "0" : pct(o.breakdowns.afterHoursShare)} after hours`} />
        <Tile k="Qualified" v={String(k.qualified)} s="fit under the rules" />
        <Tile k="Booked" v={String(k.booked)} s="on the call" tone="good" />
        <Tile k="Pushed" v={String(k.pushed)} s="to a designer" />
        <Tile k="Quoted" v={String(k.quoted)} nodata={k.quoted === null} s="by the designer" />
        <Tile k="Won" v={String(k.won)} nodata={k.won === null} s="deals" />
        <Tile k="Cost per booked consultation" v={k.costPerBookedInr == null ? "n/a" : inr(k.costPerBookedInr)} s={`${inr(c.totalInr)} total`} />
        <Tile k="Price leaks" v={String(k.priceLeaks)} tone={leak ? "bad" : "good"} s={leak ? "the agent said a price: open the calls" : "target 0"} />
      </div>

      <div className="sec"><Card title="From call to won">
        <FunnelChart stages={o.funnel.stages} />
        <p className="muted small">The percentage on the right is each step as a share of the step above it. Calls and answered are counted in calls; every later step in enquiries that came from those calls. {o.funnel.stages.some((s) => !s.hasData) && "Steps marked no data yet have no source until designers' consultations and quotes reach HubSpot."}</p>
      </Card></div>

      <div className="sec grid2">
        <Card title="Calls per day"><DailyChart days={o.daily} /></Card>
        <Card title="What happened to the calls">
          <HBars rows={outcomeRows.map((r) => ({ key: r.key, count: r.count }))} empty="No calls in this period." />
          {o.outcomes.notFit.byReason.length > 0 && <><h3>Not a fit, by reason</h3><HBars rows={o.outcomes.notFit.byReason.map((r) => ({ key: r.reason, count: r.count }))} /></>}
        </Card>
      </div>

      <div className="sec grid2">
        <Card title="Cost of running the agent">
          <table className="tbl"><tbody>
            {c.byLine.map((l) => <tr key={l.line}><td>{l.label}</td><td className="right">{inr(l.amountInr)}</td></tr>)}
            {c.byLine.length === 0 && <tr><td className="muted">No spend recorded in this period.</td><td /></tr>}
            <tr><td><b>Total</b></td><td className="right"><b>{inr(c.totalInr)}</b></td></tr>
            <tr><td>Per call</td><td className="right">{inr(c.perCallInr)}</td></tr>
            <tr><td>Per booked consultation</td><td className="right">{inr(c.perBookedConsultationInr)}</td></tr>
          </tbody></table>
          <p className="muted small">Voice minutes are an estimate at the dashboard rate. Fixed fees (phone number, hosting) are entered by hand.</p>
        </Card>
        <Card title="Speed">
          <table className="tbl"><tbody>
            <tr><td>Median time to answer</td><td className="right">{sp.medianAnswerSeconds == null ? "n/a" : `${sp.medianAnswerSeconds} s`}</td></tr>
            <tr><td>Answered within an hour</td><td className="right">{pct(sp.pctAnsweredUnder1h)}</td></tr>
            <tr><td>Median hand-off to designer accept</td><td className="right">{mins(sp.medianAcceptWorkingMinutes)} <span className="muted small">working</span></td></tr>
            <tr><td className="muted small">same, wall-clock</td><td className="right muted small">{mins(sp.medianAcceptMinutes)}</td></tr>
          </tbody></table>
        </Card>
      </div>

      <div className="sec grid2">
        <Card title="Price">
          <table className="tbl"><tbody>
            <tr><td>Callers who asked about price</td><td className="right">{o.price.askedCount}</td></tr>
            <tr><td>Agent price mentions <span className="muted small">(target 0)</span></td><td className="right" style={{ color: leak ? "var(--red)" : undefined, fontWeight: 700 }}>{o.price.agentPriceFlags}</td></tr>
          </tbody></table>
        </Card>
        <Card title="Escalations">
          <table className="tbl"><tbody>
            <tr><td>Complaints</td><td className="right">{o.escalations.complaints}</td></tr>
            <tr><td>Closed within 15 minutes</td><td className="right">{o.escalations.hasResolutionData ? pct(o.escalations.pctClosedWithin15Min) : <span className="nodata">no data yet</span>}</td></tr>
          </tbody></table>
        </Card>
      </div>

      <div className="sec grid2">
        <Card title="Booking router health">
          <table className="tbl"><tbody>
            <tr><td>Bookings matched to a call</td><td className="right">{o.router.matched}</td></tr>
            <tr><td>Ambiguous (a person links it)</td><td className="right">{o.router.ambiguous}</td></tr>
            <tr><td>Agent said booked, no booking found</td><td className="right" style={{ color: o.router.claimedButNoBooking ? "var(--red)" : undefined, fontWeight: o.router.claimedButNoBooking ? 700 : 400 }}>{o.router.claimedButNoBooking}</td></tr>
            <tr><td>Booking with no call</td><td className="right">{o.router.bookingWithoutCall}</td></tr>
          </tbody></table>
        </Card>
        <Card title="Pipeline from agent-sourced calls">
          {o.pipeline.hasData ? (
            <table className="tbl"><tbody>
              <tr><td>Won ({o.pipeline.wonCount})</td><td className="right">{inrShort(o.pipeline.wonValueInr)}</td></tr>
              <tr><td>Quoted, open ({o.pipeline.quotedCount})</td><td className="right">{inrShort(o.pipeline.quotedValueInr)}</td></tr>
              <tr><td><b>Total</b></td><td className="right"><b>{inrShort(o.pipeline.totalValueInr)}</b></td></tr>
            </tbody></table>
          ) : <p className="nodata">No deal values have reached HubSpot yet.</p>}
          <p className="muted small">Deal values are what the designers enter in HubSpot. The agent never sees or says them.</p>
        </Card>
      </div>

      <div className="sec grid2">
        <Card title="By locality"><HBars rows={o.breakdowns.locality.map((r) => ({ key: r.key, count: r.count, extra: `${r.booked} booked` }))} /></Card>
        <Card title="By project type"><HBars rows={o.breakdowns.projectType.map((r) => ({ key: r.key, count: r.count, extra: `${r.booked} booked` }))} /></Card>
        <Card title="By designer (bookings)"><HBars rows={o.breakdowns.designer} /></Card>
        <Card title="By language"><HBars rows={o.breakdowns.language.map((r) => ({ key: r.key === "en" ? "English" : r.key === "hi" ? "Hindi" : r.key === "mr" ? "Marathi" : label(r.key), count: r.count }))} /></Card>
      </div>
      <div className="sec"><Card title={`By hour of day (IST), ${o.breakdowns.afterHoursShare == null ? "no" : pct(o.breakdowns.afterHoursShare)} after hours`}><HourChart hours={o.breakdowns.hourOfDay} /></Card></div>
    </Shell>
  );
}
