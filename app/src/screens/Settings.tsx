// Account (docs/DESIGN_SYSTEM.md section 16): theme, recovery account and paired phone.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { pub } from "../chain/account";
import accountAbi from "../chain/abi/BulkheadAccount.json";
import { actions } from "../chain/actions";
import { DEPLOYMENT } from "../chain/config";
import { ActionButton } from "../ui/Button";
import "./settings.css";

type Theme = "system" | "light" | "dark";
const THEME_KEY = "bh-theme";
const OPTIONS: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
const ACCOUNT = DEPLOYMENT.demoAccount as Address;
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
          run={(step) => actions.requestWiden(ACCOUNT, "SetRecovery", { recovery: recovery.status === "set" ? recovery.address : null }, step)
            .then(() => "Sent to your phone")}
        >
          Set my recovery account
        </ActionButton>
        <p className="muted small">Setting it goes to your phone and takes effect after the delay.</p>
      </section>

      <section className="plate" aria-labelledby="phone-h">
        <h2 id="phone-h">Paired phone</h2>
        <p>No phone paired yet</p>
        <p className="muted small">Only your phone can widen a wall.</p>
        <a className="btn btn-primary" href="#/phone">Pair my phone</a>
      </section>
    </div>
  );
}
