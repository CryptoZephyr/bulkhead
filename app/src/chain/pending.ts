// Widenings the phone approved wait on chain for the account's delay, then anyone may run them.
// One filtered log scan finds them (LoosenQueued, LoosenExecuted, LoosenCancelled only). State comes
// from log order alone: executed ids are done, and a queued item with a later LoosenCancelled can
// never run. The nonce is recovered from the phone's queueLoosen call only for items still live.
import { decodeFunctionData, encodeFunctionData, getAbiItem, type Address, type Hex } from "viem";
import accountAbi from "./abi/BulkheadAccount.json";
import { pub } from "./account";
import { creationBlock } from "./history";

export const ACTION_NAMES = ["New walls", "New approved payee", "Payee list off", "Unseal", "New sentinel", "New recovery account", "Add the pilot"];

export type PendingState = "waiting" | "ready" | "cancelled";
export interface Pending {
  id: Hex; action: number; name: string; data: Hex; nonce: bigint; readyAt: bigint; block: bigint;
  state: PendingState;
  /** Whole minutes until it can run (0 when ready or cancelled). */
  minutesLeft: number;
  /** Cancelled only: plain-language why, and when (ms) the cancelling event happened. */
  reason?: string;
  cancelledAt?: number;
}

const CHUNK = 5000n;
const PARALLEL = 4;
const EVENTS = (["LoosenQueued", "LoosenExecuted", "LoosenCancelled"] as const).map(
  (name) => getAbiItem({ abi: accountAbi as never, name } as never) as never,
);

function createdKey(account: Address) { return `bh-created-${account.toLowerCase()}`; }

async function createdAt(account: Address): Promise<bigint> {
  try { const v = localStorage.getItem(createdKey(account)); if (v && /^\d+$/.test(v)) return BigInt(v); } catch { /* no storage */ }
  const b = await creationBlock(account);
  try { localStorage.setItem(createdKey(account), b.toString()); } catch { /* no storage */ }
  return b;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** Finds the account's widenings. Throws on any RPC failure; callers decide how to show that. */
export async function readPending(account: Address): Promise<{ items: Pending[] }> {
  const [head, from] = await Promise.all([pub.getBlockNumber(), createdAt(account)]);
  const ranges: [bigint, bigint][] = [];
  for (let b = from; b <= head; b += CHUNK) ranges.push([b, b + CHUNK - 1n < head ? b + CHUNK - 1n : head]);
  const logs: any[] = [];
  for (let i = 0; i < ranges.length; i += PARALLEL) {
    const got = await Promise.all(ranges.slice(i, i + PARALLEL).map(([f, t]) =>
      pub.getLogs({ address: account, events: EVENTS, fromBlock: f, toBlock: t } as never) as Promise<any[]>));
    for (const g of got) logs.push(...g);
  }
  const pos = (l: any) => Number(l.blockNumber) * 1e6 + Number(l.logIndex);
  logs.sort((a, b) => pos(a) - pos(b));

  const executed = new Set<string>();
  const cancels = logs.filter((l) => l.eventName === "LoosenCancelled");
  for (const l of logs) if (l.eventName === "LoosenExecuted") executed.add(l.args.id);
  const queued = logs.filter((l) => l.eventName === "LoosenQueued" && !executed.has(l.args.id));

  // Time of each distinct cancelling block, only for those that cancelled something we show.
  const cancelOf = (q: any) => cancels.find((c) => pos(c) > pos(q));
  const blocks = [...new Set(queued.map(cancelOf).filter(Boolean).map((c) => c.blockNumber as bigint))];
  const times = new Map<bigint, number>();
  await Promise.all(blocks.map(async (bn) => { times.set(bn, Number((await pub.getBlock({ blockNumber: bn })).timestamp) * 1000); }));

  const items = await Promise.all(queued.map(async (l): Promise<Pending> => {
    const a = l.args as { id: Hex; action: number; data: Hex; readyAt: bigint };
    const base = { id: a.id, action: Number(a.action), name: ACTION_NAMES[Number(a.action)] ?? "Change", data: a.data, readyAt: a.readyAt, block: head };
    const c = cancelOf(l);
    if (c) {
      const at = times.get(c.blockNumber);
      return { ...base, nonce: 0n, state: "cancelled", minutesLeft: 0, cancelledAt: at,
        reason: `Cancelled when the account was sealed or tightened${at ? ` at ${clock(at)}` : ""}` };
    }
    const tx = await pub.getTransaction({ hash: l.transactionHash });
    const call = decodeFunctionData({ abi: accountAbi, data: tx.input });
    const nonce = (call.args as unknown[])[2] as bigint;
    const ready = head >= a.readyAt;
    return { ...base, nonce, state: ready ? "ready" : "waiting", minutesLeft: ready ? 0 : Math.max(1, Math.ceil((Number(a.readyAt - head) * 1.42) / 60)) };
  }));
  return { items };
}

/** Runs a due widening. Anyone may; the relayer pays the gas. */
export async function finishPending(account: Address, p: Pending): Promise<string> {
  const data = encodeFunctionData({ abi: accountAbi, functionName: "executeLoosen", args: [p.action, p.data, p.nonce] });
  const r = await fetch("/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: account, data }) });
  const j = await r.json();
  if (!r.ok || j.status !== "success") throw new Error(j.error ?? "The chain refused it.");
  return j.txHash;
}
