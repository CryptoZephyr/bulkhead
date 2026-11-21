// Pay (section 16.4): send money without breaking a wall by accident.
// The live check is deterministic code from the account's real policy and blast radius.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { readAccount, fmt, type AccountView } from "../chain/account";
import { DEPLOYMENT, EXPLORER_TX, TOKENS } from "../chain/config";
import { actions } from "../chain/actions";
import { ActionButton } from "../ui/Button";
import { StatusMark } from "../ui/Status";
import "./pay.css";

const T = TOKENS.fUSD;
const ACCOUNT = DEPLOYMENT.demoAccount as Address;
const ASSET = T.address as Address;
const UNIT = 10n ** BigInt(T.decimals);
const CENT = UNIT / 100n;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const RECENT_LIMIT = 3;

const money = (v: bigint) => fmt(v, T.decimals, T.places);

/** Parses a typed fUSD amount to base units. Returns an error text when it is not a usable amount. */
export function parseFusd(text: string): { value: bigint | null; error: string } {
  const t = text.trim();
  if (t === "") return { value: null, error: "" };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { value: null, error: "Enter an amount like 5 or 5.25, with up to 2 decimals." };
  const [whole, frac = ""] = t.split(".");
  const value = BigInt(whole) * UNIT + BigInt((frac + "00").slice(0, 2)) * CENT;
  if (value <= 0n) return { value: null, error: "Enter an amount above 0." };
  return { value, error: "" };
}

/** Groups 0x and the 40 hex characters in blocks of four, as typed. */
export function groupAddress(a: string): string {
  const hex = a.trim().replace(/^0x/i, "");
  if (hex === "") return "";
  return `0x ${hex.match(/.{1,4}/g)?.join(" ") ?? ""}`;
}

/** Everyday is the balance above the Savings floor. */
export function everydayOf(a: AccountView): bigint {
  const bal = a.asset.balance, floor = a.asset.floor;
  return bal > floor ? bal - floor : 0n;
}

export type Check =
  | { inside: true }
  | { inside: false; reason: string };

/** Deterministic check, in the order the chain enforces: state, floor, per payment, rest of today. */
export function checkPayment(a: AccountView, amount: bigint): Check {
  if (a.sealed) return { inside: false, reason: "Everyday is sealed. Only your phone can open it." };
  if (a.block < a.throttledUntil) return { inside: false, reason: `Your watcher has paused Everyday for ${a.throttledUntil - a.block} blocks.` };
  if (amount > everydayOf(a)) return { inside: false, reason: `This would take Everyday below its Savings floor, so it needs your phone.` };
  if (amount > a.asset.perTxCap) return { inside: false, reason: `This is over your ${money(a.asset.perTxCap)} per-payment limit, so it needs your phone.` };
  if (amount > a.asset.blastRadius) return { inside: false, reason: `Only ${money(a.asset.blastRadius)} can leave today, so this needs your phone.` };
  return { inside: true };
}

function shortHash(h: string) {
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export function PayScreen() {
  const [acct, setAcct] = useState<AccountView | null>(null);
  const [err, setErr] = useState("");
  const [to, setTo] = useState("");
  const [touched, setTouched] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ to: string; amount: bigint; txHash: string } | null>(null);

  useEffect(() => {
    let on = true;
    const load = () => readAccount(ACCOUNT, ASSET)
      .then((a) => { if (on) { setAcct(a); setErr(""); } })
      .catch(() => on && setErr("We can't reach QoreChain right now. Payments are paused until we can check your walls."));
    load();
    const t = setInterval(load, 5000);
    return () => { on = false; clearInterval(t); };
  }, []);

  const payee = to.trim();
  const addrValid = ADDRESS_RE.test(payee);
  const addrError = touched && payee !== "" && !addrValid
    ? "An address starts with 0x and has 40 letters or numbers, 0 to 9 and a to f."
    : "";
  const amount = parseFusd(amountText);
  const amt = amount.value;
  const check = acct && amt !== null ? checkPayment(acct, amt) : null;
  const isRecent = recent.includes(payee);

  return (
    <div className="pay-grid">
      <section className="plate pay-form" aria-label="Payment">
        <div className="pay-from">
          <span className="label">Paying from</span>
          <strong>Everyday</strong>
          <span className="muted">
            {acct ? `Holds ${money(everydayOf(acct))} ${T.symbol}. Savings is not used.` : "Reading your balance..."}
          </span>
        </div>

        <div className="field">
          <label htmlFor="pay-to">Payee address</label>
          <input
            id="pay-to"
            className="field-input mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={() => setTouched(true)}
            autoComplete="off"
            spellCheck={false}
            placeholder="0x"
            aria-invalid={addrError !== ""}
            aria-describedby="pay-to-group"
          />
          <p id="pay-to-group" className="group mono">{groupAddress(payee)}</p>
          {addrError && <p role="alert" className="field-error">{addrError}</p>}
          {addrValid && !isRecent && <p className="note">First payment to this address.</p>}
          {recent.length > 0 && (
            <div className="recent">
              <span className="label">Recent payees</span>
              <div className="recent-list">
                {recent.map((r) => (
                  <button key={r} type="button" className="chip mono" onClick={() => setTo(r)} aria-label={`Use payee ${groupAddress(r)}`}>
                    {shortHash(r)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="pay-amount">Amount</label>
          <div className="amount-row">
            <input
              id="pay-amount"
              className="field-input"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              autoComplete="off"
              placeholder="0.00"
              aria-invalid={amount.error !== ""}
            />
            <span className="unit">{T.symbol}</span>
          </div>
          {amount.error && <p role="alert" className="field-error">{amount.error}</p>}
        </div>

        <div className="check" aria-live="polite">
          {!acct && !err && <span className="muted">Checking your walls...</span>}
          {acct && check === null && <span className="muted">Enter a payee and an amount to check it against your walls.</span>}
          {check?.inside && (
            <>
              <span className="check-ok"><StatusMark kind="paid" word="Inside your walls" /></span>
              <span className="muted">Everyday covers this payment.</span>
            </>
          )}
          {check && !check.inside && (
            <>
              <span className="check-phone"><StatusMark kind="phone" word="Needs your phone" /></span>
              <span>{check.reason}</span>
            </>
          )}
        </div>

        {acct && addrValid && amt !== null && check?.inside && (
          <ActionButton
            key="pay"
            block
            run={async (step) => {
              const r = await actions.pay(ACCOUNT, ASSET, payee as Address, amt, step);
              setReceipt({ to: payee, amount: amt, txHash: r.txHash });
              setRecent((list) => [payee, ...list.filter((x) => x !== payee)].slice(0, RECENT_LIMIT));
              return "Paid";
            }}
          >
            Pay
          </ActionButton>
        )}
        {acct && addrValid && amt !== null && check && !check.inside && (
          <ActionButton
            key="ask"
            block
            run={async (step) => {
              await actions.requestWiden(ACCOUNT, { kind: "Spend", asset: TOKENS.fUSD.address, to: payee as `0x${string}`, amount: String(amt) }, step);
              return "Sent to your phone";
            }}
          >
            Ask my phone
          </ActionButton>
        )}
        {err && <p role="alert" className="field-error">{err}</p>}
      </section>

      {receipt && (
        <section className="plate receipt" aria-live="polite" aria-label="Receipt">
          <span className="label">Paid</span>
          <strong className="receipt-amount">{money(receipt.amount)} {T.symbol}</strong>
          <span className="group mono">To {groupAddress(receipt.to)}</span>
          <a className="hash" href={`${EXPLORER_TX}${receipt.txHash}`} target="_blank" rel="noreferrer">
            <span className="mono">{shortHash(receipt.txHash)}</span>QoreScan
          </a>
        </section>
      )}
    </div>
  );
}
