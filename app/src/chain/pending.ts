// Widenings the phone approved wait on chain for the account's delay, then anyone may run them.
// This finds them (LoosenQueued events still queued under the current epoch), recovers the nonce
// from the phone's own queueLoosen call, and runs executeLoosen through the relayer when due.
import { decodeEventLog, decodeFunctionData, encodeFunctionData, type Address, type Hex } from "viem";
import accountAbi from "./abi/BulkheadAccount.json";
import { pub } from "./account";
import { creationBlock } from "./history";

export const ACTION_NAMES = ["New walls", "New approved payee", "Payee list off", "Unseal", "New sentinel", "New recovery account", "Add the pilot"];

export interface Pending { id: Hex; action: number; name: string; data: Hex; nonce: bigint; readyAt: bigint; block: bigint; cancelled: boolean }

const CHUNK = 5000n;

export async function readPending(account: Address): Promise<Pending[]> {
  const [head, epoch] = await Promise.all([pub.getBlockNumber(), pub.readContract({ address: account, abi: accountAbi, functionName: "epoch" }) as Promise<bigint>]);
  const from = await creationBlock(account);
  const logs = [];
  for (let b = from; b <= head; b += CHUNK) {
    const to = b + CHUNK - 1n < head ? b + CHUNK - 1n : head;
    logs.push(...await pub.getLogs({ address: account, fromBlock: b, toBlock: to }));
  }
  const out: Pending[] = [];
  for (const l of logs) {
    let ev;
    try { ev = decodeEventLog({ abi: accountAbi, data: l.data, topics: l.topics }); } catch { continue; }
    if (ev.eventName !== "LoosenQueued") continue;
    const a = ev.args as unknown as { id: Hex; action: number; data: Hex; readyAt: bigint };
    const [stillQueued, qEpoch] = await Promise.all([
      pub.readContract({ address: account, abi: accountAbi, functionName: "readyAt", args: [a.id] }) as Promise<bigint>,
      pub.readContract({ address: account, abi: accountAbi, functionName: "queuedEpoch", args: [a.id] }) as Promise<bigint>,
    ]);
    if (stillQueued === 0n) continue;   // already run
    const tx = await pub.getTransaction({ hash: l.transactionHash! });
    const call = decodeFunctionData({ abi: accountAbi, data: tx.input });
    const nonce = (call.args as unknown[])[2] as bigint;
    out.push({ id: a.id, action: Number(a.action), name: ACTION_NAMES[Number(a.action)] ?? "Change", data: a.data, nonce, readyAt: a.readyAt, block: head, cancelled: qEpoch !== epoch });
  }
  return out;
}

/** Runs a due widening. Anyone may; the relayer pays the gas. */
export async function finishPending(account: Address, p: Pending): Promise<string> {
  const data = encodeFunctionData({ abi: accountAbi, functionName: "executeLoosen", args: [p.action, p.data, p.nonce] });
  const r = await fetch("/api/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: account, data }) });
  const j = await r.json();
  if (!r.ok || j.status !== "success") throw new Error(j.error ?? "The chain refused it.");
  return j.txHash;
}

export const minutesUntil = (p: Pending) => Math.max(0, Math.ceil((Number(p.readyAt - p.block) * 1.42) / 60));
