// Bills (#/agent): the bill agent, made concrete.
//   1. Add a bill: who, how much, which day of the month.
//   2. Approve the payee: your phone makes the first payment from your Bulkhead account. That
//      phone-signed payment, read back from the chain, is what lets the agent pay this payee.
//   3. After that the agent pays it every month on its due day, from its own capped account.
// Pasting an invoice is the second way in: the model only reads its fields, and code decides.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { parseUnits, type Address } from "viem";
import { myAccount } from "../chain/me";
import { fmt, readTokenBalance } from "../chain/account";
import { TOKENS, EXPLORER_TX } from "../chain/config";
import { actions } from "../chain/actions";
import { changeBills, getBills, waitForPhone, type Bill, type BillBook } from "../chain/bills";
import { isUnlocked } from "../chain/wallet";
import { ActionButton } from "../ui/Button";
import { UnlockPlate } from "../ui/Unlock";
import { StatusMark } from "../ui/Status";
import "./agent.css";

const T = TOKENS.fUSD;
// The agent's own account (docs/DEPLOYMENTS.md, agent compartment). It pays only from this balance.
const AGENT_ACCOUNT = "0xbAB12dbb1de5FB86D1CA2C8B9cd0c73985A8D4A8" as Address;
const myAddr = (): Address => myAccount()!.address;
const money = (base: string | bigint) => fmt(BigInt(base), T.decimals, T.places);
const ordinal = (d: number) => d + (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");

function useBook() {
  const [book, setBook] = useState<BillBook | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => getBills(myAddr()).then((b) => { setBook(b); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  return { book, setBook, err, load };
}

export function AgentScreen() {
  const { book, setBook, err, load } = useBook();
  const [, setTick] = useState(0);
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    let on = true;
    const read = () => readTokenBalance(T.address as Address, AGENT_ACCOUNT).then((b) => on && setBalance(b)).catch(() => {});
    read(); const t = setInterval(read, 10_000);
    return () => { on = false; clearInterval(t); };
  }, []);
  const unlocked = isUnlocked();

  return (
    <div className="agent-grid">
      <section className="plate agent-how" aria-label="How the bill agent works">
        <ol>
          <li><strong>Add a bill.</strong> Who you pay, how much, and the day of the month.</li>
          <li><strong>Approve the payee on your phone.</strong> Your phone makes the first payment itself. That payment, read back from the chain, is the only thing that lets the agent pay them.</li>
          <li><strong>The agent pays it every month.</strong> On the due day, from its own account, at most {book?.rule?.perPayment ?? "10.00"} per payment and {book?.rule?.perDay ?? "25.00"} a day. The chain enforces those caps too.</li>
        </ol>
      </section>

      {!unlocked && <UnlockPlate why="Adding, approving or running bills is signed by your laptop key." onUnlocked={() => setTick((n) => n + 1)} />}

      <section aria-labelledby="bills-h" className="agent-bills">
        <h2 id="bills-h">Your bills</h2>
        {err && <p role="alert">{err}</p>}
        {!book && !err && <p className="muted" aria-busy="true">Reading your bills…</p>}
        {book && book.bills.length === 0 && <p className="muted">No bills yet. Add the first one below.</p>}
        {book && book.bills.length > 0 && (
          <ul className="decisions">
            {book.bills.map((b) => <BillRow key={b.id} bill={b} due={book.due.includes(b.id)} canSign={unlocked} onBook={setBook} />)}
          </ul>
        )}
      </section>

      {unlocked && <AddBill onBook={setBook} />}

      <section className="seams agent-status">
        <div className="plate agent-balance">
          <span className="label">Agent account</span>
          <span className="big-number agent-number">{balance === null ? "…" : money(balance)} <small>{T.symbol}</small></span>
          <p className="muted">The agent pays only from this. Your Bulkhead account stays out of its reach.</p>
        </div>
        <div className="plate agent-balance">
          <span className="label">Paid for you today</span>
          <span className="big-number agent-number">{book?.spentToday ?? "…"} <small>{T.symbol}</small></span>
          <p className="muted">Of {book?.rule?.perDay ?? "25.00"} a day.</p>
        </div>
      </section>

      <div className="agent-actions">
        {unlocked && (
          <ActionButton kind="primary" run={async (step) => {
            step("Checking which bills are due", 0.5);
            const b = await changeBills(myAddr(), { kind: "run" });
            setBook(b);
            return "Checked";
          }}>Pay due bills now</ActionButton>
        )}
        <ActionButton kind="secondary" run={async (step) => {
          await actions.requestWiden(myAddr(), { kind: "Spend", asset: T.address as Address, to: AGENT_ACCOUNT, amount: String(parseUnits("10", T.decimals)) }, step);
          return "Sent to your phone";
        }}>Top up the agent with 10.00 from my phone</ActionButton>
      </div>
      <p className="muted" style={{ fontSize: 14 }}>The agent also runs by itself once a day.</p>

      {unlocked && <PasteInvoice onBook={setBook} />}

      <section aria-labelledby="decisions-title" className="agent-decisions">
        <h2 id="decisions-title">What the agent did</h2>
        {book && book.decisions.length === 0 && <p className="muted">Nothing yet. Every payment, refusal and approval shows here, with its reason.</p>}
        {book && book.decisions.length > 0 && (
          <ul className="decisions">
            {book.decisions.slice(0, 20).map((d) => (
              <li key={d.id} className="plate decision">
                <div className="comp-head">
                  <p className="decision-payee"><strong>{d.label}</strong>{d.amount !== "0" && <> · {money(d.amount)} {T.symbol}</>}</p>
                  <StatusMark kind={d.decision === "pay" ? "paid" : d.decision === "ask-phone" ? "phone" : "blocked"} />
                </div>
                <p className="reason">{d.reason}</p>
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  {new Date(d.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  {d.txHash && <> · <a href={EXPLORER_TX + d.txHash} target="_blank" rel="noreferrer">See the transaction</a></>}
                  {d.requestId && <> · Waiting on your phone</>}
                </p>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => void load()} style={{ justifySelf: "start" }}>Refresh</button>
      </section>

      <AgentKeyPlate />
    </div>
  );
}

function BillRow({ bill, due, canSign, onBook }: { bill: Bill; due: boolean; canSign: boolean; onBook: (b: BillBook) => void }) {
  return (
    <li className="plate decision">
      <div className="comp-head">
        <p className="decision-payee"><strong>{bill.name}</strong> · {money(bill.amount)} {T.symbol}, on the {ordinal(bill.dueDay)}</p>
        <StatusMark kind={bill.approvedTx ? "holding" : "phone"} />
      </div>
      <p className="muted mono" style={{ fontSize: 13, margin: 0, overflowWrap: "anywhere" }}>{bill.payee}</p>
      <p className="reason">{bill.approvedTx ? (due ? "Due now. The agent pays it on its next run." : "Approved. The agent pays it each month.") : "Waiting for your phone to approve this payee."}</p>
      {canSign && (
        <div className="agent-secondary">
          {!bill.approvedTx && (
            <ActionButton kind="primary" run={async (step) => {
              // The phone pays the first bill from the Bulkhead account. That on-chain payment approves the payee.
              const { requestId } = await actions.requestWiden(myAddr(), { kind: "Spend", asset: T.address as Address, to: bill.payee as Address, amount: bill.amount }, step);
              const txHash = await waitForPhone(requestId, (s) => step(`Approve it on your phone (${Math.ceil(s / 60)} min left)`, 0.7));
              step("Checking the payment on QoreChain", 0.9);
              onBook(await changeBills(myAddr(), { kind: "approve", id: bill.id, txHash }));
              return "Approved";
            }}>Approve on my phone</ActionButton>
          )}
          <ActionButton kind="secondary" run={async () => { onBook(await changeBills(myAddr(), { kind: "remove", id: bill.id })); return "Removed"; }}>Remove</ActionButton>
        </div>
      )}
    </li>
  );
}

function AddBill({ onBook }: { onBook: (b: BillBook) => void }) {
  const [name, setName] = useState(""), [payee, setPayee] = useState(""), [amount, setAmount] = useState(""), [day, setDay] = useState("1");
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault(); setErr("");
    let base: bigint;
    try { base = parseUnits(amount.trim() || "x", T.decimals); } catch { setErr("Enter an amount like 5.00."); return; }
    setBusy(true);
    try {
      onBook(await changeBills(myAddr(), { kind: "add", name: name.trim(), payee: payee.trim(), amount: String(base), dueDay: Number(day) }));
      setName(""); setPayee(""); setAmount("");
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <form className="plate agent-add" onSubmit={go}>
      <h2 style={{ color: "var(--on-plate)" }}>Add a bill</h2>
      <div className="field"><label htmlFor="bill-name">Name</label>
        <input id="bill-name" className="field-input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Phone plan" /></div>
      <div className="field"><label htmlFor="bill-payee">Payee address</label>
        <input id="bill-payee" className="field-input mono" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" /></div>
      <div className="agent-add-row">
        <div className="field"><label htmlFor="bill-amount">Amount ({T.symbol})</label>
          <input id="bill-amount" className="field-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5.00" /></div>
        <div className="field"><label htmlFor="bill-day">Day of the month</label>
          <select id="bill-day" className="field-input" value={day} onChange={(e) => setDay(e.target.value)}>
            {Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>{ordinal(i + 1)}</option>)}
          </select></div>
      </div>
      {err && <p role="alert" className="field-error">{err}</p>}
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>Bills over 10.00 still get paid, but each one goes to your phone first.</p>
      <button className="btn btn-primary" type="submit" disabled={busy || !name || !payee || !amount} style={{ justifySelf: "start" }}>{busy ? "Adding…" : "Add bill"}</button>
    </form>
  );
}

function PasteInvoice({ onBook }: { onBook: (b: BillBook) => void }) {
  const [text, setText] = useState("");
  return (
    <details className="plate agent-invoice">
      <summary>Got an invoice instead? Paste it</summary>
      <p>The model only reads the payee, amount and token from it. Code decides: an approved payee within the caps gets paid, anyone else goes to your phone, and instructions hidden in the invoice are ignored.</p>
      <div className="field"><label htmlFor="inv-text">Invoice text</label>
        <textarea id="inv-text" className="field-input" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} /></div>
      <ActionButton kind="primary" run={async (step) => {
        if (!text.trim()) throw new Error("Paste the invoice text first.");
        step("Reading the invoice", 0.5);
        onBook(await changeBills(myAddr(), { kind: "run", invoices: [{ id: `inv-${Date.now()}`, text }] }));
        setText("");
        return "Done. See what the agent did below";
      }}>Hand it to the agent</ActionButton>
    </details>
  );
}

/** The agent's key is linked for a limited time. Renewing re-links the same key with the same rule. */
function AgentKeyPlate() {
  const [st, setSt] = useState<{ linked: boolean; secondsLeft: number | null } | null>(null);
  const [err, setErr] = useState("");
  const load = () => fetch("/api/agent-key").then(async (r) => { const j = await r.json().catch(() => null); if (!j) throw new Error("The agent service isn't answering right now."); if (!r.ok) throw new Error(j.error); setSt(j); setErr(""); })
    .catch((e) => setErr(e instanceof Error ? e.message : "We can't read the agent key right now."));
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, []);
  const mins = st?.secondsLeft != null ? Math.round(st.secondsLeft / 60) : null;
  return (
    <section className="plate" aria-labelledby="agent-key-h" style={{ display: "grid", gap: 10 }}>
      <h2 id="agent-key-h" style={{ color: "var(--on-plate)" }}>The agent's key</h2>
      {err ? <p role="alert">{err}</p>
        : !st ? <p className="muted">Reading the key from the chain.</p>
        : st.linked ? <p>Linked for about {mins} more minutes. When it runs out, the agent can't pay anything until it's renewed.</p>
        : <p>Not linked. The agent can't pay anything until you renew it.</p>}
      <ActionButton kind="secondary" run={async (step) => {
        step("Renewing the key on QoreChain", 0.5);
        const r = await fetch("/api/agent-key", { method: "POST" }); const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "The renewal was refused.");
        await load();
        return "Renewed for an hour";
      }}>Renew the agent's key</ActionButton>
    </section>
  );
}
