// The user's own account and how far setup has got. No demo account: until setup is done, there is no account.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { pairing } from "./device";
import { hasStoredKey } from "./wallet";
import { pub, readTokenBalance } from "./account";
import { TOKENS } from "./config";

export function myAccount(): { address: Address } | null {
  const p = pairing();
  return p ? { address: p.account } : null;
}

export type Stage = "no-key" | "no-account" | "not-deployed" | "not-funded" | "ready";

export interface Journey { stage: Stage; account: Address | null; next: { label: string; href: string; why: string } | null }

const NEXT: Record<Exclude<Stage, "ready">, { label: string; href: string; why: string }> = {
  "no-key": { label: "Create your Bulkhead", href: "#/setup", why: "Set up your laptop key and pair your phone. It takes about two minutes." },
  "no-account": { label: "Finish setup", href: "#/setup", why: "Your laptop key is ready. Next, pair your phone and set your walls." },
  "not-deployed": { label: "Approve on your phone", href: "#/setup", why: "Your account is waiting for your phone's approval." },
  "not-funded": { label: "Add money", href: "#/receive", why: "Your account is live and empty. Fund it from QoreX or send to its address." },
};

/** Reads setup progress from this browser and the chain. */
export function useJourney(): Journey | null {
  const [j, setJ] = useState<Journey | null>(null);
  useEffect(() => {
    let on = true;
    const load = async () => {
      const p = pairing();
      let stage: Stage;
      if (!p) stage = hasStoredKey() ? "no-account" : "no-key";
      else {
        const code = await pub.getCode({ address: p.account }).catch(() => undefined);
        if (!code || code === "0x") stage = "not-deployed";
        else {
          const bal = await readTokenBalance(TOKENS.fUSD.address as Address, p.account).catch(() => 0n);
          stage = bal > 0n ? "ready" : "not-funded";
        }
      }
      if (on) setJ({ stage, account: p?.account ?? null, next: stage === "ready" ? null : NEXT[stage] });
    };
    void load(); const t = setInterval(() => void load(), 10_000);
    return () => { on = false; clearInterval(t); };
  }, []);
  return j;
}
