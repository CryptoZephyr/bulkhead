// Agent (section 16.6): let the user trust and supervise the bill agent.
// Every decision reason comes from deterministic code, never from the model's text.
import { myAccount } from "../chain/me";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { fmt, readTokenBalance } from "../chain/account";
import { TOKENS } from "../chain/config";
import { NOT_WIRED, actions } from "../chain/actions";
import { ActionButton } from "../ui/Button";
import "./agent.css";

const T = TOKENS.fUSD;
const UNIT = 10n ** BigInt(T.decimals);
// The agent's own account, from the testnet run and the agent compartment in docs/DEPLOYMENTS.md.
const AGENT_ACCOUNT = "0xbAB12dbb1de5FB86D1CA2C8B9cd0c73985A8D4A8" as Address;
const myAddr = (): Address => myAccount()!.address;

// The rule in plain words. TODO: read these from the agent's on-chain policy once the lead wires it.
const PER_PAYMENT = 10n * UNIT;
const PER_DAY = 25n * UNIT;
const money = (n: bigint) => fmt(n, T.decimals, T.places);

export function AgentScreen() {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let on = true;
    const load = () => readTokenBalance(T.address as Address, AGENT_ACCOUNT)
      .then((b) => { if (on) { setBalance(b); setErr(""); } })
      .catch(() => on && setErr("We can't read the agent's balance right now."));
    load();
    const t = setInterval(load, 5000);
    return () => { on = false; clearInterval(t); };
  }, []);

  return (
    <div className="agent-grid">
      <section className="plate agent-balance" aria-label="Agent budget">
        <span className="label">Agent account balance</span>
        {balance !== null
          ? <span className="big-number agent-number">{money(balance)} <small>{T.symbol}</small></span>
          : <span className="muted" aria-busy={!err}>{err || "Reading the agent's account..."}</span>}
        <p className="muted">Its own account on chain. It pays only from this balance.</p>
      </section>

      <section className="plate agent-rule" aria-label="Its rule">
        <span className="label">Its rule</span>
        <p>fUSD only, up to {money(PER_PAYMENT)} per payment and {money(PER_DAY)} a day, only to approved payees.</p>
      </section>

      <div className="agent-actions">
        <ActionButton
          block
          run={async (step) => {
            await actions.requestWiden(myAddr(), { kind: "Spend", asset: TOKENS.fUSD.address, to: AGENT_ACCOUNT, amount: "10000000" }, step);
            return "Sent to your phone";
          }}
        >
          Top up from my phone
        </ActionButton>
      </div>

      <section aria-labelledby="decisions-title" className="agent-decisions">
        <h2 id="decisions-title">Its decisions</h2>
        <p className="muted">Nothing yet. Each payment the agent makes, and each one the chain blocks, will show here.</p>
      </section>

      <AgentKeyPlate />
      <div className="agent-secondary">
        <ActionButton
          kind="secondary"
          run={async (step) => {
            // Pausing disables the agent's spending rule (MsgUpdateSpendingRules), signed by the agent account's owner. Not wired yet.
            void step;
            throw new Error(NOT_WIRED);
          }}
        >
          Pause agent
        </ActionButton>
        <ActionButton
          kind="secondary"
          run={async (step) => {
            // Revoking sends MsgRevokeAuthenticator for the agent key (measured in spike round 18). Not wired yet.
            void step;
            throw new Error(NOT_WIRED);
          }}
        >
          Revoke agent
        </ActionButton>
      </div>
    </div>
  );
}

/** The agent's key is linked for a limited time. Renewing re-links the same key with the same rule. */
function AgentKeyPlate() {
  const [st, setSt] = useState<{ linked: boolean; secondsLeft: number | null } | null>(null);
  const [err, setErr] = useState("");
  const load = () => fetch("/api/agent-key").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setSt(j); setErr(""); })
    .catch((e) => setErr(e instanceof Error ? e.message : "We can't read the agent key right now."));
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t); }, []);
  const mins = st?.secondsLeft != null ? Math.round(st.secondsLeft / 60) : null;
  return (
    <section className="plate" aria-labelledby="agent-key-h" style={{ display: "grid", gap: 10 }}>
      <h2 id="agent-key-h" style={{ color: "var(--on-plate)" }}>The agent's key</h2>
      {err ? <p role="alert">{err}</p>
        : !st ? <p className="muted">Reading the key from the chain.</p>
        : st.linked ? <p>Linked for about {mins} more minutes. When it runs out, the agent can't pay anything until you renew it.</p>
        : <p>Not linked. The agent can't pay anything until you renew it.</p>}
      <ActionButton kind="primary" run={async (step) => {
        step("Renewing the key on QoreChain", 0.5);
        const r = await fetch("/api/agent-key", { method: "POST" }); const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "The renewal was refused.");
        await load();
        return "Renewed for an hour";
      }}>Renew the agent's key</ActionButton>
      <p className="muted" style={{ fontSize: 13 }}>Same key, same rule: fUSD only, 10.00 per payment, 25.00 a day.</p>
    </section>
  );
}
