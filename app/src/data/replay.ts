// Attack replay data (docs/DESIGN_SYSTEM.md section 16.9). Every number and result here comes from
// docs/DEPLOYMENTS.md (21 November) or the spike log, rounds 20 and 21. Nothing is invented.
// Full hashes come from the lead's live runs on 21 November (parity rerun and agent run).
// Results without a hash were refused before a transaction existed, or were agent executions
// relayed inside a native transaction, and show "Transaction link coming".

export type Outcome = "paid" | "sealed" | "blocked";

export interface ReplayResult {
  what: string;
  outcome: Outcome;
  detail: string;
  gas?: number;
  hash?: string;
}

export interface ReplayStep {
  id: string;
  title: string;
  summary: string;
  /** Where the results come from, in plain words. */
  source: string;
  /** The account is sealed from step 2 on. */
  sealed: boolean;
  results: ReplayResult[];
}

/** Demo account numbers in fUSD, from the records. Used to draw the hull where a live read is not needed. */
export const DEMO = {
  /** Bulkhead account after the 21 November runs: 70 fUSD after the agent top-up, then 2.00 paid inside the walls (round 22). */
  bulkhead: 68,
  /** The fUSD floor, the part that leaves only with the phone (spike log, round 21: 20 floor). */
  savingsFloor: 20,
  /** Agent account at the end of the run (DEPLOYMENTS.md: agent account 13). */
  agent: 13,
  /** Agent rule (DEPLOYMENTS.md): fUSD only, 10 per payment, 25 per day, only fUSD.transfer. */
  agentPerPayment: 10,
  agentPerDay: 25,
  /** Per-payment cap of the demo account (spike log, round 21: 5 per spend). */
  everydayPerPayment: 5,
} as const;

export const REPLAY_STEPS: ReplayStep[] = [
  {
    id: "before",
    title: "Before the attack",
    summary: "If the laptop were stolen now, this is the most the thief could take.",
    source: "Read live from the chain for the demo account.",
    sealed: false,
    results: [],
  },
  {
    id: "over-cap",
    title: "The stolen key pays over the cap",
    summary: "The thief's key sends a payment over the per-payment cap. The chain lets the transaction through, seals the account, and moves nothing.",
    source: "The fUSD demo account, 21 November.",
    sealed: true,
    results: [
      {
        what: "Spend 2.00 fUSD inside the walls",
        outcome: "paid",
        detail: "Within the 5.00 per-payment cap. Paid.",
        gas: 119277,
        hash: "0x83af506eee4d723a1829af15d42f295ee579b807d96c12821bc7d38f4243da73",
      },
      {
        what: "Stolen key spends 6.00 fUSD, over the 5.00 per-payment cap",
        outcome: "sealed",
        detail: "The transaction succeeded. The account sealed. Nothing moved.",
        gas: 109584,
        hash: "0x687fb72d3e47b14a2f105d5aabdff640f2486508f7fd1fcb8ac4c1f51bb6878b",
      },
    ],
  },
  {
    id: "forged",
    title: "A forged phone signature",
    summary: "The thief can't approve from the phone. A forged signature is refused.",
    source: "Parity test on a QOR account, 21 November.",
    sealed: true,
    results: [
      {
        what: "Phone approval with a forged signature",
        outcome: "blocked",
        detail: "Refused when the chain checked it, before any gas was spent. Nothing moved.",
      },
    ],
  },
  {
    id: "agent",
    title: "The agent key overspends",
    summary: "The agent has its own account and key. It can't pay over its per-payment cap, and it can't call Bulkhead directly.",
    source: "Agent run, fUSD, 21 November. Along the way the agent paid 8 and 9 fUSD, within its rules.",
    sealed: true,
    results: [
      {
        what: "Pay 15 fUSD, over 10 per payment",
        outcome: "blocked",
        detail: "Blocked by the chain. Nothing moved.",
      },
      {
        what: "Hijacked key calls Bulkhead.spend directly",
        outcome: "blocked",
        detail: "Blocked by the chain. The Bulkhead account is untouched.",
      },
    ],
  },
  {
    id: "phone",
    title: "Your phone moves money",
    summary: "Your phone can still move money. A real post-quantum signature from the phone goes through, even while the account is sealed.",
    source: "Top-up: fUSD account, 21 November. Approval while sealed: QOR parity account, 21 November.",
    sealed: true,
    results: [
      {
        what: "Top up the agent account with 30 fUSD",
        outcome: "paid",
        detail: "Approved on the phone with a real ML-DSA-87 signature.",
        hash: "0x943db1cab41b5655423627605270443c85fed387a79fea3d2bf767b5cb65607b",
      },
      {
        what: "Approve 0.6 QOR below the floor while sealed",
        outcome: "paid",
        detail: "Went through with a real ML-DSA-87 signature. Billed 1,500,000 gas, half the 3,000,000 limit, which is the chain's billing floor.",
        gas: 1500000,
        hash: "0x82525757fee6c34d7f0d57fe023b106d420959108d0283fa4785fa743c35dfa2",
      },
    ],
  },
];

/** Shown after the last step. Checked against the record: the attacks moved nothing out of Bulkhead. */
export const CLOSING_LINE = "0.00 fUSD left the Bulkhead account without your phone.";
export const CLOSING_NOTE = "The agent's own payments of 8 and 9 fUSD came from its own account, within its rules.";
