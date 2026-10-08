"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Two buttons per call. Locally there is no login, so no name is asked for and the review is recorded as "local user"; behind the password the reviewer types a name once (self-declared). */
export function ReviewActions({ callId, demo, critical, state, local }: { callId: string; demo: boolean; critical: boolean; state: "open" | "confirmed" | "overturned"; local: boolean }) {
  const router = useRouter();
  const [reviewer, setReviewer] = useState("");
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!local) try { setReviewer(localStorage.getItem("aangan_reviewer") ?? ""); } catch { /* private window: fine */ } }, [local]);

  async function send(overturned: boolean) {
    if (!local && !reviewer.trim()) { setErr("Type your name first."); return; }
    if (overturned && critical && !reason.trim()) { setAsking(true); setErr("Say briefly what the agent should have done."); return; }
    setBusy(true); setErr(null);
    try {
      if (!local) try { localStorage.setItem("aangan_reviewer", reviewer.trim()); } catch { /* ignore */ }
      const r = await fetch(`/api/dashboard/review${demo ? "?data=demo" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callId, overturned, reason: reason.trim() || undefined, reviewer: local ? undefined : reviewer.trim() }) });
      if (!r.ok) { setErr("Could not save that. Try again."); return; }
      setAsking(false); router.refresh();
    } catch { setErr("Could not save that. Try again."); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="acts">
        {!local && <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name" aria-label="Your name" style={{ width: 120 }} />}
        <button className="btn quiet" type="button" disabled={busy} onClick={() => send(false)}>{state === "confirmed" ? "Agent was right ✓" : "Agent was right"}</button>
        <button className="btn danger" type="button" disabled={busy} onClick={() => (asking || !critical ? send(true) : (setAsking(true), setErr("Say briefly what the agent should have done.")))}>{state === "overturned" ? "Overturned ✓" : "Overturn"}</button>
      </div>
      {asking && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What should it have done?" aria-label="Why it is being overturned" style={{ width: "100%", marginTop: 8 }} />}
      {err && <p role="alert" style={{ color: "var(--bad)", margin: "6px 0 0", fontSize: 13 }}>{err}</p>}
    </div>
  );
}
