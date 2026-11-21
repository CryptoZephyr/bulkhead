// Landing (#/landing), docs/DESIGN_SYSTEM.md section 16.1. Rendered without the app Shell, so it has its own top bar.
import { useEffect, useState, type KeyboardEvent } from "react";
import { formatUnits } from "viem";
import { Lockup } from "../ui/Mark";
import { NetworkReadout, FooterRow, HeroFooter } from "../ui/Shell";
import { HullRow } from "../ui/Hull";
import { StatusMark } from "../ui/Status";
import { REPLAY_STEPS, DEMO, CLOSING_LINE } from "../data/replay";
import { TOKENS } from "../chain/config";
import { OUTCOME_KIND, TxPlate, hullFor, useDemoAccount } from "./Replay";
import "./landing.css";

const T = TOKENS.fUSD;
const INTERVAL_MS = 3000;

function prefersReducedMotion(): boolean {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** The replay preview: auto-advances every 3 s, paused under reduced motion, keyboard Back and Next. */
function ReplayPreview() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const last = REPLAY_STEPS.length - 1;
  const step = REPLAY_STEPS[i];
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setI((n) => (n >= last ? 0 : n + 1)), INTERVAL_MS);
    return () => clearTimeout(t);
  }, [i, playing, last]);

  function onKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowRight") { e.preventDefault(); setI((n) => Math.min(last, n + 1)); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
  }

  // Hull for the preview, drawn from the demo records (the same numbers as the replay).
  const hull = hullFor({
    everyday: DEMO.bulkhead - DEMO.savingsFloor,
    savings: DEMO.savingsFloor,
    agent: DEMO.agent,
    everydayRadius: step.sealed ? 0 : null,
    everydaySealed: step.sealed,
    savingsSealed: step.sealed,
  });

  return (
    <section className="plate landing-replay" aria-label="Attack replay, live" onKeyDown={onKey}>
      <div className="landing-replay-top">
        <span className="label" aria-live="polite">Attack replay · step {i + 1} of {REPLAY_STEPS.length}</span>
        <div className="replay-controls">
          <button type="button" className="ctl" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}>Back</button>
          <button type="button" className="ctl" onClick={() => setPlaying((p) => !p)}>
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="ctl" onClick={() => setI((n) => Math.min(last, n + 1))} disabled={i === last}>Next</button>
        </div>
      </div>
      <h2 className="landing-step-title">{step.title}</h2>
      <p className="muted landing-step-sum">{step.summary}</p>
      <HullRow compartments={hull} />
      <ul className="landing-results">
        {step.results.length === 0 && <li className="muted">The walls hold. Nothing has been tried yet.</li>}
        {step.results.map((r) => (
          <li key={r.what} className="landing-result">
            <StatusMark kind={OUTCOME_KIND[r.outcome]} />
            <span className="landing-what">{r.what}</span>
            <TxPlate hash={r.hash} label={r.what} />
          </li>
        ))}
      </ul>
      {i === last && <p className="landing-closing">{CLOSING_LINE}</p>}
    </section>
  );
}

/** The three compartments with the demo account's real numbers (read like the Hull screen). */
function HowTheWallsWork() {
  const { acct, err } = useDemoAccount();
  if (!acct) {
    return (
      <div className="plate landing-how-wait" aria-busy={!err}>
        <p className="muted">{err || "Reading the demo account from QoreChain…"}</p>
      </div>
    );
  }
  const bal = Number(formatUnits(acct.asset.balance, T.decimals));
  const floor = Number(formatUnits(acct.asset.floor, T.decimals));
  const radius = Number(formatUnits(acct.asset.blastRadius, T.decimals));
  const everyday = Math.max(0, bal - floor);
  const savings = Math.min(bal, floor);
  const hull = hullFor({
    everyday, savings, agent: DEMO.agent,
    everydayRadius: acct.sealed ? 0 : radius,
    everydaySealed: acct.sealed,
    savingsSealed: acct.sealed,
    everydayPaused: !acct.sealed && acct.block < acct.throttledUntil,
    everydayPausedBlocks: Number(acct.throttledUntil - acct.block),
  });
  return (
    <>
      <HullRow compartments={hull} />
      <p className="muted landing-how-note">
        Everyday is what your laptop key can spend inside its walls. Savings leaves only with your phone.
        Agent is the bill agent's own account, with its own limits. Balances are the demo account's, read from QoreChain.
      </p>
    </>
  );
}

export function LandingScreen() {
  const { acct } = useDemoAccount();
  const worst = acct ? `${Number(formatUnits(acct.asset.blastRadius, T.decimals)).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${T.symbol}` : "reading from QoreChain…";
  return (
    <div className="landing">
      <header className="topbar landing-top">
        <div className="page topbar-in">
          <a href="#/landing" aria-label="Bulkhead home" className="landing-brand"><Lockup size={26} /></a>
          <NetworkReadout />
          <a className="account" href="#/hull">Open the app</a>
        </div>
      </header>

      <main className="page landing-main" id="main">
        <h1 className="landing-hero">Watertight walls inside your money.</h1>
        <ReplayPreview />
        <div className="landing-cta">
          <a className="btn btn-primary" href="#/hull">Create my Bulkhead</a>
        </div>

        <section className="landing-how" aria-labelledby="how-h">
          <h2 id="how-h">How the walls work</h2>
          <p className="muted">Three compartments, one hull. Each has its own key and its own walls.</p>
          <HowTheWallsWork />
        </section>
      </main>

      <HeroFooter worstCase={worst} cta={<a className="btn btn-primary" href="#/hull">Create my Bulkhead</a>} />
      <FooterRow />
    </div>
  );
}
