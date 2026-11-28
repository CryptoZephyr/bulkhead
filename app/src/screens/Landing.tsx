// Landing, docs/DESIGN_SYSTEM.md 16.1. No demo account and no example numbers: it explains the product
// and sends people to the two real starting points (laptop setup, phone setup).
import { Lockup, Mark } from "../ui/Mark";
import { NetworkReadout, FooterRow } from "../ui/Shell";
import { StatusMark } from "../ui/Status";
import "./landing.css";

const WALLS = [
  { name: "Everyday", status: "holding" as const, line: "Spend freely from your laptop, inside the caps you choose: so much per payment, so much a day.",
    worst: "If your laptop is stolen, the thief can take at most what's left of today's cap. The first payment that breaks a wall seals the account." },
  { name: "Savings", status: "phone" as const, line: "Money you keep. Nothing leaves without your phone.",
    worst: "Your phone holds a post-quantum key. A stolen laptop can't touch Savings at all." },
  { name: "Bills", status: "holding" as const, line: "A bill agent pays your regular bills from its own small account, within a daily cap the chain enforces.",
    worst: "Even if the agent is hijacked, it can only spend what's in its own account, up to its cap." },
];

export function LandingScreen() {
  return (
    <div className="landing">
      <header className="landing-top">
        <div className="page landing-top-in">
          <a href="#/" aria-label="Bulkhead" style={{ color: "var(--on-plate)" }}><Lockup size={26} /></a>
          <NetworkReadout />
          <a className="landing-open" href="#/hull">Open my account</a>
        </div>
      </header>

      <main className="page landing-main" id="main">
        <section className="landing-hero">
          <h1>Watertight walls inside your money.</h1>
          <p className="lead">Bulkhead splits your money into compartments. A stolen laptop, a phished key or a hijacked bill agent can only flood one of them, and only the post-quantum key on your phone can move a wall.</p>
          <div className="landing-paths">
            <a className="btn btn-primary" href="#/setup"><Mark size={22} /> Create my Bulkhead</a>
            <a className="btn btn-secondary" href="#/phone">I'm on my phone: set up my Safety key</a>
          </div>
          <p className="muted small">You need both: start on your laptop, and open this page on your phone when setup asks for it. It takes about two minutes.</p>
        </section>

        <section className="landing-walls" aria-labelledby="walls-h">
          <h2 id="walls-h">How the walls work</h2>
          <div className="seams">
            {WALLS.map((w) => (
              <article key={w.name} className="plate landing-wall">
                <div className="comp-head"><h3>{w.name}</h3><StatusMark kind={w.status} /></div>
                <p>{w.line}</p>
                <p className="muted">{w.worst}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-steps" aria-labelledby="steps-h">
          <h2 id="steps-h">What setup does</h2>
          <ol>
            <li><strong>Your laptop key.</strong> Created and encrypted in this browser. It spends inside the walls.</li>
            <li><strong>Your phone's Safety key.</strong> A post-quantum key that only lives on your phone. It approves anything that widens a wall.</li>
            <li><strong>Your walls.</strong> You say how much you spend in a day and how much you keep. Bulkhead turns that into caps.</li>
            <li><strong>Your account.</strong> Your phone approves its creation, then you fund it from QoreX.</li>
          </ol>
          <p className="muted">Want to check it first? <a href="#/docs/what-is-bulkhead">Read the docs</a>, or <a href="#/proof">see the contracts and the testnet proof</a>.</p>
        </section>
      </main>
      <FooterRow />
    </div>
  );
}
