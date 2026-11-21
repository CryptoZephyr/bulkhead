// App shell (section 11): top bar with a live network readout, left rail, screen, footer.
import { useEffect, useState, type ReactNode } from "react";
import { Lockup, Mark } from "./Mark";
import { pub } from "../chain/account";
import "./shell.css";

export const NAV = [
  { id: "hull", label: "Hull" },
  { id: "pay", label: "Pay" },
  { id: "activity", label: "Activity" },
] as const;

function useBlock() {
  const [block, setBlock] = useState<bigint | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    let on = true;
    const tick = () => pub.getBlockNumber().then((b) => { if (on) { setBlock(b); setDown(false); } }).catch(() => on && setDown(true));
    tick(); const t = setInterval(tick, 5000);
    return () => { on = false; clearInterval(t); };
  }, []);
  return { block, down };
}

export function NetworkReadout() {
  const { block, down } = useBlock();
  return (
    <span className="readout" aria-live="off">
      <span className={`dot ${down ? "down" : ""}`} aria-hidden="true" />
      QoreChain testnet{block !== null && !down ? `, block ${block.toLocaleString("en-GB")}` : down ? ", reconnecting" : ""}
    </span>
  );
}

export function Shell({ route, children, title, sentence }: { route: string; children: ReactNode; title: string; sentence: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="page topbar-in">
          <a href="#/hull" aria-label="Bulkhead home" style={{ color: "var(--on-plate)" }}><Lockup size={26} /></a>
          <NetworkReadout />
          <a className="account" href="#/settings">Account</a>
        </div>
      </header>
      <div className="page body">
        <nav className="rail" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.id} href={`#/${n.id}`} aria-current={route === n.id ? "page" : undefined}>{n.label}</a>
          ))}
        </nav>
        <main className="screen" id="main">
          <div className="screen-head">
            <h1>{title}</h1>
            <p className="muted" aria-live="polite">{sentence}</p>
          </div>
          {children}
        </main>
      </div>
      <FooterRow />
    </div>
  );
}

export function FooterRow() {
  return (
    <footer className="foot-row">
      <div className="page foot-row-in">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 850 }}><Mark size={24} />Bulkhead</span>
        <nav aria-label="Footer" className="foot-links">
          <a href="#/hull">Hull</a><a href="#/pay">Pay</a><a href="#/activity">Activity</a>
          <a href="#/help">How it works</a><a href="#/help">Help</a><a href="#/proof">Contracts and proof</a>
          <a href="https://github.com/CryptoZephyr/bulkhead">Source code</a>
        </nav>
        <p className="foot-legal">QoreChain testnet. Use test funds only. © 2026 Bulkhead</p>
      </div>
    </footer>
  );
}

/** The full hero footer (section 12), on the landing page and Help only. */
export function HeroFooter({ worstCase, cta }: { worstCase: string; cta: ReactNode }) {
  return (
    <div className="hero-foot">
      <div className="page hero-foot-in">
        <h2>Damage stays where it starts.</h2>
        <p className="lead">Watertight walls inside your money. Only the post-quantum key on your phone can move a wall.</p>
        <div className="hero-act">{cta}<p aria-live="polite">Right now the most anyone could take: <strong>{worstCase}</strong></p></div>
      </div>
    </div>
  );
}
