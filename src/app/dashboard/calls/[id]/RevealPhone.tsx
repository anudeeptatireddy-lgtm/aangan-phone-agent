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
      if (!r.ok) { setErr(r.status === 429 ? "Too many reveals this hour." : "Could not reveal this number."); return; }
      setPhone(((await r.json()) as { phone: string }).phone);
      setTimeout(() => setPhone(null), 30_000);
    } catch { setErr("Could not reveal this number."); } finally { setBusy(false); }
  }
  return (
    <span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{phone ?? masked}</span>{" "}
      {phone ? <button className="btn ghost" type="button" onClick={() => setPhone(null)}>Hide</button>
        : <button className="btn ghost" type="button" onClick={reveal} disabled={busy} title="This is logged">{busy ? "…" : "Reveal (logged)"}</button>}
      {err && <span style={{ color: "var(--red)", marginLeft: 8 }}>{err}</span>}
    </span>
  );
}
