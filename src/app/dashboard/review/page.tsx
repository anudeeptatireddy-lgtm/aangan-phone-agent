import { dashContext, carry, type SP } from "../context";
import { getReview, weekStartOf } from "@/db/dash-calls";
import { Empty, Outcome, Page, gateFor, label, outcomeWord, pct, whenShort, clock } from "../ui";
import { ReviewActions } from "./ReviewActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan: weekly check" };
const shift = (iso: string, k: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const nice = (iso: string) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

export default async function Review({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await dashContext(sp);
  if (ctx.state !== "ok") return gateFor(ctx);
  const valid = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) && new Date(`${sp.week}T00:00:00Z`).getUTCDay() === 1;
  // The check is its own week: this week, or (demo) the week of the latest demo call.
  let week = valid ? sp.week! : weekStartOf(ctx.deps.now());
  if (!valid && ctx.demo) { const m = (await ctx.db.query("select max(coalesce(rang_at, ended_at)) as t from calls where is_demo")).rows[0]?.t; if (m) week = weekStartOf(new Date(String(m))); }
  const r = await getReview(ctx.db, { demo: ctx.demo, weekStart: week });
  const link = (w: string) => `/dashboard/review${carry(ctx, { week: w })}`;
  const local = !ctx.locked;
  return (
    <Page ctx={ctx} page="review" path="/dashboard/review">
      <div className="head">
        <div className="eyebrow">{nice(week)} to {nice(r.weekEnd)}</div>
        <h1>Ten calls to check</h1>
        <p className="lead">Each week ten calls are picked at random and kept. Open one, read what was said, then say whether the agent decided right. “Overturn” means it should have decided differently. <a href={link(shift(week, -7))}>‹ Week before</a> · <a href={link(shift(week, 7))}>Week after ›</a></p>
        <div className="tally">
          <div><div className="v">{r.reviewed}<span className="muted" style={{ fontSize: 20 }}> of {r.items.length}</span></div><div className="ctx">checked this week</div></div>
          <div><div className="v" style={{ color: r.overturned ? "var(--bad)" : undefined }}>{r.overturned}</div><div className="ctx">overturned{r.overturnRate == null ? "" : ` (${pct(r.overturnRate)} of those checked)`}</div></div>
          <div><div className="v">{r.allTime.rate == null ? "none yet" : pct(r.allTime.rate)}</div><div className="ctx">overturned across all weeks ({r.allTime.overturned} of {r.allTime.reviewed} checked)</div></div>
        </div>
      </div>
      {r.items.length === 0 ? <Empty><b>No calls were answered in this week, so there is nothing to check.</b> Use “Week before” or “Week after”{ctx.demo ? "." : ", or press Demo to see how a check looks."}</Empty> : r.items.map((i) => (
        <article className="case" key={i.reviewId}>
          <div><div><b>{whenShort(i.rangAt)}</b>, {clock(i.rangAt)}</div><div className="muted small">{i.locality ?? "no area given"}</div></div>
          <div>
            <p style={{ marginBottom: 6 }}>{i.summary ?? <span className="muted">No summary was written for this call.</span>}</p>
            <p style={{ marginBottom: 6 }}>The agent decided: <Outcome o={i.outcome} />{i.reasonCodes.length > 0 && <span className="muted"> ({i.reasonCodes.map((x) => label(x).toLowerCase()).join(", ")})</span>}</p>
            <p className="small" style={{ margin: 0 }}><a href={`/dashboard/calls/${encodeURIComponent(i.callId)}${carry(ctx)}`}>Read and listen to the call ›</a></p>
            {i.reviewedAt && <p className="small muted" style={{ margin: "8px 0 0" }}>{i.overturned ? <b style={{ color: "var(--bad)" }}>Overturned</b> : <b>The agent was right</b>} · {i.reviewer} · {whenShort(i.reviewedAt)}{i.reason ? ` · “${i.reason}”` : ""}</p>}
          </div>
          {ctx.who === "open demo" ? <span className="muted small">{i.reviewedAt ? (i.overturned ? "overturned" : "confirmed") : "read-only demo"}</span> : <ReviewActions callId={i.callId} demo={ctx.demo} local={local} critical={/booked|escalated|not_fit/.test(i.agentDecision)} state={i.reviewedAt ? (i.overturned ? "overturned" : "confirmed") : "open"} />}
        </article>))}
      <p className="muted small" style={{ marginTop: 22 }}>{local ? "There is no login on this computer, so checks are recorded as “local user”." : "One shared password means no personal login, so the name you type is the record."} ({outcomeWord("booked")}, passed to a person and not-a-fit decisions need a reason to overturn.)</p>
    </Page>
  );
}
