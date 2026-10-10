import { monthGrid, monthsIn } from "./calendar-grid";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const nice = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00Z`));

/** A month calendar: hover a date for its calls and converted calls, click it for that day's calls. Shade = how busy the day was. */
export function Calendar({ days, from, to, demo }: { days: Record<string, { calls: number; booked: number }>; from: string; to: string; demo: boolean }) {
  const max = Math.max(1, ...Object.values(days).map((d) => d.calls));
  const link = (d: string) => `/dashboard/calls?from=${d}&to=${d}${demo ? "&data=demo" : ""}`;
  return (
    <section className="cal-wrap" aria-label="Calls by day">
      <h2>Day by day</h2>
      <p className="muted">Hover a date to see its calls and how many booked a consultation. Click a date to see that day's calls. Darker means busier.</p>
      <div className="cal-months">
        {monthsIn(from, to).map(({ year, month }) => (
          <div className="cal" key={`${year}-${month}`}>
            <h3>{MONTHS[month - 1]} {year}</h3>
            <div className="cal-grid cal-head">{WEEK.map((w) => <span key={w}>{w}</span>)}</div>
            {monthGrid(year, month).map((week, i) => (
              <div className="cal-grid" key={i}>
                {week.map((c) => {
                  const d = days[c.date], inRange = c.inMonth && c.date >= from && c.date <= to;
                  if (!c.inMonth) return <span key={c.date} className="cal-day pad" aria-hidden="true" />;
                  const text = d ? `${nice(c.date)}: ${d.calls} ${d.calls === 1 ? "call" : "calls"}, ${d.booked} converted${d.calls ? ` (${Math.round((d.booked / d.calls) * 100)}%)` : ""}` : `${nice(c.date)}: no calls`;
                  const shade = d ? `color-mix(in srgb, var(--accent) ${Math.round(14 + (d.calls / max) * 56)}%, transparent)` : undefined;
                  const body = (<><b>{c.day}</b>{d ? <><i>{d.calls}</i><u>{d.booked ? `${d.booked} ✓` : ""}</u></> : null}<span className="tip" role="tooltip">{text}</span></>);
                  return inRange
                    ? <a key={c.date} className="cal-day" style={shade ? { background: shade } : undefined} href={link(c.date)} aria-label={`${text}. Open this day's calls.`}>{body}</a>
                    : <span key={c.date} className="cal-day out" aria-label={text}>{body}</span>;
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
