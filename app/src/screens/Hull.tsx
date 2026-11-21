// Hull (home), section 16.3: is my money safe, and how much can I spend? Real chain reads of the demo account.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { readAccount, fmt, type AccountView } from "../chain/account";
import { DEPLOYMENT, TOKENS } from "../chain/config";
import { HullRow, type CompartmentView } from "../ui/Hull";

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
    const load = () => readAccount(DEPLOYMENT.demoAccount as Address, T.address as Address)
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
      <HullRow compartments={comps} />
      {err && <p role="alert" style={{ color: "var(--rust)" }}>{err}</p>}
    </>
  );
}
