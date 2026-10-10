import type { CallbackRow } from "@/db/dash-days";

const when = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(d) : "");
const MAIL = { sent: "Designer emailed", queued: "Email queued", failed: "Email failed", none: "Not emailed" } as const;

/** The branch of the funnel after "Qualified": callers who fit the studio but did not book, so someone has to call them back. */
export function Callbacks({ rows, demo }: { rows: CallbackRow[]; demo: boolean }) {
  const qualified = rows[0]?.qualified ?? 0, booked = rows[0]?.booked ?? 0;
  if (!rows.length) return null;
  return (
    <section className="cal-wrap" aria-label="Callbacks to make">
      <h2>Needs a callback</h2>
      <p className="muted">{qualified} callers fit what the studio takes on: {booked} booked a consultation, {rows.length} did not. A designer was emailed to call each of them back. Web calls carry no phone number, so the number has to be asked for.</p>
      <ul className="callbacks">
        {rows.map((r) => (
          <li key={r.callId}>
            <a href={`/dashboard/calls/${encodeURIComponent(r.callId)}${demo ? "?data=demo" : ""}`}><b>{r.caller ?? "Caller"}</b>{r.place ? ` · ${r.place}` : ""}</a>
            <span className="muted"> · {when(r.at)} · {r.reason}</span>
            <span className="cb-meta">Phone: {r.phoneMasked ?? "not captured (web call)"} · <em className={`cb-${r.emailed}`}>{MAIL[r.emailed]}</em></span>
          </li>
        ))}
      </ul>
    </section>
  );
}
