// Asks for the laptop key's password when a screen needs to sign and the key is locked (after a reload).
import { useState, type FormEvent } from "react";
import { isUnlocked, unlock } from "../chain/wallet";

export function UnlockPlate({ why, onUnlocked }: { why: string; onUnlocked: () => void }) {
  const [pw, setPw] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  if (isUnlocked()) return null;
  async function go(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await unlock(pw); setPw(""); onUnlocked(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="plate" onSubmit={go} style={{ display: "grid", gap: 10 }}>
      <h2 style={{ color: "var(--on-plate)" }}>Unlock your laptop key</h2>
      <p>{why}</p>
      <div className="field">
        <label htmlFor="unlock-pw">Password</label>
        <input id="unlock-pw" className="field-input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <p role="alert" className="field-error">{err}</p>}
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy || !pw} style={{ justifySelf: "start" }}>{busy ? "Unlocking…" : "Unlock"}</button>
    </form>
  );
}
