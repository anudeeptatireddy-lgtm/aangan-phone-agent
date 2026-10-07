import { dashContext, carry, type SP } from "../../context";
import { getCallDetail } from "@/db/dash-calls";
import { Card, LoginScreen, Message, Pill, Shell, day, dur, inr, label, langName, outcomeTone, when } from "../../ui";
import { RevealPhone } from "./RevealPhone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan phone agent: call" };

const DASH = <span className="muted">—</span>;
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <><dt>{k}</dt><dd>{v ?? DASH}</dd></>;

export default async function CallPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await dashContext(sp);
  if (ctx.state === "unconfigured") return <Message title="Dashboard" body="Not configured: set DASHBOARD_TOKEN." />;
  if (ctx.state === "login") return <LoginScreen error={ctx.error} />;
  if (ctx.state === "nodb") return <Message title="Dashboard" body="No database is configured." />;
  const d = await getCallDetail(ctx.db, decodeURIComponent(id), ctx.demo);
  const back = `/dashboard/calls${carry(ctx)}`;
  if (!d) return <Shell ctx={ctx} page="calls" path="/dashboard/calls" title="Call not found"><p>No such call in this view. <a href={back}>Back to calls</a></p></Shell>;
  const portal = ctx.deps.env.HUBSPOT_PORTAL_ID;
  const e = d.enquiry;

  return (
    <Shell ctx={ctx} page="calls" path={`/dashboard/calls/${encodeURIComponent(d.call.id)}`} title={`Call ${d.call.id}`}>
      <p><a href={back}>‹ All calls</a></p>
      <div className="grid2">
        <Card title="The call">
          <dl className="kv">
            <Row k="Rang" v={`${when(d.call.rangAt)}${d.call.afterHours ? " (after hours)" : ""}`} />
            <Row k="Length" v={dur(d.call.durationS)} />
            <Row k="Outcome" v={<Pill tone={outcomeTone(d.call.outcome)}>{label(d.call.outcome)}</Pill>} />
            <Row k="Understood as" v={label(d.call.intent)} />
            <Row k="Disclosure given" v={d.call.disclosureOk == null ? null : d.call.disclosureOk ? "Yes" : <Pill tone="r">Missing</Pill>} />
            <Row k="Cost" v={d.call.costTotalInr == null ? null : inr(d.call.costTotalInr)} />
            <Row k="Recording" v={d.call.recordingUrl ? <a href={d.call.recordingUrl} target="_blank" rel="noreferrer noopener">Open recording</a> : null} />
            <Row k="Summary" v={d.call.summary} />
          </dl>
        </Card>
        <Card title="Caller">
          {d.caller ? (
            <dl className="kv">
              <Row k="Name" v={d.caller.name} />
              <Row k="Phone" v={d.caller.phoneMasked ? <RevealPhone callId={d.call.id} masked={d.caller.phoneMasked} demo={ctx.demo} /> : null} />
              <Row k="Email" v={d.caller.emailMasked} />
              <Row k="Language" v={langName(e?.language)} />
            </dl>) : <p className="muted">No caller number was captured.</p>}
          {!ctx.demo && <p className="muted small">Revealing a number is logged. It is hidden again after 30 seconds.</p>}
        </Card>
      </div>

      {e && <div className="sec grid2">
        <Card title="What the agent learned">
          <dl className="kv">
            <Row k="Locality" v={e.locality} /><Row k="Project" v={label(e.projectType)} /><Row k="Scope" v={label(e.scope)} />
            <Row k="Size" v={[e.bhk ? `${e.bhk} BHK` : null, e.carpetSqft ? `${e.carpetSqft} sq ft` : null].filter(Boolean).join(" · ") || null} />
            <Row k="Current state" v={label(e.currentState)} /><Row k="Timeline" v={e.timeline} /><Row k="Decision maker" v={label(e.decisionMaker)} />
            <Row k="Owners attending" v={e.ownersAttending == null ? null : e.ownersAttending ? "Yes" : "No"} />
            <Row k="Heard of us via" v={e.sourceHeard} /><Row k="Referrer" v={e.referrer} /><Row k="Asked about price" v={e.askedForPrice ? <Pill tone="a">Yes (given the approved explanation)</Pill> : "No"} />
          </dl>
        </Card>
        <Card title="Rule decision">
          {d.decision && <>
            <p style={{ margin: "0 0 8px" }}><Pill tone={d.decision.fit === "fit" ? "g" : d.decision.fit === "not_fit" ? "r" : "a"}>{label(d.decision.fit)}</Pill> <span className="muted small">rule version {d.decision.ruleVersion ?? "?"}, decided by code, not by the model</span></p>
            <dl className="kv">
              <Row k="Reasons" v={d.decision.reasonCodes.length ? d.decision.reasonCodes.map(label).join(", ") : "None: no rule was triggered"} />
              <Row k="Still missing" v={d.decision.missingFields.length ? d.decision.missingFields.map(label).join(", ") : null} />
              <Row k="Next action" v={label(d.decision.nextAction)} />
            </dl>
            {d.decision.evaluations.length > 0 && <><h3>Evaluations</h3><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.decision.evaluations.map((v, i) => <li key={i}>{label(v.phase)}: {label(v.fit)} ({v.ruleVersion}){v.reasonCodes.length ? ` · ${v.reasonCodes.map(label).join(", ")}` : ""}</li>)}</ul></>}
          </>}
        </Card>
      </div>}

      <div className="sec grid2">
        <Card title="Booking and hand-off">
          {d.booking ? <>
            <dl className="kv"><Row k="Consultation" v={`${when(d.booking.startsAt)} · ${label(d.booking.status)}`} /><Row k="Designer" v={d.booking.designer} /><Row k="Mode" v={label(d.booking.mode)} /></dl>
            <h3>Hand-off timeline</h3>
            <ul className="tl">{d.handoffs.flatMap((h) => [
              <li key={`${h.attempt}-s`}>{when(h.sentAt)}: note sent to <b>{h.designer}</b> (attempt {h.attempt})</li>,
              ...(h.acceptedAt ? [<li key={`${h.attempt}-a`}>{when(h.acceptedAt)}: <b>{h.designer}</b> accepted</li>] : []),
              ...(h.declinedAt ? [<li key={`${h.attempt}-d`} className="warn">{when(h.declinedAt)}: {h.designer} could not take it{h.declineReason ? ` (${h.declineReason})` : ""}</li>] : []),
              ...(h.status === "reassigned" || h.status === "timed_out" ? [<li key={`${h.attempt}-r`} className="warn">{h.status === "timed_out" ? "No answer in time" : "Reassigned"} to the next designer</li>] : []),
            ])}{d.handoffs.length === 0 && <li className="warn">No hand-off recorded yet.</li>}</ul>
          </> : <p className="muted">No consultation booked on this call.</p>}
        </Card>
        <Card title="HubSpot">
          {d.hubspot ? <dl className="kv">
            <Row k="Deal" v={portal && d.hubspot.dealId ? <a href={`https://app.hubspot.com/contacts/${encodeURIComponent(portal)}/deal/${encodeURIComponent(d.hubspot.dealId)}`} target="_blank" rel="noreferrer noopener">Open deal {d.hubspot.dealId}</a> : d.hubspot.dealId} />
            <Row k="Stage" v={label(d.hubspot.stage)} /><Row k="Deal value" v={d.hubspot.dealAmountInr == null ? null : inr(d.hubspot.dealAmountInr, 0)} />
          </dl> : <p className="muted">No deal created.</p>}
          {!portal && d.hubspot && <p className="muted small">Set HUBSPOT_PORTAL_ID to make the deal id a link.</p>}
        </Card>
      </div>

      {(d.flags.length > 0 || d.escalations.length > 0 || d.alerts.length > 0) && <div className="sec"><Card title="Alerts and escalations">
        <ul className="tl">
          {d.flags.map((f, i) => <li key={`f${i}`} className={f.kind === "price_mention" ? "bad" : "warn"}>{when(f.at)}: audit flag <b>{label(f.kind)}</b>{f.evidence ? <> · <span className="muted">“{f.evidence}”</span></> : null}</li>)}
          {d.escalations.map((x, i) => <li key={`e${i}`} className="warn">{when(x.at)}: escalated as <b>{label(x.reason)}</b> ({label(x.mode)}){x.callbackDueAt ? `, callback due ${when(x.callbackDueAt)}` : ""}{x.resolvedAt ? `, closed ${when(x.resolvedAt)}` : ""}</li>)}
          {d.alerts.map((a, i) => <li key={`a${i}`} className={a.priority === "urgent" ? "bad" : "warn"}>{when(a.at)}: alert to {label(a.to)}: {label(a.kind)}{a.priority ? ` (${a.priority})` : ""} · {a.status}</li>)}
        </ul>
      </Card></div>}

      <div className="sec grid2">
        {e?.designerNote && <Card title="Note the designer received"><pre style={{ whiteSpace: "pre-wrap", margin: 0, font: "inherit", fontSize: ".88rem" }}>{e.designerNote}</pre></Card>}
        <Card title="Transcript">
          <div className="chat">{d.transcript.length ? d.transcript.map((t, i) => <p key={i} className={t.speaker === "agent" ? "agent" : "caller"}><b className="small">{t.speaker === "agent" ? "Agent" : "Caller"}</b><br />{t.text}</p>) : <p className="muted">No transcript.</p>}</div>
        </Card>
      </div>
      <p className="muted small">Recorded {day(d.call.rangAt)}. Recordings are deleted after 90 days.</p>
    </Shell>
  );
}
