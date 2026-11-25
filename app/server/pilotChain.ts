// The pilot's hands on chain: read an account's ceiling and live walls, and send setLive with the
// pilot key through a one-transaction window scoped to that account. Every outcome is read back.
import { createWalletClient, http, type AbiEvent, type Address, type Hex, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deriveUnifiedAccount, type UnifiedAccount } from "@qorechain/sdk";
import accountAbi from "../src/chain/abi/BulkheadAccount.json" with { type: "json" };
import { pub, openWindowFor, EVM_RPC } from "./relayer.js";
import type { Ceiling, LiveTarget, TripEvent } from "./pilot.js";

export const FUSD = "0x97143b771d34ddb9130b807b135ae675a5a963ca" as Address;
const chain = { id: 9800, name: "QoreChain testnet", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [EVM_RPC] } } } as const;

export interface ChainView {
  block: bigint;
  periodBlocks: bigint;
  pilot: Address;
  ceiling: Ceiling;
  floor: bigint;
  liveOn: boolean;
  live: { perTx: bigint; period: bigint; until: bigint; restPerTx: bigint; restPeriod: bigint };
  effective: { perTx: bigint; period: bigint };
  blastRadius: bigint;
  sealed: boolean;
}

export async function readChain(account: Address): Promise<ChainView> {
  const r = (fn: string, args: unknown[] = []) => pub.readContract({ address: account, abi: accountAbi, functionName: fn, args });
  const [block, periodBlocks, pilot, policy, liveOn, live, eff, blast, sealed] = await Promise.all([
    pub.getBlockNumber(), r("periodBlocks"), r("pilot"), r("policy", [FUSD]), r("liveOn", [FUSD]), r("live", [FUSD]), r("effectiveCaps", [FUSD]), r("blastRadius", [FUSD]), r("sealed_"),
  ]);
  const p = policy as bigint[], l = live as bigint[], e = eff as bigint[];
  return { block, periodBlocks: periodBlocks as bigint, pilot: pilot as Address, ceiling: { perTx: p[0], period: p[1] }, floor: p[2], liveOn: liveOn as boolean,
    live: { perTx: l[0], period: l[1], until: l[2], restPerTx: l[3], restPeriod: l[4] }, effective: { perTx: e[0], period: e[1] }, blastRadius: blast as bigint, sealed: sealed as boolean };
}

const SPENT = accountAbi.find((x) => x.type === "event" && x.name === "Spent") as AbiEvent;
const HELD = accountAbi.find((x) => x.type === "event" && x.name === "HeldByPilot") as AbiEvent;
/** getLogs is asked for at most this many blocks at a time. */
export const LOG_CHUNK = 5_000n;

/**
 * The account's Spent and HeldByPilot events in [from, to], with block times. Reads in chunks of
 * LOG_CHUNK blocks and fetches each distinct block's time once.
 */
export async function readTripEvents(account: Address, from: bigint, to: bigint): Promise<TripEvent[]> {
  const logs: Log[] = [];
  for (let a = from; a <= to; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - 1n < to ? a + LOG_CHUNK - 1n : to;
    logs.push(...(await pub.getLogs({ address: account, events: [SPENT, HELD], fromBlock: a, toBlock: b })));
  }
  const blocks = [...new Set(logs.map((l) => l.blockNumber as bigint))];
  const times = new Map<bigint, number>();
  await Promise.all(blocks.map(async (n) => times.set(n, Number((await pub.getBlock({ blockNumber: n })).timestamp) * 1000)));
  return logs.map((l) => {
    const { eventName, args } = l as unknown as { eventName: string; args: { amount: bigint; withApproval?: boolean } };
    const base = { at: times.get(l.blockNumber as bigint)!, block: l.blockNumber as bigint, amount: args.amount, txHash: l.transactionHash ?? undefined };
    return eventName === "HeldByPilot" ? { kind: "HeldByPilot" as const, ...base } : { kind: "Spent" as const, ...base, withApproval: !!args.withApproval };
  });
}

let key: UnifiedAccount | null = null;
export async function pilotKey(mnemonic: string, index: number) { key ??= await deriveUnifiedAccount(mnemonic, index); return key; }

export async function applyTarget(account: Address, t: LiveTarget, me: UnifiedAccount): Promise<{ txHash: Hex; blastRadius: bigint }> {
  const args = [FUSD, { perTx: t.perTx, period: t.period, until: t.until, restPerTx: t.restPerTx, restPeriod: t.restPeriod }];
  const gas = await pub.estimateContractGas({ address: account, abi: accountAbi, functionName: "setLive", args, account: me.evm as Address });
  await openWindowFor(me, account);
  const wallet = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(me.privateKey as Hex) });
  const hash = await wallet.writeContract({ address: account, abi: accountAbi, functionName: "setLive", args, gas: (gas * 12n) / 10n });
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rc.status !== "success") throw new Error("The chain refused the pilot's change.");
  return { txHash: hash, blastRadius: (await readChain(account)).blastRadius };
}
