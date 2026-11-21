// Attack replay (#/replay), docs/DESIGN_SYSTEM.md section 16.9. Also exports the shared helpers
// (transaction plate, live demo account, hull builder) used by Landing, Activity, Proof and Help.
import { useEffect, useState, type KeyboardEvent } from "react";
import { formatUnits, type Address } from "viem";
import { readAccount, type AccountView } from "../chain/account";
import { DEPLOYMENT, EXPLORER_TX, TOKENS } from "../chain/config";
import { HullRow, type CompartmentView } from "../ui/Hull";
import { StatusMark, type StatusKind } from "../ui/Status";
import { REPLAY_STEPS, DEMO, CLOSING_LINE, CLOSING_NOTE, type Outcome } from "../data/replay";
import "./replay.css";

const T = TOKENS.fUSD;

/** Short form of a hash, 0x1234…abcd. */
export function shortHash(h: string): string {
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

/** A transaction as a .hash plate. The whole plate is the link. Without a hash, the step is shown with no link. */
export function TxPlate({ hash, label }: { hash?: string; label?: string }) {
  if (!hash) return <span className="tx-pending">Transaction link coming</span>;
  return (
    <a className="hash tx-plate" href={`${EXPLORER_TX}${hash}`} target="_blank" rel="noreferrer"
      aria-label={`${label ?? "Transaction"} ${hash} on QoreScan, opens in a new tab`}>
      <span className="mono">{shortHash(hash)}</span>
      <span>QoreScan</span>
    </a>
  );
}

export const OUTCOME_KIND: Record<Outcome, StatusKind> = { paid: "paid", sealed: "sealed", blocked: "blocked" };

/** Reads the demo Bulkhead account, polling like the Hull screen. */
export function useDemoAccount(): { acct: AccountView | null; err: string } {
  const [acct, setAcct] = useState<AccountView | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    const load = () => readAccount(DEPLOYMENT.demoAccount as Address, T.address as Address)
      .then((a) => { if (on) { setAcct(a); setErr(""); } })
      .catch(() => { if (on) setErr("We can't reach QoreChain right now. Retrying in 5 s."); });
    load();
    const t = setInterval(load, 5000);
    return () => { on = false; clearInterval(t); };
  }, []);
  return { acct, err };
}

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface HullInput {
  everyday: number;           // fUSD
  savings: number;            // fUSD
  agent: number;              // fUSD
  everydayRadius: number | null; // fUSD the laptop key could take now, null while unknown
  everydaySealed: boolean;
  savingsSealed: boolean;
  everydayPaused?: boolean;
  everydayPausedBlocks?: number;
}

/** Builds the three compartments as one hull row (section 6). Pure: all numbers come in from the caller. */
export function hullFor(p: HullInput): CompartmentView[] {
  const max = Math.max(p.everyday, p.savings, p.agent, 1);
  const eState: CompartmentView["state"] = p.everydaySealed ? "sealed" : p.everydayPaused ? "paused" : "open";
  const sState: CompartmentView["state"] = p.savingsSealed ? "sealed" : "open";
  const radius = p.everydayRadius;
  return [
    {
      id: "everyday", name: "Everyday", unit: "fUSD", balance: money(p.everyday),
      fill: p.everyday / max,
      radius: radius === null ? "—" : money(radius),
      radiusShare: radius !== null && p.everyday > 0 ? Math.min(1, radius / p.everyday) : 0,
      state: eState,
      sentence: eState === "sealed" ? "A payment broke your walls, so nothing more can leave without your phone."
        : eState === "paused" ? `Paused by your watcher for ${p.everydayPausedBlocks ?? 0} blocks. Nothing can leave.`
        : `Up to ${money(DEMO.everydayPerPayment)} fUSD per payment.`,
      weight: Math.max(1, Math.round(p.everyday)),
    },
    {
      id: "savings", name: "Savings", unit: "fUSD", balance: money(p.savings),
      fill: p.savings / max, radius: "0.00", radiusShare: 0, state: sState,
      sentence: "Leaves only with your phone.", weight: Math.max(1, Math.round(p.savings)),
    },
    {
      id: "agent", name: "Agent", unit: "fUSD", balance: money(p.agent),
      fill: p.agent / max, radius: money(p.agent), radiusShare: p.agent > 0 ? 1 : 0, state: "open",
      sentence: `Up to ${money(DEMO.agentPerPayment)} per payment and ${money(DEMO.agentPerDay)} a day. Its own balance is the most it can take.`,
      weight: Math.max(1, Math.round(p.agent)),
    },
  ];
}

/** The replay's hull, drawn from the demo account's records. Only step 1 reads the live worst case. */
export function replayHull(sealed: boolean, liveRadius: number | null, isBefore: boolean): CompartmentView[] {
  return hullFor({
    everyday: DEMO.bulkhead - DEMO.savingsFloor,
    savings: DEMO.savingsFloor,
    agent: DEMO.agent,
    everydayRadius: isBefore ? liveRadius : sealed ? 0 : null,
    everydaySealed: sealed,
    savingsSealed: sealed,
  });
}

export function ReplayScreen() {
  const { acct, err } = useDemoAccount();
  const [i, setI] = useState(0);
  const step = REPLAY_STEPS[i];
  const last = REPLAY_STEPS.length - 1;
  const liveRadius = acct ? Number(formatUnits(acct.asset.blastRadius, T.decimals)) : null;
  const hull = replayHull(step.sealed, liveRadius, i === 0);

  function onKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowRight") { e.preventDefault(); setI((n) => Math.min(last, n + 1)); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
  }

  return (
    <div className="replay" onKeyDown={onKey}>
      <ol className="replay-progress" aria-label="Steps">
        {REPLAY_STEPS.map((s, n) => (
          <li key={s.id} aria-current={n === i ? "step" : undefined} data-done={n < i ? "true" : undefined} />
        ))}
      </ol>
      <p className="label" aria-live="polite">Step {i + 1} of {REPLAY_STEPS.length}</p>

      <section className="plate replay-card" aria-labelledby="replay-title">
        <h2 id="replay-title">{step.title}</h2>
        <p className="replay-summary">{step.summary}</p>
        {i === 0 && (
          <div className="replay-worst">
            <span className="label">If the laptop were stolen now, the most it could take</span>
            <span className="big-number replay-worst-num">
              {liveRadius === null ? (err ? "Unavailable" : "Reading…") : money(liveRadius)}
              {liveRadius !== null && <small> fUSD</small>}
            </span>
            {err && <p role="alert" className="replay-err">{err}</p>}
          </div>
        )}
      </section>

      <div className="hull-wrap">
        <HullRow compartments={hull} />
        <p className="replay-caption muted">
          The walls and the seal are from the fUSD demo account. The forged signature and the approval while sealed come from the QOR parity test, and the agent's balance is from its run.
        </p>
      </div>

      {step.results.length > 0 && (
        <section className="replay-results" aria-label={`Results for ${step.title}`}>
          <ul>
            {step.results.map((r) => (
              <li key={r.what} className="plate replay-result">
                <div className="replay-result-main">
                  <StatusMark kind={OUTCOME_KIND[r.outcome]} />
                  <span className="replay-what">{r.what}</span>
                  <span className="muted replay-detail">
                    {r.detail}
                    {r.gas !== undefined && <> Gas {r.gas.toLocaleString("en-GB")}.</>}
                  </span>
                </div>
                <TxPlate hash={r.hash} label={r.what} />
              </li>
            ))}
          </ul>
          <p className="muted replay-source">{step.source}</p>
        </section>
      )}
      {step.results.length === 0 && <p className="muted replay-source">{step.source}</p>}

      {i === last && (
        <section className="plate replay-close" aria-label="Result">
          <p className="replay-closing">{CLOSING_LINE}</p>
          <p className="muted">{CLOSING_NOTE}</p>
        </section>
      )}

      <div className="replay-nav">
        <button type="button" className="btn btn-secondary" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>
          Back
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setI((n) => Math.min(last, n + 1))} disabled={i === last}>
          Next
        </button>
      </div>
    </div>
  );
}
