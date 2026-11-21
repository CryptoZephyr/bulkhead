// Walls (section 16.5): change the walls with full understanding of what changes.
// Tightening is one action. Any widening goes to the phone and names the delay.
import { myAccount } from "../chain/me";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { readAccount, fmt, type AccountView } from "../chain/account";
import { TOKENS } from "../chain/config";
import { actions } from "../chain/actions";
import { ActionButton } from "../ui/Button";
import { StatusMark } from "../ui/Status";
import "./walls.css";

const T = TOKENS.fUSD;
// The user's own account. App screens render only once setup has created one.
const myAddr = (): Address => myAccount()!.address;
const ASSET = T.address as Address;
const UNIT = 10n ** BigInt(T.decimals);
const CENT = UNIT / 100n;

interface Policy { perTxCap: bigint; periodCap: bigint; floor: bigint }
type Key = keyof Policy;
type Form = Record<Key, string>;
const KEYS: Key[] = ["perTxCap", "periodCap", "floor"];

const LABEL: Record<Key, string> = { perTxCap: "Most per payment", periodCap: "Most per day", floor: "Savings floor" };
const money = (v: bigint) => fmt(v, T.decimals, T.places);
const toInput = (v: bigint) => `${v / UNIT}.${((v % UNIT) / CENT).toString().padStart(2, "0")}`;

/** Parses a typed fUSD amount to base units, or null when it is not one. */
function parse(text: string): bigint | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole) * UNIT + BigInt((frac + "00").slice(0, 2)) * CENT;
}

/** Everyday is the balance above the Savings floor. */
function everydayOf(bal: bigint, floor: bigint): bigint {
  return bal > floor ? bal - floor : 0n;
}

/** Worst case for a day: the smaller of the daily cap and what Everyday holds. Deterministic, from chain state. */
export function worstCaseOf(bal: bigint, p: Policy): bigint {
  const e = everydayOf(bal, p.floor);
  return p.periodCap < e ? p.periodCap : e;
}

/** A higher floor keeps more in Savings, so it is tighter. Caps go down when tightening. */
function direction(k: Key, now: bigint, next: bigint): "same" | "tighter" | "wider" {
  if (next === now) return "same";
  if (k === "floor") return next > now ? "tighter" : "wider";
  return next < now ? "tighter" : "wider";
}

const HINT: Record<Key, (v: bigint) => string> = {
  perTxCap: (v) => `The most anyone could take per payment: ${money(v)} ${T.symbol}.`,
  periodCap: (v) => `The most anyone could take in a day: ${money(v)} ${T.symbol}.`,
  floor: (v) => `Savings keeps ${money(v)} ${T.symbol}. Everyday can't spend it.`,
};

export function WallsScreen() {
  const [acct, setAcct] = useState<AccountView | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    let on = true;
    const load = () => readAccount(myAddr(), ASSET)
      .then((a) => { if (on) { setAcct(a); setErr(""); } })
      .catch(() => on && setErr("We can't reach QoreChain right now. Your walls hold on chain without us."));
    load();
    const t = setInterval(load, 5000);
    return () => { on = false; clearInterval(t); };
  }, []);

  if (!acct) {
    return (
      <div className="plate" aria-busy={!err}>
        {err ? <p role="alert" className="field-error">{err}</p> : <p className="muted">Reading your walls from the chain...</p>}
      </div>
    );
  }

  const bal = acct.asset.balance;
  const now: Policy = { perTxCap: acct.asset.perTxCap, periodCap: acct.asset.periodCap, floor: acct.asset.floor };
  const chainForm: Form = { perTxCap: toInput(now.perTxCap), periodCap: toInput(now.periodCap), floor: toInput(now.floor) };
  const shown = form ?? chainForm;

  const parsed: Record<Key, bigint | null> = { perTxCap: parse(shown.perTxCap), periodCap: parse(shown.periodCap), floor: parse(shown.floor) };
  const next: Policy | null = parsed.perTxCap !== null && parsed.periodCap !== null && parsed.floor !== null
    ? { perTxCap: parsed.perTxCap, periodCap: parsed.periodCap, floor: parsed.floor }
    : null;
  const changed = next ? KEYS.filter((k) => direction(k, now[k], next[k]) !== "same") : [];
  const wider = next ? KEYS.filter((k) => direction(k, now[k], next[k]) === "wider") : [];

  return (
    <div className="walls-grid">
      <section className="plate walls-now" aria-label="Everyday now">
        <span className="label">Everyday now</span>
        <p>Up to {money(now.perTxCap)} {T.symbol} per payment and {money(now.periodCap)} a day.</p>
        <p>Savings keeps at least {money(now.floor)} {T.symbol}. Everyday can't spend it.</p>
        <p>Worst case today: <strong>{money(worstCaseOf(bal, now))} {T.symbol} a day</strong></p>
        {acct.sealed && <p>Everything is sealed. Nothing leaves until your phone unseals it.</p>}
      </section>

      <section className="plate">
        <fieldset className="walls-fields">
          <legend>Change Everyday</legend>
          {KEYS.map((k) => {
            const v = parsed[k];
            return (
              <div className="field" key={k}>
                <label htmlFor={`w-${k}`}>{LABEL[k]} ({T.symbol})</label>
                <div className="amount-row">
                  <input
                    id={`w-${k}`}
                    className="field-input"
                    inputMode="decimal"
                    autoComplete="off"
                    value={shown[k]}
                    onChange={(e) => setForm({ ...shown, [k]: e.target.value })}
                    aria-invalid={v === null}
                    aria-describedby={`w-${k}-hint`}
                  />
                  <span className="unit">{T.symbol}</span>
                </div>
                {v !== null
                  ? <p id={`w-${k}-hint`} className="hint">{HINT[k](v)}</p>
                  : <p id={`w-${k}-hint`} role="alert" className="field-error">Enter an amount like 5 or 5.25, with up to 2 decimals.</p>}
              </div>
            );
          })}
        </fieldset>
      </section>

      <section className="plate walls-change" aria-live="polite" aria-label="Effect of this change">
        {!next && <p>Fix the amounts above to see what this does.</p>}
        {next && changed.length === 0 && <p className="muted">No change yet. Everyday is set as it is on chain.</p>}
        {next && changed.length > 0 && (
          <>
            <p className="worst">
              Your worst case goes from <strong>{money(worstCaseOf(bal, now))}</strong> to <strong>{money(worstCaseOf(bal, next))}</strong> {T.symbol} a day.
            </p>
            {wider.length === 0 ? (
              <>
                <p>Tightening is instant. It needs no phone.</p>
                <ActionButton
                  key="tighten"
                  kind="primary"
                  block
                  onDone={() => setForm(null)}
                  run={async (step) => {
                    await actions.tighten(myAddr(), ASSET, next, step);
                    return "Tightened";
                  }}
                >
                  Tighten now
                </ActionButton>
              </>
            ) : (
              <>
                <span className="phone-line"><StatusMark kind="phone" /></span>
                <p>Takes effect about an hour after your phone approves. Any tighten cancels it.</p>
                {changed.length > wider.length && <p className="muted">Tighter values in this change wait for your phone too.</p>}
                <ActionButton
                  key="phone"
                  kind="primary"
                  block
                  run={async (step) => {
                    await actions.requestWiden(myAddr(), { kind: "SetPolicy", asset: TOKENS.fUSD.address, perTxCap: String(next.perTxCap), periodCap: String(next.periodCap), floor: String(next.floor) }, step);
                    return "Sent to your phone";
                  }}
                >
                  Send to my phone
                </ActionButton>
              </>
            )}
          </>
        )}
      </section>

      <section className="seal" aria-label="Seal everything">
        <p className="muted">Sealing stops every payment now, and only your phone can open it again. Tightening is always safe.</p>
        <ActionButton
          kind="secondary"
          run={async (step) => {
            await actions.seal(myAddr(), step);
            return "Sealed";
          }}
        >
          Seal everything
        </ActionButton>
      </section>

      {err && <p role="alert" className="field-error">{err}</p>}
    </div>
  );
}
