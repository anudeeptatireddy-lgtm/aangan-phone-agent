import { dashContext, carry, type SP } from "../context";
import { getReview, weekStartOf } from "@/db/dash-calls";
import { Card, LoginScreen, Message, Pill, Shell, label, outcomeTone, pct, when } from "../ui";
import { ReviewActions } from "./ReviewActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan phone agent: weekly review" };
const shift = (iso: string, k: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);

export default async function Review({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await dashContext(sp);
  if (ctx.state === "unconfigured") return <Message title="Dashboard" body="Not configured: set DASHBOARD_TOKEN." />;
  if (ctx.state === "login") return <LoginScreen error={ctx.error} />;
  if (ctx.state === "nodb") return <Message title="Dashboard" body="No database is configured." />;
  const valid = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) && new Date(`${sp.week}T00:00:00Z`).getUTCDay() === 1;
  // The review is its own week: default to this week, or (demo) the week of the latest demo call.
  let week = valid ? sp.week! : weekStartOf(ctx.deps.now());
  if (!valid && ctx.demo) { const m = (await ctx.db.query("select max(coalesce(rang_at, ended_at)) as t from calls where is_demo")).rows[0]?.t; if (m) week = weekStartOf(new Date(String(m))); }
  const r = await getReview(ctx.db, { demo: ctx.demo, weekStart: week });
  const link = (w: string) => `/dashboard/review${carry(ctx, { week: w })}`;
  return (
    <Shell ctx={ctx} page="review" path="/dashboard/review" title="Weekly review">
      <p className="small"><a href={link(shift(week, -7))}>‹ Previous week</a> · <b>{week}</b> to {r.weekEnd} · <a href={link(shift(week, 7))}>Next week ›</a></p>
      <div className="grid">
        <div className="card tile"><div className="k">Reviewed this week</div><div className="v">{r.reviewed}<span className="muted small"> of {r.items.length}</span></div></div>
        <div className={`card tile ${r.overturned > 0 ? "bad" : ""}`}><div className="k">Overturned this week</div><div className="v">{r.overturned}</div><div className="s">{r.overturnRate == null ? "nothing reviewed yet" : `${pct(r.overturnRate)} overturn rate`}</div></div>
        <div className="card tile"><div className="k">Overturn rate, all weeks</div><div className="v">{r.allTime.rate == null ? "n/a" : pct(r.allTime.rate)}</div><div className="s">{r.allTime.overturned} of {r.allTime.reviewed} reviewed</div></div>
      </div>
      <p className="muted small">Ten calls are drawn at random once per week and kept. For each, read the call and say whether the agent's decision was right. Overturn means the agent should have decided differently.</p>
      <div className="sec" style={{ display: "grid", gap: 12 }}>
        {r.items.map((i) => (
          <Card key={i.reviewId}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <span><b>{when(i.rangAt)}</b> · {i.locality ?? "no locality"}</span>
              <span>Agent decided: <Pill tone={outcomeTone(i.outcome)}>{label(i.agentDecision.replace(" / ", ", "))}</Pill> {i.reasonCodes.length > 0 && <span className="muted small">({i.reasonCodes.map(label).join(", ")})</span>}</span>
            </div>
            {i.summary && <p style={{ margin: "8px 0 0" }}>{i.summary}</p>}
            <p className="small" style={{ margin: "6px 0 0" }}><a href={`/dashboard/calls/${encodeURIComponent(i.callId)}${carry(ctx)}`}>Open the call and transcript ›</a></p>
            {i.reviewedAt && <p className="small muted" style={{ margin: "6px 0 0" }}>{i.overturned ? <Pill tone="r">Overturned</Pill> : <Pill tone="g">Agent was right</Pill>} by {i.reviewer} · {when(i.reviewedAt)}{i.reason ? ` · “${i.reason}”` : ""}</p>}
            <ReviewActions callId={i.callId} demo={ctx.demo} critical={/booked|escalated|not_fit/.test(i.agentDecision)} state={i.reviewedAt ? (i.overturned ? "overturned" : "confirmed") : "open"} />
          </Card>))}
        {r.items.length === 0 && <Card><p className="muted">No processed calls in this week.</p></Card>}
      </div>
    </Shell>
  );
}
