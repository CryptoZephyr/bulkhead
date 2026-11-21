// Account history, read from the chain only: the account's own events plus tokens arriving.
// The RPC answers log queries over at most about 5,000 blocks, so history is read in chunks.
import { decodeEventLog, parseAbiItem, type Address, type Log } from "viem";
import accountAbi from "./abi/BulkheadAccount.json";
import { pub, fmt } from "./account";
import { NATIVE, REST, TOKENS } from "./config";
import { evmToQor } from "@qorechain/sdk";

const CHUNK = 5000n;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export type EventKind = "paid" | "paid-with-phone" | "received" | "tripped" | "sealed" | "paused" | "tightened"
  | "widen-queued" | "widen-done" | "widen-cancelled" | "evacuated" | "phone-change" | "phone-changed";

export interface HistoryItem {
  kind: EventKind;
  block: bigint;
  txHash: string;
  title: string;
  detail: string;
  attention: boolean;
}

const TRIPS = ["", "over the per-payment cap", "over the daily cap", "below the Savings floor", "to a payee that isn't approved"];
const unit = (asset: string) => (asset.toLowerCase() === NATIVE ? TOKENS.QOR : TOKENS.fUSD);
const money = (asset: string, v: bigint) => { const t = unit(asset); return `${fmt(v, t.decimals, t.places)} ${t.symbol}`; };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function describe(l: Log): HistoryItem | null {
  let ev: { eventName: string; args: Record<string, unknown> };
  try { ev = decodeEventLog({ abi: accountAbi, data: l.data, topics: l.topics }) as never; } catch { return null; }
  const a = ev.args, base = { block: l.blockNumber!, txHash: l.transactionHash! };
  switch (ev.eventName) {
    case "Spent": return { ...base, kind: a.withApproval ? "paid-with-phone" : "paid", title: `Paid ${money(a.asset as string, a.amount as bigint)}`, detail: `To ${short(a.to as string)}${a.withApproval ? ", approved on your phone" : ""}.`, attention: false };
    case "Tripped": return { ...base, kind: "tripped", title: "A wall held", detail: `A payment of ${money(a.asset as string, a.amount as bigint)} was ${TRIPS[Number(a.reason)] ?? "outside the walls"}. Nothing moved, and the account sealed itself.`, attention: true };
    case "Sealed": return { ...base, kind: "sealed", title: "Account sealed", detail: "Nothing can leave until your phone unseals it.", attention: true };
    case "Throttled": return { ...base, kind: "paused", title: "Paused by a watcher", detail: `Spending paused until block ${a.untilBlock as bigint}.`, attention: true };
    case "Tightened": return { ...base, kind: "tightened", title: "Walls tightened", detail: `Changed: ${String(a.what)}.`, attention: false };
    case "LoosenQueued": return { ...base, kind: "widen-queued", title: "Your phone approved a change", detail: `It takes effect at block ${a.readyAt as bigint}. Any tighten cancels it.`, attention: false };
    case "LoosenExecuted": return { ...base, kind: "widen-done", title: "A change took effect", detail: "Approved earlier on your phone.", attention: false };
    case "BrokeGlass": return { ...base, kind: "evacuated", title: `Sent ${money(a.asset as string, a.amount as bigint)} to recovery`, detail: `Break-glass to ${short(a.to as string)}.`, attention: true };
    case "SafetyChangeProposed": return { ...base, kind: "phone-change", title: "Phone replacement started", detail: `New phone ${short(a.next as string)}. The account is sealed while it waits.`, attention: true };
    case "SafetyChangeCancelled": return { ...base, kind: "phone-change", title: "Phone replacement stopped", detail: "The current phone stays.", attention: false };
    case "SafetyChanged": return { ...base, kind: "phone-changed", title: "New phone in charge", detail: `From ${short(a.previous as string)} to ${short(a.next as string)}.`, attention: true };
    default: return null;
  }
}

/** Everything that happened to the account since `fromBlock`, newest first. */
export async function readHistory(account: Address, fromBlock: bigint): Promise<HistoryItem[]> {
  const head = await pub.getBlockNumber();
  const items: HistoryItem[] = [];
  for (let start = fromBlock; start <= head; start += CHUNK) {
    const end = start + CHUNK - 1n > head ? head : start + CHUNK - 1n;
    const [own, incoming] = await Promise.all([
      pub.getLogs({ address: account, fromBlock: start, toBlock: end }),
      pub.getLogs({ address: TOKENS.fUSD.address as Address, event: TRANSFER, args: { to: account }, fromBlock: start, toBlock: end }),
    ]);
    // A tripwire also emits Sealed in the same transaction; "A wall held" already says the account sealed.
    const explained = new Set(own.filter((l) => ["tripped", "phone-change", "evacuated"].includes(describe(l)?.kind ?? "")).map((l) => l.transactionHash));
    for (const l of own) {
      const d = describe(l);
      if (d && !(d.kind === "sealed" && explained.has(l.transactionHash))) items.push(d);
    }
    for (const l of incoming) items.push({ kind: "received", block: l.blockNumber!, txHash: l.transactionHash!, title: `Received ${money(TOKENS.fUSD.address, l.args.value as bigint)}`, detail: `From ${short(l.args.from as string)}.`, attention: false });
  }
  items.push(...(await readDeposits(account)));
  return items.sort((x, y) => Number(y.block - x.block));
}

const FUNDED = "bh-funded";
/** Called after this device funds an account from QoreX, so the deposit can be found again. */
export function rememberFunding(account: Address, txHash: string) {
  try { const all = JSON.parse(localStorage.getItem(FUNDED) ?? "{}"); (all[account.toLowerCase()] ??= []).push(txHash); localStorage.setItem(FUNDED, JSON.stringify(all)); } catch { /* storage off */ }
}

/** Deposits: QOR found by the chain's transfer index; fUSD conversions (which leave no EVM log) from hashes this
 *  device recorded, each checked against the chain before it's shown. */
async function readDeposits(account: Address): Promise<HistoryItem[]> {
  const out: HistoryItem[] = [];
  const qor = evmToQor(account);
  const q = encodeURIComponent(`transfer.recipient='${qor}'`);
  const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs?query=${q}&limit=50&order_by=ORDER_BY_DESC`).then((x) => x.json()).catch(() => ({}));
  for (const t of r.tx_responses ?? []) {
    if (t.code !== 0) continue;
    for (const e of t.events ?? []) {
      if (e.type !== "transfer") continue;
      const at = Object.fromEntries(e.attributes.map((a: { key: string; value: string }) => [a.key, a.value]));
      if (at.recipient !== qor || !/^\d+uqor$/.test(at.amount ?? "")) continue;
      out.push({ kind: "received", block: BigInt(t.height), txHash: t.txhash, title: `Received ${fmt(BigInt(at.amount.replace("uqor", "")) * 1_000_000_000_000n, 18, 4)} QOR`, detail: `From ${short(at.sender ?? "")}.`, attention: false });
    }
  }
  let mine: string[] = [];
  try { mine = JSON.parse(localStorage.getItem(FUNDED) ?? "{}")[account.toLowerCase()] ?? []; } catch { /* none */ }
  for (const h of mine) {
    const t = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${h}`).then((x) => x.json()).catch(() => null);
    const tr = t?.tx_response;
    const m = t?.tx?.body?.messages?.[0];
    if (!tr || tr.code !== 0 || m?.["@type"] !== "/cosmos.evm.erc20.v1.MsgConvertCoin" || m.receiver?.toLowerCase() !== account.toLowerCase()) continue;
    out.push({ kind: "received", block: BigInt(tr.height), txHash: tr.txhash, title: `Received ${fmt(BigInt(m.coin.amount), TOKENS.fUSD.decimals, TOKENS.fUSD.places)} fUSD`, detail: "Funded from QoreX on this device.", attention: false });
  }
  return out;
}

/** Finds the block an account was created at, so history doesn't scan the whole chain. */
export async function creationBlock(account: Address, txHash?: `0x${string}`): Promise<bigint> {
  if (txHash) return (await pub.getTransactionReceipt({ hash: txHash })).blockNumber;
  // Binary search for the first block with code at the address.
  let lo = 0n, hi = await pub.getBlockNumber();
  if (!(await pub.getCode({ address: account, blockNumber: hi }))) throw new Error("No account at that address.");
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const code = await pub.getCode({ address: account, blockNumber: mid }).catch(() => undefined);
    if (code && code !== "0x") hi = mid; else lo = mid + 1n;
  }
  return lo;
}
