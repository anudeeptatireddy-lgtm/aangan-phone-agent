import type { ReactNode } from "react";
import type { DashCtx } from "./context";
import { carry } from "./context";

type Ok = Extract<DashCtx, { state: "ok" }>;

// ---- formatting --------------------------------------------------------------------------------------------------------------------------------
export const inr = (n: number | null | undefined, max = 2) => (n == null ? "n/a" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: max })}`);
export const inrShort = (n: number | null | undefined) => {
  if (n == null) return "n/a";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return inr(n, 0);
};
export const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${Math.round(x * 1000) / 10}%`);
export const when = (d: Date | string | null | undefined) => d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "—";
export const day = (d: Date | string | null | undefined) => d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—";
export const dur = (s: number | null | undefined) => (s == null ? "—" : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
export const mins = (m: number | null | undefined) => (m == null ? "n/a" : m < 1 ? "<1 min" : `${Math.round(m)} min`);
export const langName = (l: string | null | undefined) => (l === "en" ? "English" : l === "hi" ? "Hindi" : l === "mr" ? "Marathi" : l ? l : null);
export const label = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");

// ---- styles ------------------------------------------------------------------------------------------------------------------------------------
const CSS = `
.dash{--bg:#f6f7f5;--fg:#1d2420;--muted:#66706a;--card:#fff;--line:#dfe3df;--accent:#2d6a4f;--accent-soft:#d7eadf;--amber:#d99a1e;--red:#b3261e;--red-soft:#fbe4e2;--blue:#3b6ea5;--grey:#c9cfca;
  font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg);min-height:100vh;margin:0;line-height:1.4}
@media (prefers-color-scheme:dark){.dash{--bg:#121714;--fg:#e7ece8;--muted:#9aa49e;--card:#1b221e;--line:#2c3631;--accent:#58b585;--accent-soft:#1f3a2c;--amber:#e3ad3c;--red:#ff7b72;--red-soft:#3c1f1d;--blue:#79a8d8;--grey:#44504a}}
.dash *{box-sizing:border-box}.dash a{color:inherit}.dash h1{font-size:1.35rem;margin:0}.dash h2{font-size:1.05rem;margin:0 0 .6rem}.dash h3{font-size:.95rem;margin:.9rem 0 .4rem}
.wrap{max-width:1120px;margin:0 auto;padding:12px 16px 48px}
.top{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:10px 0}
.nav{display:flex;flex-wrap:wrap;gap:4px}.nav a{text-decoration:none;padding:7px 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:.9rem}.nav a[aria-current=page]{background:var(--accent);color:#fff;border-color:var(--accent)}
.bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end;margin:6px 0 14px;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.bar label{display:flex;flex-direction:column;font-size:.75rem;color:var(--muted);gap:2px}.bar input,.bar select,.f input,.f select{font:inherit;padding:7px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);min-width:0}
.btn{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}.btn.ghost{background:transparent;color:var(--fg);border-color:var(--line)}.btn.red{background:var(--red);border-color:var(--red)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.seg a{padding:7px 12px;text-decoration:none;font-size:.9rem;background:var(--card)}.seg a[aria-current=true]{background:var(--accent);color:#fff}
.presets{display:flex;gap:6px;flex-wrap:wrap}.presets a{font-size:.8rem;color:var(--muted)}
.banner{background:var(--amber);color:#1d1a10;padding:8px 12px;border-radius:10px;font-weight:600;margin:6px 0}.notice{background:var(--accent-soft);padding:8px 12px;border-radius:10px;margin:6px 0;font-size:.9rem}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.grid2{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;min-width:0}.tile{padding:12px}.tile .k{color:var(--muted);font-size:.78rem}.tile .v{font-size:1.7rem;font-weight:700;line-height:1.15;word-break:break-word}.tile .s{color:var(--muted);font-size:.78rem}
.tile.bad{border-color:var(--red);background:var(--red-soft)}.tile.bad .v{color:var(--red)}.tile.good .v{color:var(--accent)}.nodata{color:var(--muted);font-style:italic;font-weight:400;font-size:.95rem}
.sec{margin-top:18px}.muted{color:var(--muted)}.small{font-size:.8rem}.right{text-align:right}
.tbl{width:100%;border-collapse:collapse;font-size:.88rem}.tbl th{text-align:left;color:var(--muted);font-weight:600;font-size:.76rem;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.tbl td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}.tbl tr:last-child td{border-bottom:0}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.75rem;border:1px solid var(--line);white-space:nowrap}.pill.g{background:var(--accent-soft);border-color:transparent}.pill.r{background:var(--red-soft);color:var(--red);border-color:transparent}.pill.a{background:#f6e6bd;color:#4a3606;border-color:transparent}
.fun{display:grid;grid-template-columns:minmax(100px,160px) 1fr minmax(52px,auto);gap:6px 10px;align-items:center}.fun .name{font-size:.85rem}.fun .track{background:var(--bg);border-radius:6px;height:26px;position:relative;overflow:hidden}
.fun .fill{height:100%;background:var(--accent);border-radius:6px;min-width:2px}.fun .fill.nd{background:repeating-linear-gradient(45deg,var(--grey),var(--grey) 6px,transparent 6px,transparent 12px);width:100%;opacity:.55}
.fun .num{position:absolute;left:8px;top:3px;font-weight:700;font-size:.85rem;color:var(--fg);text-shadow:0 0 3px var(--card),0 0 3px var(--card)}.fun .conv{font-size:.75rem;color:var(--muted);text-align:right;white-space:nowrap}
.hb{display:grid;grid-template-columns:minmax(80px,38%) 1fr auto;gap:4px 8px;align-items:center;font-size:.85rem}.hb .t{background:var(--bg);height:12px;border-radius:6px;overflow:hidden}.hb .f{height:100%;background:var(--accent)}
.cols{display:flex;align-items:flex-end;gap:2px;height:120px}.cols .c{flex:1;min-width:2px;display:flex;flex-direction:column;justify-content:flex-end;height:100%}.cols .a{background:var(--amber)}.cols .i{background:var(--accent)}
.axis{display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-top:4px}.legend{display:flex;gap:12px;font-size:.78rem;color:var(--muted);margin-top:6px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.kv{display:grid;grid-template-columns:minmax(110px,170px) 1fr;gap:4px 12px;font-size:.9rem}.kv dt{color:var(--muted)}.kv dd{margin:0;word-break:break-word}
.tl{list-style:none;margin:0;padding:0 0 0 14px;border-left:2px solid var(--line)}.tl li{position:relative;padding:0 0 12px 10px}.tl li::before{content:"";position:absolute;left:-20px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--accent)}.tl li.warn::before{background:var(--amber)}.tl li.bad::before{background:var(--red)}
.chat p{margin:0 0 6px;padding:7px 10px;border-radius:12px;max-width:92%}.chat .agent{background:var(--accent-soft)}.chat .caller{background:var(--bg);border:1px solid var(--line);margin-left:auto}
.login{max-width:380px;margin:12vh auto;padding:0 16px}@media (max-width:560px){.tile .v{font-size:1.45rem}.wrap{padding:8px 12px 40px}.top h1{font-size:1.15rem}}
`;

export function Shell({ ctx, page, path, title, children }: { ctx: Ok; page: "overview" | "calls" | "designers" | "review"; path: string; title: string; children: ReactNode }) {
  const c = carry(ctx);
  const nav: [string, string, typeof page][] = [["Overview", "/dashboard", "overview"], ["Calls", "/dashboard/calls", "calls"], ["Designers", "/dashboard/designers", "designers"], ["Weekly review", "/dashboard/review", "review"]];
  const other = ctx.demo ? "live" : "demo";
  const other_q = carry({ ...ctx, demo: !ctx.demo });
  const today = new Date(Date.now() + 330 * 60_000), iso = (d: Date) => d.toISOString().slice(0, 10);
  const first = `${iso(today).slice(0, 7)}-01`, d7 = iso(new Date(today.getTime() - 6 * 86_400_000)), d30 = iso(new Date(today.getTime() - 29 * 86_400_000));
  const pre = (f: string, t: string) => carry({ from: f, to: t, demo: ctx.demo });
  return (
    <div className="dash">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="wrap">
        <div className="top">
          <h1>{title}</h1>
          <div className="seg" role="group" aria-label="Data">
            <a href={`${path}${carry({ ...ctx, demo: false })}`} aria-current={!ctx.demo}>Live</a>
            <a href={`${path}${other_q}`} aria-current={ctx.demo} title={`Switch to ${other} data`}>Demo</a>
          </div>
        </div>
        <nav className="nav" aria-label="Dashboard">{nav.map(([name, href, key]) => <a key={key} href={`${href}${c}`} aria-current={key === page ? "page" : undefined}>{name}</a>)}</nav>
        {ctx.demo && <div className="banner" role="status">DEMO DATA: made-up calls for showing the dashboard. None of this is a real caller.</div>}
        {ctx.notice && <div className="notice">{ctx.notice}</div>}
        <form className="bar" method="get" action={path}>
          {ctx.demo && <input type="hidden" name="data" value="demo" />}
          <label>From<input type="date" name="from" defaultValue={ctx.from} /></label>
          <label>To<input type="date" name="to" defaultValue={ctx.to} /></label>
          <button className="btn" type="submit">Apply</button>
          <span className="presets"><a href={`${path}${pre(first, iso(today))}`}>This month</a><a href={`${path}${pre(d7, iso(today))}`}>Last 7 days</a><a href={`${path}${pre(d30, iso(today))}`}>Last 30 days</a></span>
        </form>
        {children}
      </div>
    </div>
  );
}

export function LoginScreen({ error }: { error: boolean }) {
  return (
    <div className="dash"><style dangerouslySetInnerHTML={{ __html: CSS }} />
      <main className="login">
        <h1>Aangan phone agent</h1><p className="muted">Owner dashboard</p>
        <form method="post" action="/api/dashboard/login" style={{ display: "flex", gap: 8 }} className="f">
          <input name="token" type="password" placeholder="Dashboard token" autoComplete="current-password" style={{ flex: 1 }} aria-label="Dashboard token" />
          <button className="btn" type="submit">Open</button>
        </form>
        {error && <p style={{ color: "var(--red)" }}>That token did not match.</p>}
      </main>
    </div>
  );
}

export function Message({ title, body }: { title: string; body: string }) {
  return <div className="dash"><style dangerouslySetInnerHTML={{ __html: CSS }} /><main className="login"><h1>{title}</h1><p className="muted">{body}</p></main></div>;
}

// ---- building blocks ---------------------------------------------------------------------------------------------------------------------------
export function Tile({ k, v, s, tone, nodata }: { k: string; v?: string; s?: string; tone?: "bad" | "good"; nodata?: boolean }) {
  return <div className={`card tile ${tone ?? ""}`}><div className="k">{k}</div><div className="v">{nodata ? <span className="nodata">no data yet</span> : v}</div>{s && <div className="s">{s}</div>}</div>;
}
export const Card = ({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) => <section className={`card ${className}`}>{title && <h2>{title}</h2>}{children}</section>;

type Stage = { key: string; label: string; unit: string; count: number | null; hasData: boolean; conversion: number | null };
export function FunnelChart({ stages }: { stages: Stage[] }) {
  const top = Math.max(1, stages[0]?.count ?? 1);
  return (
    <div className="fun" role="img" aria-label="Funnel from calls received to won">
      {stages.map((s) => (
        <div key={s.key} style={{ display: "contents" }}>
          <div className="name">{s.label}<div className="muted small">{s.unit}</div></div>
          <div className="track">
            {s.hasData ? <div className="fill" style={{ width: `${Math.max(((s.count ?? 0) / top) * 100, s.count ? 1 : 0)}%` }} /> : <div className="fill nd" />}
            <span className="num">{s.hasData ? s.count : "no data yet"}</span>
          </div>
          <div className="conv">{s.conversion != null ? `${pct(s.conversion)}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

export function DailyChart({ days }: { days: { date: string; inHours: number; afterHours: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.inHours + d.afterHours));
  const ticks = days.length > 1 ? [days[0]!, days[Math.floor(days.length / 2)]!, days[days.length - 1]!] : days;
  return (
    <div>
      <div className="cols" role="img" aria-label="Calls per day, in hours and after hours">
        {days.map((d) => (
          <div key={d.date} className="c" title={`${d.date}: ${d.inHours} in hours, ${d.afterHours} after hours`}>
            <div className="a" style={{ height: `${(d.afterHours / max) * 100}%` }} /><div className="i" style={{ height: `${(d.inHours / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="axis">{ticks.map((t) => <span key={t.date}>{t.date.slice(5)}</span>)}</div>
      <div className="legend"><span><i style={{ background: "var(--accent)" }} />In hours</span><span><i style={{ background: "var(--amber)" }} />After hours</span></div>
    </div>
  );
}

export function HourChart({ hours }: { hours: { hour: number; count: number; afterHours: number }[] }) {
  const max = Math.max(1, ...hours.map((h) => h.count));
  return (
    <div>
      <div className="cols" style={{ height: 90 }} role="img" aria-label="Calls by hour of day">
        {hours.map((h) => <div key={h.hour} className="c" title={`${h.hour}:00 · ${h.count} calls (${h.afterHours} after hours)`}><div className={h.afterHours ? "a" : "i"} style={{ height: `${(h.count / max) * 100}%` }} /></div>)}
      </div>
      <div className="axis"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div>
    </div>
  );
}

export function HBars({ rows, empty = "Nothing in this period." }: { rows: { key: string; count: number; extra?: string }[]; empty?: string }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return <div className="hb">{rows.map((r) => <div key={r.key} style={{ display: "contents" }}><span title={r.key} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(r.key)}</span><span className="t"><span className="f" style={{ display: "block", width: `${(r.count / max) * 100}%` }} /></span><span>{r.count}{r.extra ? <span className="muted small"> {r.extra}</span> : null}</span></div>)}</div>;
}
export const Pill = ({ children, tone }: { children: ReactNode; tone?: "g" | "r" | "a" }) => <span className={`pill ${tone ?? ""}`}>{children}</span>;
export const outcomeTone = (o: string | null) => (o === "booked" ? "g" : o === "escalated" || o === "missed" ? "r" : o === "review" ? "a" : undefined);
