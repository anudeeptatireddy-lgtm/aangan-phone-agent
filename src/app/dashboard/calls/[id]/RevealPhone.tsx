"use client";
import { useState } from "react";

/** The only place a full phone number can appear. POST (never a link), logged server-side before the number is returned, and hidden again after 30 s. */
export function RevealPhone({ callId, masked, demo }: { callId: string; masked: string; demo: boolean }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function reveal() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/dashboard/calls/${encodeURIComponent(callId)}/reveal${demo ? "?data=demo" : ""}`, { method: "POST" });
      if (!r.ok) { setErr(r.status === 429 ? "Too many numbers shown this hour. Try again later." : "Could not show this number."); return; }
      setPhone(((await r.json()) as { phone: string }).phone);
      setTimeout(() => setPhone(null), 30_000);
    } catch { setErr("Could not show this number."); } finally { setBusy(false); }
  }
  return (
    <span>
      <span className="num phone" aria-live="polite">{phone ?? masked}</span>{" "}
      {phone ? <button className="btn quiet" type="button" onClick={() => setPhone(null)}>Hide it</button>
        : <button className="btn quiet" type="button" onClick={reveal} disabled={busy} title="Each look is logged">{busy ? "Showing…" : "Show the number"}</button>}
      {err && <span role="alert" style={{ color: "var(--bad)", marginLeft: 8 }}>{err}</span>}
    </span>
  );
}
