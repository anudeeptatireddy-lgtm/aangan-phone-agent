import { dashContext, carry, type SP } from "../../context";
import { getCallDetail } from "@/db/dash-calls";
import { Outcome, Page, clock, day, dur, gateFor, inr, label, langName, outcomeWord, scopeName, weekdayDate, when } from "../../ui";
import { RevealPhone } from "./RevealPhone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aangan: one call" };

const Dash = () => <span className="muted">—</span>;
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <><dt>{k}</dt><dd>{v ?? <Dash />}</dd></>;
const Block = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="block"><h2>{title}</h2>{children}</section>;

export default async function CallPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await dashContext(sp);
  if (ctx.state !== "ok") return gateFor(ctx);
  const d = await getCallDetail(ctx.db, decodeURIComponent(id), ctx.demo);
  const back = `/dashboard/calls${carry(ctx)}`;
  if (!d) return <Page ctx={ctx} page="calls" path="/dashboard/calls"><div className="head"><h1>That call is not here</h1><p className="lead">There is no call with that number in {ctx.demo ? "the demo data" : "the live data"}. <a href={back}>Back to every call</a>{ctx.demo ? "" : ", or press Demo if you were looking at a sample call"}.</p></div></Page>;
  const portal = ctx.deps.env.HUBSPOT_PORTAL_ID;
  const e = d.enquiry, b = d.booking;
  const accepted = d.handoffs.find((h) => h.acceptedAt);
  const acceptedIn = accepted?.acceptedAt && accepted.sentAt ? Math.max(1, Math.round((accepted.acceptedAt.getTime() - accepted.sentAt.getTime()) / 60_000)) : null;
  const who = d.caller?.name ?? "A caller";
  const reasons = d.decision?.reasonCodes.map((r) => label(r).toLowerCase()).join(", ");
  const verdict = d.call.outcome === "booked" && b ? `The rules said fit, and the agent booked ${b.designer} for ${weekdayDate(b.startsAt)}, ${clock(b.startsAt)}.${acceptedIn ? ` ${accepted!.designer} accepted ${acceptedIn === 1 ? "within a minute" : `after ${acceptedIn} minutes`}.` : b.status === "attended" || b.status === "confirmed" ? " The designer has not accepted it yet." : ""}`
    : d.call.outcome === "not_fit" ? `The rules said this was not a fit${reasons ? ` (${reasons})` : ""}, and the caller was told so kindly.`
    : d.call.outcome === "missed" ? "This call was missed, so no details were taken."
    : d.call.outcome === "review" ? "The agent could not settle this on its own, so a person needs to look at it."
    : d.call.outcome === "escalated" ? "The agent passed this to a person." : d.call.outcome === "closed_other" ? "This was not an enquiry (a vendor or a wrong number)." : outcomeWord(d.call.outcome) + ".";

  return (
    <Page ctx={ctx} page="calls" path={`/dashboard/calls/${encodeURIComponent(d.call.id)}`}>
      <div className="head">
        <p className="small" style={{ marginBottom: 14 }}><a href={back}>‹ Every call</a></p>
        <h1>{who} called on {weekdayDate(d.call.rangAt)} at {clock(d.call.rangAt)}{d.call.afterHours ? <span className="moon" style={{ fontSize: 17 }}> ☾ after hours</span> : null}</h1>
        <p className="lead">{verdict}</p>
      </div>
      <div className="detail">
        <div>
          <Block title="The caller and the call">
            <dl className="kv">
              <Row k="Name" v={d.caller?.name} />
              <Row k="Phone" v={d.caller?.phoneMasked ? (ctx.who === "open demo" ? d.caller.phoneMasked : <RevealPhone callId={d.call.id} masked={d.caller.phoneMasked} demo={ctx.demo} />) : null} />
              <Row k="Email" v={d.caller?.emailMasked} />
              <Row k="Language" v={langName(e?.language)} />
              <Row k="What happened" v={<Outcome o={d.call.outcome} />} />
              <Row k="Length of call" v={dur(d.call.durationS)} />
              <Row k="Said who it was and that it records" v={d.call.disclosureOk == null ? null : d.call.disclosureOk ? "Yes" : <b style={{ color: "var(--bad)" }}>No: this needs a look</b>} />
              <Row k="What the call cost" v={d.call.costTotalInr == null ? null : inr(d.call.costTotalInr)} />
              <Row k="Recording" v={d.call.recordingUrl ? <a href={d.call.recordingUrl} target="_blank" rel="noreferrer noopener">Listen to it</a> : null} />
              <Row k="In short" v={d.call.summary} />
            </dl>
            {!ctx.demo && ctx.who !== "open demo" && d.caller?.phoneMasked && <p className="muted small" style={{ marginTop: 12 }}>Showing a number is recorded as “{ctx.who}” and it hides again after 30 seconds.</p>}
          </Block>

          {e && <Block title="What they asked for">
            <dl className="kv">
              <Row k="Area" v={e.locality} /><Row k="Kind of project" v={label(e.projectType)} /><Row k="Work wanted" v={scopeName(e.scope)} />
              <Row k="Size" v={[e.bhk ? `${e.bhk} BHK` : null, e.carpetSqft ? `${e.carpetSqft} sq ft` : null].filter(Boolean).join(", ") || null} />
              <Row k="Home today" v={e.currentState && e.currentState !== "unknown" ? label(e.currentState) : null} /><Row k="When they need it" v={e.timeline} />
              <Row k="Who decides" v={e.decisionMaker && e.decisionMaker !== "unknown" ? label(e.decisionMaker) : null} />
              <Row k="Owners will attend" v={e.ownersAttending == null ? null : e.ownersAttending ? "Yes" : "No"} />
              <Row k="Heard of Aangan from" v={e.sourceHeard} /><Row k="Referred by" v={e.referrer} />
              <Row k="Asked about price" v={e.askedForPrice ? "Yes, and was given the studio's standard answer" : "No"} />
            </dl>
          </Block>}

          {d.decision && <Block title="How the studio decided">
            <p style={{ marginBottom: 10 }}><b>{label(d.decision.fit)}.</b> <span className="muted">Decided by the studio's rules (version {d.decision.ruleVersion ?? "?"}), not by the AI.</span></p>
            <dl className="kv">
              <Row k="Because" v={d.decision.reasonCodes.length ? d.decision.reasonCodes.map(label).join(", ") : "No rule stood in the way"} />
              <Row k="Still to find out" v={d.decision.missingFields.length ? d.decision.missingFields.map(label).join(", ") : null} />
              <Row k="Next step" v={label(d.decision.nextAction)} />
              <Row k="Checked" v={d.decision.evaluations.length ? d.decision.evaluations.map((v) => `${label(v.phase)}: ${label(v.fit)} (${v.ruleVersion})`).join(" · ") : null} />
            </dl>
          </Block>}

          <Block title="Consultation and designer">
            {b ? <>
              <dl className="kv"><Row k="Consultation" v={`${weekdayDate(b.startsAt)}, ${clock(b.startsAt)} · ${({ attended: "held", no_show: "did not happen (no show)", confirmed: "coming up", held: "pencilled in", cancelled: "cancelled", rescheduled: "moved" } as Record<string, string>)[b.status] ?? label(b.status)}`} /><Row k="Designer" v={b.designer} /><Row k="Kind of visit" v={label(b.mode)} /></dl>
              <h3 style={{ margin: "18px 0 10px" }}>What happened to the designer's note</h3>
              <ul className="tl">{d.handoffs.flatMap((h) => [
                <li key={`${h.attempt}s`}>{when(h.sentAt)}: note sent to <b>{h.designer}</b></li>,
                ...(h.acceptedAt ? [<li key={`${h.attempt}a`}>{when(h.acceptedAt)}: <b>{h.designer}</b> accepted</li>] : []),
                ...(h.declinedAt ? [<li key={`${h.attempt}d`} className="wait">{when(h.declinedAt)}: {h.designer} could not take it{h.declineReason ? ` (${label(h.declineReason).toLowerCase()})` : ""}</li>] : []),
                ...(h.status === "reassigned" && !h.declinedAt ? [<li key={`${h.attempt}r`} className="wait">No answer from {h.designer} in 30 working minutes, so it went to the next designer</li>] : []),
              ])}{d.handoffs.length === 0 && <li className="wait">The note has not been sent to a designer yet.</li>}</ul>
            </> : <p className="muted">No consultation was booked on this call.</p>}
          </Block>

          <Block title="Quote and deal">
            {d.hubspot ? <dl className="kv">
              <Row k="Where it stands" v={({ new: "Deal opened", consult_booked: "Consultation booked", consult_held: "Consultation held", quote_sent: "Quote sent", won: "Won", lost: "Lost" } as Record<string, string>)[d.hubspot.stage ?? ""] ?? label(d.hubspot.stage)} />
              <Row k="Value (the designer's figure)" v={d.hubspot.dealAmountInr == null ? null : inr(d.hubspot.dealAmountInr, 0)} />
              <Row k="In HubSpot" v={portal && d.hubspot.dealId ? <a href={`https://app.hubspot.com/contacts/${encodeURIComponent(portal)}/deal/${encodeURIComponent(d.hubspot.dealId)}`} target="_blank" rel="noreferrer noopener">Open the deal</a> : <span>Deal {d.hubspot.dealId}</span>} />
            </dl> : <p className="muted">No deal has been opened for this call.</p>}
            {d.hubspot && !portal && <p className="muted small" style={{ marginTop: 8 }}>Set HUBSPOT_PORTAL_ID to turn the deal number into a link.</p>}
          </Block>

          {(d.flags.length > 0 || d.escalations.length > 0 || d.alerts.length > 0) && <Block title="Alerts and escalations">
            <ul className="tl">
              {d.flags.map((f, i) => <li key={`f${i}`} className={f.kind === "price_mention" ? "bad" : "wait"}>{when(f.at)}: <b>{f.kind === "price_mention" ? "The agent said a price" : label(f.kind)}</b>{f.evidence ? <span className="muted"> · “{f.evidence}”</span> : null}</li>)}
              {d.escalations.map((x, i) => <li key={`e${i}`} className="wait">{when(x.at)}: passed to a person as <b>{label(x.reason).toLowerCase()}</b>{x.callbackDueAt ? `, call back due ${when(x.callbackDueAt)}` : ""}{x.resolvedAt ? `, closed ${when(x.resolvedAt)}` : ""}</li>)}
              {d.alerts.map((a, i) => <li key={`a${i}`} className={a.priority === "urgent" ? "bad" : "wait"}>{when(a.at)}: told the {label(a.to).toLowerCase()}: {label(a.kind).toLowerCase()}{a.priority === "urgent" ? " (urgent)" : ""}</li>)}
            </ul>
          </Block>}

          {e?.designerNote && <Block title="The note the designer received"><pre className="note">{e.designerNote}</pre></Block>}
          <p className="muted small" style={{ marginTop: 22 }}>Recorded {day(d.call.rangAt)}. Recordings are deleted after 90 days.</p>
        </div>
        <aside className="transcript" aria-label="What was said">
          <h2 style={{ fontSize: 20, marginBottom: 14 }}>What was said</h2>
          {d.transcript.length ? d.transcript.map((t, i) => <div key={i} className={`turn ${t.speaker === "agent" ? "agent" : "caller"}`}><div className="who">{t.speaker === "agent" ? "Agent" : "Caller"}</div><p>{t.text}</p></div>) : <p className="muted">There is no transcript for this call{d.call.outcome === "missed" ? ", because nobody spoke to the agent" : ""}.</p>}
        </aside>
      </div>
    </Page>
  );
}
