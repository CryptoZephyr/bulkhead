// Demo account history (docs/DESIGN_SYSTEM.md section 16.7). Every row is a real result from
// docs/DEPLOYMENTS.md (21 November) or the spike log, rounds 20 and 21. Stored oldest first; the screen shows newest first.
// Hashes and gas come from the lead's live runs on 21 November: the parity rerun (rows p*) on the QOR
// parity account and the agent run (rows a*) on the fUSD demo account. Rows without a hash were refused
// before a transaction existed, or were agent executions inside a relayed native transaction.
import type { StatusKind } from "../ui/Status";

export type Compartment = "Everyday" | "Savings" | "Agent" | "Account";
export type ActivityFilter = "all" | "everyday" | "savings" | "agent" | "attention";

export interface ActivityItem {
  id: string;
  day: string; // ISO date, real day of the run
  what: string;
  detail: string;
  amount: string;
  compartment: Compartment;
  status: StatusKind;
  /** A sealed account or an attempt the chain refused. Shown under "Needs attention". */
  attention: boolean;
  hash?: string;
}

export const ACTIVITY: ActivityItem[] = [
  // Parity run on the QOR account (rerun on contracts 6c7778a, same outcomes)
  { id: "p1", day: "2026-11-21", what: "Factory deployed", detail: "BulkheadFactory, gas 3,316,223.", amount: "No money", compartment: "Account", status: "holding", attention: false, hash: "0xea5239bd87c134943195a3a9f694b303f9159d5ea4f5985320dc2302f36d4deb" },
  { id: "p2", day: "2026-11-21", what: "Deploy with a forged Safety-key signature", detail: "Refused by the chain: BadSafetySignature.", amount: "No money", compartment: "Account", status: "blocked", attention: true },
  { id: "p3", day: "2026-11-21", what: "Account deployed with a real ML-DSA-87 signature", detail: "Relayed. Gas 2,436,306.", amount: "No money", compartment: "Account", status: "holding", attention: false, hash: "0x57d990091c1add22b42db2ee60fc341048b1d294cd5d6b9541c91a539f84e50e" },
  { id: "p4", day: "2026-11-21", what: "Native funding arrived", detail: "Sent to the account with no window open.", amount: "1 QOR in", compartment: "Account", status: "holding", attention: false },
  { id: "p5", day: "2026-11-21", what: "Everyday spend within the walls", detail: "Window scoped to the account. Gas 119,278.", amount: "0.1 QOR", compartment: "Everyday", status: "paid", attention: false, hash: "0x4f81343ad65844cc1926ae1f002a9b410a76329e6533c1f4444216258d2a9c1d" },
  { id: "p6", day: "2026-11-21", what: "Everyday spend over the per-payment cap", detail: "The transaction succeeded. The account sealed and nothing moved. Gas 109,368.", amount: "0.00 QOR moved", compartment: "Everyday", status: "sealed", attention: true, hash: "0x42ddfb838fdc80fcbfe735a2cc9dfb8c6d761f6dfe574459294dc308c7532ca1" },
  { id: "p7", day: "2026-11-21", what: "Phone approval with a forged signature", detail: "Refused by the chain.", amount: "No money", compartment: "Savings", status: "blocked", attention: true },
  { id: "p8", day: "2026-11-21", what: "Phone approval below the floor, while sealed", detail: "Real ML-DSA-87 signature. Billed 1,500,000 gas, the chain's billing floor.", amount: "0.6 QOR", compartment: "Savings", status: "paid", attention: false, hash: "0x82525757fee6c34d7f0d57fe023b106d420959108d0283fa4785fa743c35dfa2" },
  // Agent run on the fUSD account
  { id: "a1", day: "2026-11-21", what: "Bulkhead account with an fUSD policy deployed", detail: "Real ML-DSA-87 signature. Gas 2,504,946.", amount: "No money", compartment: "Account", status: "holding", attention: false, hash: "0xc09abd0da85b0e77abd548004abb225877182f97668dd4975ec0f37cfdd3e20d" },
  { id: "a2", day: "2026-11-21", what: "Token funding from bank coins", detail: "MsgConvertCoin. The account's fUSD balance is now 100.", amount: "100 fUSD in", compartment: "Account", status: "holding", attention: false },
  { id: "a3", day: "2026-11-21", what: "Phone top-up to the agent account", detail: "spendWithApproval, real ML-DSA-87 signature. Bulkhead went from 100 to 70.", amount: "30 fUSD", compartment: "Savings", status: "paid", attention: false, hash: "0x943db1cab41b5655423627605270443c85fed387a79fea3d2bf767b5cb65607b" },
  { id: "s1", day: "2026-11-21", what: "Everyday spend within the walls", detail: "Window scoped to the account. Gas 119,277.", amount: "2.00 fUSD", compartment: "Everyday", status: "paid", attention: false, hash: "0x83af506eee4d723a1829af15d42f295ee579b807d96c12821bc7d38f4243da73" },
  { id: "s2", day: "2026-11-21", what: "Stolen key spent over the per-payment cap", detail: "6.00 fUSD is over 5.00. The transaction succeeded, the account sealed and nothing moved. Gas 109,584.", amount: "0.00 fUSD moved", compartment: "Everyday", status: "sealed", attention: true, hash: "0x687fb72d3e47b14a2f105d5aabdff640f2486508f7fd1fcb8ac4c1f51bb6878b" },
  { id: "a4", day: "2026-11-21", what: "Agent paid a bill", detail: "8 fUSD, within 10 per payment.", amount: "8 fUSD", compartment: "Agent", status: "paid", attention: false },
  { id: "a5", day: "2026-11-21", what: "Agent payment blocked", detail: "15 fUSD is over the 10 per payment rule. Blocked by the chain.", amount: "0.00 fUSD moved", compartment: "Agent", status: "blocked", attention: true },
  { id: "a6", day: "2026-11-21", what: "Agent paid a bill", detail: "9 fUSD, 17 today, within 25 per day.", amount: "9 fUSD", compartment: "Agent", status: "paid", attention: false },
  { id: "a7", day: "2026-11-21", what: "Agent payment blocked", detail: "9 fUSD would make 26 today, over 25 per day. Blocked by the chain.", amount: "0.00 fUSD moved", compartment: "Agent", status: "blocked", attention: true },
  { id: "a8", day: "2026-11-21", what: "Hijacked agent key called Bulkhead directly", detail: "Blocked by the chain. The Bulkhead account is untouched.", amount: "0.00 fUSD moved", compartment: "Agent", status: "blocked", attention: true },
];

export const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "everyday", label: "Everyday" },
  { id: "savings", label: "Savings" },
  { id: "agent", label: "Agent" },
  { id: "attention", label: "Needs attention" },
];

export function matches(item: ActivityItem, f: ActivityFilter): boolean {
  switch (f) {
    case "all": return true;
    case "everyday": return item.compartment === "Everyday";
    case "savings": return item.compartment === "Savings";
    case "agent": return item.compartment === "Agent";
    case "attention": return item.attention;
  }
}
