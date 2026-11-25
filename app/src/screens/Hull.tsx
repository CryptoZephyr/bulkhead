// Hull (home), section 16.3: is my money safe, and how much can I spend? Real chain reads of your account.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { readAccount, fmt, type AccountView } from "../chain/account";
import { TOKENS } from "../chain/config";
import { myAccount } from "../chain/me";
import { HullRow, type CompartmentView } from "../ui/Hull";
import { ExposureChart } from "../ui/ExposureChart";
import { usePilot } from "./Pilot";
import { PendingPlate } from "../ui/Pending";

const T = TOKENS.fUSD;

export function compartmentsFrom(a: AccountView): CompartmentView[] {
  const bal = a.asset.balance, floor = a.asset.floor;
  const everyday = bal > floor ? bal - floor : 0n;
  const savings = bal < floor ? bal : floor;
  const max = Number(everyday > savings ? everyday : savings) || 1;
  const state = a.sealed ? "sealed" : a.block < a.throttledUntil ? "paused" : "open";
  return [
    {
      id: "everyday", name: "Everyday", unit: T.symbol, balance: fmt(everyday, T.decimals, T.places),
      fill: Number(everyday) / max, radius: fmt(a.asset.blastRadius, T.decimals, T.places),
      radiusShare: everyday ? Number(a.asset.blastRadius) / Number(everyday) : 0, state,
      sentence: state === "sealed" ? "A payment broke your walls, so nothing more can leave without your phone."
        : state === "paused" ? `Paused by your watcher for ${a.throttledUntil - a.block} blocks. Nothing can leave.`
        : `Up to ${fmt(a.asset.perTxCap, T.decimals, T.places)} per payment, ${fmt(a.asset.periodCap, T.decimals, T.places)} a day.`,
      weight: Math.max(1, Math.round(Number(everyday) / 1e6)),
    },
    {
      id: "savings", name: "Savings", unit: T.symbol, balance: fmt(savings, T.decimals, T.places),
      fill: Number(savings) / max, radius: "0.00", radiusShare: 0, state: a.sealed ? "sealed" : "open",
      sentence: "Leaves only with your phone.", weight: Math.max(1, Math.round(Number(savings) / 1e6)),
    },
  ];
}

export function HullScreen() {
  const [acct, setAcct] = useState<AccountView | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    const load = () => readAccount(myAccount()!.address, T.address as Address)
      .then((a) => { if (on) { setAcct(a); setErr(""); } })
      .catch(() => on && setErr("We can't reach QoreChain right now. Your walls hold on chain without us. Retrying in 5 s."));
    load(); const t = setInterval(load, 5000);
    return () => { on = false; clearInterval(t); };
  }, []);
  if (err && !acct) return <p role="alert" style={{ color: "var(--flood)" }}>{err}</p>;
  if (!acct) return <div className="hull" aria-busy="true"><div className="plate comp" style={{ minHeight: 280 }} /><div className="plate comp" style={{ minHeight: 280 }} /></div>;
  const comps = compartmentsFrom(acct);
  return (
    <>
      <div className="plate" style={{ display: "grid", gap: 6 }}>
        <span className="label">If your laptop were stolen now, the most it could take</span>
        <span className="big-number" style={{ color: "var(--lime)" }}>{fmt(acct.asset.blastRadius, T.decimals, T.places)} <small style={{ fontSize: 20 }}>{T.symbol}</small></span>
      </div>
      <PilotSummary />
      <PendingPlate account={acct.address} />
      <HullRow compartments={comps} />
      {err && <p role="alert" style={{ color: "var(--rust)" }}>{err}</p>}
    </>
  );
}

/** The pilot at a glance: the day's breathing line, or a nudge to add it. */
function PilotSummary() {
  const { v } = usePilot();
  if (!v) return null;
  if (!v.added) return (
    <div className="next-step"><div><strong>Add the pilot</strong><p>Keep the most a stolen laptop could take close to zero while you sleep.</p></div><a className="btn btn-primary" href="#/pilot">Set up the pilot</a></div>
  );
  return (
    <div className="plate" style={{ display: "grid", gap: 8 }}>
      <span className="label">Your pilot · {v.quietNow ? "quiet hours, wall at rest" : "daytime, wall open"}</span>
      <ExposureChart s={v.settings} ceilingPerTx={BigInt(v.chain.ceiling.perTx)} />
      <a href="#/pilot">Change your hours</a>
    </div>
  );
}
