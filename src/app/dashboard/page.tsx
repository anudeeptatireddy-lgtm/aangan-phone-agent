import { dashContext, type SP } from "./context";
import { overview } from "@/db/dash-metrics";
import { DaysChart, Empty, Funnel, HoursChart, Page, Rank, Section, gateFor, inr, inrShort, label, langName, mins, pct, periodTitle, plural, previousName, vs } from "./ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan: what happened to the calls" };

export default async function Overview({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await dashContext(await searchParams);
  if (ctx.state !== "ok") return gateFor(ctx);
  const [o, p] = await Promise.all([overview(ctx.db, ctx.q), overview(ctx.db, ctx.prev)]);
  const period = periodTitle(ctx.from, ctx.to), before = previousName(ctx);
  const stage = (k: string) => o.funnel.stages.find((s) => s.key === k)!;
  const prevStage = (k: string) => p.funnel.stages.find((s) => s.key === k)!.count;
  const hasPrev = (prevStage("received") ?? 0) > 0;
  const B = (t: string) => (hasPrev ? t : ""); // comparisons only when the earlier period has calls to compare with
  const received = stage("received").count ?? 0, answered = stage("answered").count ?? 0, qualified = stage("qualified").count ?? 0, booked = stage("booked").count ?? 0;
  const missed = received - answered;
  const afterHours = o.breakdowns.hourOfDay.reduce((a, h) => a + h.afterHours, 0);
  const headline = received === 0 ? "No calls in this period." : missed === 0 ? "Every call was answered." : `${answered} of ${received} calls were answered.`;
  const c = o.cost, pc = p.cost, sp = o.speed;
  const costVs = vs(c.perBookedConsultationInr, pc.perBookedConsultationInr, { better: "lower", fmt: (n) => inr(n, 0) });
  const withinHour = sp.pctAnsweredUnder1h, esc = o.escalations, r = o.router;
  const outcomeRows = [
    { key: "fit", count: o.outcomes.fit, name: "Fit for the studio" }, { key: "not_fit", count: o.outcomes.notFit.total, name: "Not a fit" }, { key: "unclear", count: o.outcomes.unclear, name: "Unclear, needs a person" },
    { key: "complaint", count: o.outcomes.complaint, name: "Complaints from existing clients" }, { key: "other", count: o.outcomes.other, name: "Not an enquiry (vendor, wrong number)" },
    { key: "missed", count: o.outcomes.missed, name: "Missed" }, { key: "dropped", count: o.outcomes.dropped, name: "Caller hung up" }].filter((x) => x.count > 0);
  const top = (rows: { key: string; count: number; booked?: number }[], n = 8) => ({ rows: rows.slice(0, n).map((x) => ({ key: x.key, count: x.count, name: x.key === "Unknown" ? "Not given" : undefined, note: x.booked ? `${x.booked} booked` : undefined })), more: Math.max(0, rows.length - n) });
  const loc = top(o.breakdowns.locality), typ = top(o.breakdowns.projectType), des = top(o.breakdowns.designer, 10);
  const lang = o.breakdowns.language.map((x) => ({ key: x.key, count: x.count, name: langName(x.key) ?? label(x.key) }));

  return (
    <Page ctx={ctx} page="overview" path="/dashboard">
      <div className="head">
        <div className="eyebrow">{period}</div>
        <h1>{headline}</h1>
        {received > 0 ? <>
          <div className="hero" style={{ marginTop: 18 }}>
            <span className="big">{received}</span>
            <span className="what">calls came in.<br /><span className="ctx">{hasPrev ? `${before}: ${prevStage("received")} (${vs(received, prevStage("received")).text})` : ""}</span></span>
            <span className="big" style={{ marginLeft: 28 }}>{booked}</span>
            <span className="what">booked a consultation.<br /><span className="ctx">{hasPrev ? `${before}: ${prevStage("booked")}` : ""}</span></span>
          </div>
          <p className="lead">{plural(qualified, "caller")} fit what the studio takes on, and {booked} of them booked a consultation during the call itself.{afterHours > 0 ? ` ${plural(afterHours, "call")} (${pct(afterHours / received)}) came in after hours, and the agent took ${afterHours === 1 ? "it" : "them"} all.` : ""}</p>
          {!hasPrev && <p className="ctx">There are no calls in {before} to compare with.</p>}
        </> : <Empty><b>Nothing to show for {period}.</b> Try “This month” or “Last 30 days” from the dates at the top right{ctx.demo ? "." : ", or press Demo to see the dashboard with sample calls."}</Empty>}
      </div>

      {received > 0 && <>
        <Funnel stages={o.funnel.stages} title="What happened to every call" sub={`${period}. The ribbon is the calls; it narrows as fewer of them reach each step.`} />
        <details className="all">
          <summary>Show all ten steps</summary>
          <table className="tbl"><thead><tr><th scope="col">Step</th><th scope="col">Counted as</th><th scope="col" className="right">How many</th><th scope="col" className="right">Of the step before</th></tr></thead>
            <tbody>{o.funnel.stages.map((s) => <tr key={s.key}><td>{s.label}</td><td className="muted">{s.unit === "calls" ? "calls" : "enquiries"}</td><td className="right num">{s.hasData ? s.count : <span className="muted">no data yet</span>}</td><td className="right num">{s.conversion == null ? "" : pct(s.conversion)}</td></tr>)}</tbody></table>
          {o.funnel.stages.some((s) => !s.hasData) && <p className="muted small">“No data yet” means the designers' updates have not reached HubSpot, so the dashboard has nothing to count. It does not mean zero.</p>}
        </details>

        <div className="promises">
          <h2>Did the studio keep its promises?</h2>
          <div className="cols4">
            <div className="pr"><div className="k">Calls answered within an hour</div>
              <div className={`v ${withinHour == null ? "" : withinHour >= 1 ? "ok" : withinHour >= 0.95 ? "wait" : "bad"}`}>{pct(withinHour)}</div>
              <div className="t">target 100%</div><div className="ctx">{sp.medianAnswerSeconds == null ? "" : `Typically answered in ${sp.medianAnswerSeconds} seconds. `}{B(`${before}: ${pct(p.speed.pctAnsweredUnder1h)}`)}</div></div>
            <div className="pr"><div className="k">Times the agent quoted a price</div>
              <div className={`v ${o.price.agentPriceFlags > 0 ? "bad" : "ok"}`}>{o.price.agentPriceFlags}</div>
              <div className="t">target 0</div><div className="ctx">{plural(o.price.askedCount, "caller")} asked about price and {o.price.askedCount === 1 ? "was" : "were"} given the studio's standard answer.</div></div>
            <div className="pr"><div className="k">Complaints called back within 15 minutes</div>
              {esc.hasResolutionData ? <><div className={`v ${(esc.pctClosedWithin15Min ?? 0) >= 1 ? "ok" : "wait"}`}>{pct(esc.pctClosedWithin15Min)}</div><div className="t">target 100%</div></>
                : <><div className="v" style={{ fontSize: 22, color: "var(--muted)" }}>no data yet</div><div className="t nodata">{esc.complaints === 0 ? "There were no complaints." : "Nobody has marked these complaints as called back."}</div></>}
              <div className="ctx">{plural(esc.complaints, "complaint")} {esc.complaints === 1 ? "was" : "were"} passed to a person. {B(`${before}: ${p.escalations.complaints}`)}</div></div>
            <div className="pr"><div className="k">Callers told “booked” with no booking found</div>
              <div className={`v ${r.claimedButNoBooking > 0 ? "bad" : "ok"}`}>{r.claimedButNoBooking}</div>
              <div className="t">target 0</div><div className="ctx">{r.claimedButNoBooking > 0 ? "These callers believe they are booked. Someone needs to call them." : "Nobody is waiting on a booking that does not exist."}</div></div>
          </div>
        </div>

        <Section title="When calls come in" hint="India time. Calls outside 10 am to 7 pm on weekdays are after hours.">
          <div className="cols2">
            <div><h3 style={{ marginBottom: 12 }}>Each day</h3><DaysChart days={o.daily} /></div>
            <div><h3 style={{ marginBottom: 12 }}>By time of day</h3><HoursChart hours={o.breakdowns.hourOfDay} />
              <p className="muted small" style={{ marginTop: 10 }}>{afterHours} of {received} calls ({pct(o.breakdowns.afterHoursShare)}) came in after hours. {B(`${before}: ${pct(p.breakdowns.afterHoursShare)}.`)}</p></div>
          </div>
        </Section>

        <Section title="Where the calls ended up" hint="Every call is counted once, by what the studio's rules decided.">
          <div className="cols2">
            <div><Rank rows={outcomeRows} /></div>
            <div><h3 style={{ marginBottom: 12 }}>Why some were not a fit</h3>
              {o.outcomes.notFit.byReason.length ? <Rank rows={o.outcomes.notFit.byReason.map((x) => ({ key: x.reason, count: x.count }))} /> : <Empty>Every enquiry that came in was a fit or needed a person. Nothing was turned away.</Empty>}</div>
          </div>
        </Section>

        <Section title="What it costs" hint="Running the agent in this period: phone minutes, the reading of each call, and fixed monthly fees.">
          <div className="cols2">
            {c.byLine.length ? <table className="tbl"><tbody>
              {c.byLine.map((l) => <tr key={l.line}><td>{l.label}</td><td className="right num">{inr(l.amountInr)}</td></tr>)}
              <tr><td className="total">Total</td><td className="right num total">{inr(c.totalInr)}</td></tr>
              <tr><td>Per call</td><td className="right num">{inr(c.perCallInr)}</td></tr>
            </tbody></table> : <Empty><b>No spend recorded for {period}.</b> Calls record their own phone and reading costs; fixed monthly fees (phone number, hosting) are entered by hand. See docs/next-session.md.</Empty>}
            <div><div className="ctx">Cost to book one consultation</div>
              <div className="serif" style={{ fontSize: 40, lineHeight: 1.1 }}>{c.perBookedConsultationInr == null ? "n/a" : inr(c.perBookedConsultationInr, 0)}</div>
              <div className="ctx">{c.perBookedConsultationInr == null ? "No consultation was booked in this period." : <>{hasPrev && pc.perBookedConsultationInr != null ? <>{before}: {inr(pc.perBookedConsultationInr, 0)}, so <span className={costVs.tone}>{costVs.text}</span>. </> : null}Voice minutes are priced at the dashboard rate, so this is an estimate.</>}</div></div>
          </div>
        </Section>

        <Section title="How quickly designers respond" hint="A designer has 30 working minutes to accept a consultation before it goes to the next one.">
          {sp.acceptedHandoffs > 0 ? <>
            <div className="serif" style={{ fontSize: 40, lineHeight: 1.1 }}>{mins(sp.medianAcceptWorkingMinutes)}</div>
            <p className="ctx" style={{ marginTop: 6 }}>Typical time to accept, in working minutes (Monday to Friday, 10 am to 7 pm). On the clock it is {mins(sp.medianAcceptMinutes)}. Target: under 30. {hasPrev && p.speed.medianAcceptWorkingMinutes != null ? `${before}: ${mins(p.speed.medianAcceptWorkingMinutes)}. ` : ""}{plural(sp.acceptedHandoffs, "consultation")} accepted.</p>
          </> : <Empty><b>No designer has accepted a consultation in this period.</b> Acceptances appear here once designers press Accept in Telegram.</Empty>}
        </Section>

        <Section title="Quotes and deals" hint="The designers' own figures, from HubSpot. The agent never sees or says them.">
          {o.pipeline.hasData ? <table className="tbl"><tbody>
            <tr><td>Won ({o.pipeline.wonCount})</td><td className="right num">{inrShort(o.pipeline.wonValueInr)}</td></tr>
            <tr><td>Quoted and waiting ({o.pipeline.quotedCount})</td><td className="right num">{inrShort(o.pipeline.quotedValueInr)}</td></tr>
            <tr><td className="total">Together</td><td className="right num total">{inrShort(o.pipeline.totalValueInr)}</td></tr>
            {hasPrev && p.pipeline.hasData && <tr><td className="muted">{before}</td><td className="right num muted">{inrShort(p.pipeline.totalValueInr)}</td></tr>}
          </tbody></table> : <Empty><b>No quotes have reached HubSpot yet.</b> Once designers enter their quotes there, the value of what is won and what is waiting shows here.</Empty>}
        </Section>

        <Section title="Bookings matched to calls" hint="The booking system books the consultation. We match each booking back to the call it came from.">
          <table className="tbl"><tbody>
            <tr><td>Bookings matched to their call</td><td className="right num">{r.matched}</td><td className="note" /></tr>
            <tr><td>Could not tell which call a booking belonged to</td><td className="right num" style={r.ambiguous ? { color: "var(--wait)" } : undefined}>{r.ambiguous}</td><td className="note">{r.ambiguous ? "The design lead picks the right one by hand." : ""}</td></tr>
            <tr><td>Caller was told “booked”, but no booking was found</td><td className="right num" style={r.claimedButNoBooking ? { color: "var(--bad)", fontWeight: 600 } : undefined}>{r.claimedButNoBooking}</td><td className="note">{r.claimedButNoBooking ? "Call them back: they think they are booked." : ""}</td></tr>
            <tr><td>Bookings with no call behind them</td><td className="right num">{r.bookingWithoutCall}</td><td className="note">{r.bookingWithoutCall ? "Check where these came from." : ""}</td></tr>
          </tbody></table>
        </Section>

        <Section title="Who calls and what they want" hint="Enquiries in this period.">
          <div className="cols2">
            <div><h3 style={{ marginBottom: 12 }}>Areas</h3><Rank rows={loc.rows} more={loc.more} /></div>
            <div><h3 style={{ marginBottom: 12 }}>Kinds of project</h3><Rank rows={typ.rows} more={typ.more} /></div>
            <div><h3 style={{ marginBottom: 12 }}>Language spoken</h3><Rank rows={lang} /></div>
            <div><h3 style={{ marginBottom: 12 }}>Consultations by designer</h3>{des.rows.length ? <Rank rows={des.rows} more={des.more} /> : <Empty>No consultation has been booked yet.</Empty>}</div>
          </div>
        </Section>
      </>}
    </Page>
  );
}
