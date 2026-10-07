"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Confirm / Overturn for one call. The reviewer's name is typed once and remembered in this browser; there is one shared login, so it is self-declared. */
export function ReviewActions({ callId, demo, critical, state }: { callId: string; demo: boolean; critical: boolean; state: "open" | "confirmed" | "overturned" }) {
  const router = useRouter();
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { try { setReviewer(localStorage.getItem("aangan_reviewer") ?? ""); } catch { /* private window: fine */ } }, []);

  async function send(overturned: boolean) {
    if (!reviewer.trim()) { setErr("Type your name first."); return; }
    if (overturned && critical && !reason.trim()) { setAsking(true); setErr("Say briefly why."); return; }
    setBusy(true); setErr(null);
    try {
      try { localStorage.setItem("aangan_reviewer", reviewer.trim()); } catch { /* ignore */ }
      const r = await fetch(`/api/dashboard/review${demo ? "?data=demo" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callId, overturned, reason: reason.trim() || undefined, reviewer: reviewer.trim() }) });
      if (!r.ok) { setErr("Could not save."); return; }
      setAsking(false); router.refresh();
    } catch { setErr("Could not save."); } finally { setBusy(false); }
  }
  return (
    <div className="f" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
      <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name" aria-label="Your name" style={{ width: 120 }} />
      <button className="btn ghost" type="button" disabled={busy} onClick={() => send(false)}>{state === "confirmed" ? "✓ Agent was right" : "Agent was right"}</button>
      <button className="btn red" type="button" disabled={busy} onClick={() => (asking || !critical ? send(true) : (setAsking(true), setErr("Say briefly why.")))}>{state === "overturned" ? "Overturned ✓" : "Overturn"}</button>
      {asking && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (e.g. should have escalated)" aria-label="Reason" style={{ flex: 1, minWidth: 180 }} />}
      {err && <span style={{ color: "var(--red)" }}>{err}</span>}
    </div>
  );
}
