import type { ReactNode } from "react";
import type { DashCtx } from "./context";
import { carry } from "./context";

type Ok = Extract<DashCtx, { state: "ok" }>;

export * from "./format";
import { label, outcomeWord, periodTitle, whenShort } from "./format";
const outcomeTone = (o: string | null | undefined) => (o === "booked" ? "" : o === "review" ? "wait" : o === "escalated" || o === "missed" ? "bad" : "none");
export const Outcome = ({ o, extra }: { o: string | null | undefined; extra?: string }) => <span><i className={`dot ${outcomeTone(o)}`} aria-hidden="true" />{outcomeWord(o)}{extra ? <span className="muted"> {extra}</span> : null}</span>;

// ---- page frame --------------------------------------------------------------------------------------------------------------------------------
const Mark = () => <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="2.5" y="2.5" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="8" y="8" width="8" height="8" fill="var(--accent)" /></svg>;
type PageKey = "overview" | "calls" | "designers" | "review";

export function Page({ ctx, page, path, children }: { ctx: Ok; page: PageKey; path: string; children: ReactNode }) {
  const c = carry(ctx);
  const nav: [string, string, PageKey][] = [["Overview", "/dashboard", "overview"], ["Calls", "/dashboard/calls", "calls"], ["Designers", "/dashboard/designers", "designers"], ["Weekly check", "/dashboard/review", "review"]];
  const today = new Date(Date.now() + 330 * 60_000), iso = (d: Date) => d.toISOString().slice(0, 10);
  const first = `${iso(today).slice(0, 7)}-01`, d7 = iso(new Date(today.getTime() - 6 * 86_400_000)), d30 = iso(new Date(today.getTime() - 29 * 86_400_000));
  const pre = (f: string, t: string) => `${path}${carry({ from: f, to: t, demo: ctx.demo })}`;
  return (
    <>
      <div className="wrap">
        <header className="top">
          <a className="brand" href={`/dashboard${c}`}><Mark />Aangan</a>
          <nav className="mainnav" aria-label="Dashboard">{nav.map(([name, href, key]) => <a key={key} href={`${href}${c}`} aria-current={key === page ? "page" : undefined}>{name}</a>)}</nav>
          <div className="tools">
            <div className="switch" role="group" aria-label="Which data">
              <a href={`${path}${carry({ ...ctx, demo: false }, { data: "live" })}`} aria-current={!ctx.demo}>Live</a>
              <a href={`${path}${carry({ ...ctx, demo: true })}`} aria-current={ctx.demo}>Demo</a>
            </div>
            <details className="period">
              <summary aria-label="Change the dates">{periodTitle(ctx.from, ctx.to)}</summary>
              <form className="periodform" method="get" action={path}>
                {ctx.demo && <input type="hidden" name="data" value="demo" />}
                <div className="row"><label>From<input type="date" name="from" defaultValue={ctx.from} /></label><label>To<input type="date" name="to" defaultValue={ctx.to} /></label></div>
                <div><button className="btn" type="submit">Show these dates</button></div>
                <div className="presets"><a href={pre(first, iso(today))}>This month</a><a href={pre(d7, iso(today))}>Last 7 days</a><a href={pre(d30, iso(today))}>Last 30 days</a></div>
              </form>
            </details>
          </div>
        </header>
        {ctx.demo && <div className="demo-strip" role="status"><b>Demo data.</b> These are made-up calls, there to show how the dashboard works. None of them is a real caller.</div>}
        {ctx.notice && <div className="notice">{ctx.notice}</div>}
        <main>{children}</main>
      </div>
    </>
  );
}

/** Full-page messages: the password screen, the locked screen, "no database". */
export function Gate({ title, children }: { title: string; children?: ReactNode }) {
  return <main className="gate"><div className="brand" style={{ marginBottom: 18 }}><Mark />Aangan</div><h1 style={{ fontSize: 26 }}>{title}</h1>{children}</main>;
}
export const PasswordGate = ({ error }: { error: boolean }) => (
  <Gate title="Owner dashboard">
    <p className="muted">Enter the dashboard password to continue.</p>
    <form method="post" action="/api/dashboard/login"><input name="password" type="password" autoComplete="current-password" aria-label="Dashboard password" placeholder="Password" required /><button className="btn" type="submit">Open</button></form>
    {error && <p role="alert" style={{ color: "var(--bad)", marginTop: 12 }}>That password did not match.</p>}
  </Gate>
);
export const LockedGate = () => <Gate title="The dashboard is locked"><p className="muted">No dashboard password has been set for this site, so nobody can open it. Set <code>DASHBOARD_PASSWORD</code> (at least 12 characters) in the site's settings and reload.</p></Gate>;
export const NoDbGate = () => <Gate title="No database is connected"><p className="muted">The dashboard reads from the database only. Set <code>LOCAL_DB_DIR</code> (a local folder) or <code>DATABASE_URL</code> (Supabase) and reload. To try it with sample calls, run <code>pnpm seed:demo</code> and press Demo.</p></Gate>;

export function gateFor(ctx: DashCtx): ReactNode | null {
  if (ctx.state === "blocked") return <LockedGate />;
  if (ctx.state === "login") return <PasswordGate error={ctx.error} />;
  if (ctx.state === "nodb") return <NoDbGate />;
  return null;
}

// ---- building blocks ---------------------------------------------------------------------------------------------------------------------------
export const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <section className="sec"><header><h2>{title}</h2>{hint && <p>{hint}</p>}</header><div>{children}</div></section>
);
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function Rank({ rows, night, more }: { rows: { key: string; count: number; note?: string; name?: string }[]; night?: boolean; more?: number }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <div className="rank">{rows.map((r) => <div key={r.key} style={{ display: "contents" }}><span className="name" title={r.name ?? label(r.key)}>{r.name ?? label(r.key)}</span><span className="bar"><i className={night ? "night" : ""} style={{ width: `${(r.count / max) * 100}%` }} /></span><span className="n">{r.count}{r.note ? <span className="muted small"> ({r.note})</span> : null}</span></div>)}</div>
      {more ? <p className="muted small" style={{ marginTop: 8 }}>and {more} more</p> : null}
    </div>
  );
}

// ---- the funnel: the one dark object ---------------------------------------------------------------------------------------------------------
type Stage = { key: string; label: string; unit: string; count: number | null; hasData: boolean; conversion: number | null };
const STATIONS: [string, string][] = [["received", "Received"], ["answered", "Answered"], ["qualified", "Qualified"], ["booked", "Booked"], ["pushed", "With a designer"], ["quoted", "Quoted"], ["won", "Won"]];
const LOSS: Record<string, (n: number) => string> = {
  answered: (n) => `${n} missed`, qualified: (n) => `${n} not taken forward`, booked: (n) => `${n} qualified, not booked`, pushed: (n) => `${n} waiting for a designer`, quoted: (n) => `${n} not quoted yet`, won: (n) => `${n} not won (yet)`,
};

export function Funnel({ stages, title, sub }: { stages: Stage[]; title: string; sub: string }) {
  const W = 1100, H = 272, padX = 72, cy = 152, maxHalf = 62;
  const get = (k: string) => stages.find((s) => s.key === k)!;
  const st = STATIONS.map(([k, l]) => ({ k, l, s: get(k) }));
  const top = Math.max(1, get("received").count ?? 1);
  const step = (W - 2 * padX) / (st.length - 1);
  const x = (i: number) => padX + i * step;
  const half = (c: number | null) => (c == null ? null : c === 0 ? 0 : Math.max((c / top) * maxHalf, 2));
  const segs = st.slice(0, -1).map((a, i) => {
    const b = st[i + 1]!, ha = half(a.s.hasData ? a.s.count : null), hb = half(b.s.hasData ? b.s.count : null);
    if (ha == null || hb == null) return null;
    const x0 = x(i), x1 = x(i + 1), m = step * 0.5;
    const d = `M${x0},${cy - ha} C${x0 + m},${cy - ha} ${x1 - m},${cy - hb} ${x1},${cy - hb} L${x1},${cy + hb} C${x1 - m},${cy + hb} ${x0 + m},${cy + ha} ${x0},${cy + ha} Z`;
    return <path key={a.k} d={d} className={`seg${b.k === "won" ? " won" : ""}`} />;
  });
  const summary = st.map((p) => `${p.l}: ${p.s.hasData ? p.s.count : "no data yet"}`).join(", ");
  return (
    <div className="funnel">
      <h2>{title}</h2>
      <p className="sub">{sub}</p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="funnel-t funnel-d">
        <title id="funnel-t">{title}</title><desc id="funnel-d">{summary}</desc>
        {segs}
        {st.map((p, i) => (
          <g key={p.k}>
            <line className="gate" x1={x(i)} x2={x(i)} y1={86} y2={218} />
            {p.s.hasData ? <text className={`fig${p.k === "won" ? " won" : ""}`} x={x(i)} y={60} textAnchor="middle">{p.s.count}</text>
              : <><rect className="dashed" x={x(i) - 28} y={cy - 30} width={56} height={60} /><text className="fig" x={x(i)} y={60} textAnchor="middle">–</text><text className="nodata" x={x(i)} y={cy + 4} textAnchor="middle">no data yet</text></>}
            <text className="stn" x={x(i)} y={240} textAnchor="middle">{p.l}</text>
            {i > 0 && p.s.hasData && st[i - 1]!.s.hasData && (st[i - 1]!.s.count ?? 0) - (p.s.count ?? 0) > 0 && LOSS[p.k] ? <text className="loss" x={(x(i) + x(i - 1)) / 2} y={262} textAnchor="middle">{LOSS[p.k]!((st[i - 1]!.s.count ?? 0) - (p.s.count ?? 0))}</text> : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---- small charts ---------------------------------------------------------------------------------------------------------------------------------
export function DaysChart({ days }: { days: { date: string; inHours: number; afterHours: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.inHours + d.afterHours));
  const mid = days[Math.floor(days.length / 2)];
  const busiest = days.reduce((m, d) => (d.inHours + d.afterHours > m.inHours + m.afterHours ? d : m), days[0]!);
  const ticks = days.length > 2 ? [days[0]!, mid!, days[days.length - 1]!] : days;
  return (
    <div>
      <div className="days" role="img" aria-label={`Calls each day. Busiest day ${busiest.date} with ${busiest.inHours + busiest.afterHours}.`}>
        {days.map((d) => <div key={d.date} className="d" title={`${d.date}: ${d.inHours} in hours, ${d.afterHours} after hours`}><div className="a" style={{ height: `${(d.afterHours / max) * 100}%` }} /><div className="i" style={{ height: `${(d.inHours / max) * 100}%` }} /></div>)}
      </div>
      <div className="axis">{ticks.map((t) => <span key={t.date}>{whenShort(`${t.date}T12:00:00+05:30`)}</span>)}</div>
      <div className="legend"><span><i style={{ background: "var(--day)" }} />During working hours</span><span><i style={{ background: "var(--night)" }} />After hours</span><span>Busiest day: {busiest.inHours + busiest.afterHours} calls</span></div>
    </div>
  );
}

export function HoursChart({ hours }: { hours: { hour: number; count: number; afterHours: number }[] }) {
  const max = Math.max(1, ...hours.map((h) => h.count));
  return (
    <div>
      <div className="hours" role="img" aria-label="Calls by hour of the day, India time">
        {hours.map((h) => <div key={h.hour} className="h" title={`${h.hour}:00 · ${h.count} calls`}><i className={h.hour < 10 || h.hour >= 19 ? "night" : ""} style={{ height: `${(h.count / max) * 100}%` }} /></div>)}
      </div>
      <div className="axis"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>11 pm</span></div>
    </div>
  );
}
