// Account (docs/DESIGN_SYSTEM.md section 16): theme, recovery account and paired phone.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { pub } from "../chain/account";
import accountAbi from "../chain/abi/BulkheadAccount.json";
import { DEPLOYMENT } from "../chain/config";
import { ActionButton } from "../ui/Button";
import { actions } from "../chain/actions";
import { pairing } from "../chain/device";
import { myAccount } from "../chain/me";
import { pendingPhoneChange } from "../chain/requests";
import "./settings.css";

type Theme = "system" | "light" | "dark";
const THEME_KEY = "bh-theme";
const OPTIONS: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
const ACCOUNT = myAccount().address;
void DEPLOYMENT;
const ZERO = "0x0000000000000000000000000000000000000000";

/** Reads the saved choice. Storage can be blocked, so this falls back to System. */
function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** System removes the attribute, so the media query decides. The inline script in index.html applies the saved value. */
function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
  try {
    if (t === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    // Blocked storage: the choice still applies for this visit.
  }
}

type Recovery = { status: "loading" } | { status: "none" } | { status: "error" } | { status: "set"; address: Address };

function useRecovery(): Recovery {
  const [r, setR] = useState<Recovery>({ status: "loading" });
  useEffect(() => {
    let on = true;
    const c = { address: ACCOUNT, abi: accountAbi } as const;
    pub.readContract({ ...c, functionName: "recovery" })
      .then((a) => { if (on) setR(a === ZERO ? { status: "none" } : { status: "set", address: a as Address }); })
      .catch(() => { if (on) setR({ status: "error" }); });
    return () => { on = false; };
  }, []);
  return r;
}

function recoveryLabel(r: Recovery): string {
  switch (r.status) {
    case "loading": return "Checking the chain…";
    case "none": return "Not set yet";
    case "error": return "Can't read it right now";
    case "set": return r.address;
  }
}

export function SettingsScreen() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const recovery = useRecovery();

  function choose(t: Theme) {
    setTheme(t);
    applyTheme(t);
  }

  return (
    <div className="settings">
      <section className="plate">
        <fieldset className="theme">
          <legend>Theme</legend>
          <p className="muted small">Follows your device unless you choose.</p>
          {OPTIONS.map((o) => (
            <label key={o.id} className="radio">
              <input type="radio" name="theme" value={o.id} checked={theme === o.id} onChange={() => choose(o.id)} />
              {o.label}
            </label>
          ))}
        </fieldset>
      </section>

      <section className="plate" aria-labelledby="recovery-h">
        <h2 id="recovery-h">Recovery account</h2>
        <p className="muted">If you ever think you're hacked, everything goes here with one tap.</p>
        <p className={recovery.status === "set" ? "addr mono" : "addr"}>{recoveryLabel(recovery)}</p>
        <ActionButton
          run={async () => { throw new Error("Create your recovery account first. It is a second Bulkhead account, so a stolen laptop key can only send money to safety."); }}
        >
          Set my recovery account
        </ActionButton>
        <p className="muted small">Setting it goes to your phone and takes effect after the delay.</p>
      </section>

      <PhoneSection />
    </div>
  );
}

/** Paired phone, and what to do if it's lost (docs/DESIGN_SYSTEM.md 16.8). */
function PhoneSection() {
  const p = pairing();
  const [next, setNext] = useState("");
  const [pending, setPending] = useState<{ next: Address; readyAt: bigint; block: bigint } | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => pendingPhoneChange(ACCOUNT).then((x) => { if (on) setPending(x); }).catch(() => undefined);
    load(); const t = setInterval(load, 10_000);
    return () => { on = false; clearInterval(t); };
  }, []);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(next.trim());
  const left = pending && pending.readyAt > pending.block ? pending.readyAt - pending.block : 0n;
  const hours = Math.round((Number(left) * 1.42) / 3600);
  return (
    <section className="plate" aria-labelledby="phone-h">
      <h2 id="phone-h">Paired phone</h2>
      {p ? <p className="mono addr">{p.phoneEvm}</p> : <p>No phone paired yet</p>}
      <p className="muted small">Only your phone can widen a wall.</p>
      {!p && <a className="btn btn-primary" href="#/setup">Pair my phone</a>}

      {pending ? (
        <div className="lost" role="status">
          <h3>Replacing your phone</h3>
          <p>New phone <span className="mono">{pending.next}</span>. Your account is sealed while it waits.</p>
          {left > 0n
            ? <p>{hours > 0 ? `About ${hours} more hours.` : "Less than an hour left."} If your old phone turns up, it can stop this.</p>
            : <ActionButton run={async (step) => { await actions.confirmNewPhone(ACCOUNT, step); return "Your new phone is in charge"; }}>Switch to my new phone</ActionButton>}
          <ActionButton kind="secondary" run={async (step) => { await actions.cancelNewPhone(ACCOUNT, step); return "Stopped"; }}>Stop the replacement</ActionButton>
        </div>
      ) : p && (
        <details className="lost">
          <summary>Lost your phone?</summary>
          <p>Set up Bulkhead on a new phone, create its Safety key, then enter its address here.</p>
          <p className="muted small">Your account seals at once and the switch waits about three days, so a thief with your laptop alone can't take over. Your old phone can stop it if it turns up.</p>
          <label className="field">
            <span>New phone's address</span>
            <input className="mono" placeholder="0x" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          {next && !valid && <p role="alert" className="flood-line">That isn't a 0x address of 40 characters.</p>}
          {valid && (
            <ActionButton run={async (step) => { await actions.proposeNewPhone(ACCOUNT, next.trim() as Address, step); return "Sealed. The wait has started."; }}>
              Seal and start the switch
            </ActionButton>
          )}
        </details>
      )}
    </section>
  );
}
