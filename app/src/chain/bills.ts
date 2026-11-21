// Client for /api/bills. Every change is signed by the laptop key, and the server checks that key is this account's.
import { privateKeyToAccount } from "viem/accounts";
import { current } from "./wallet";

export interface Bill { id: string; name: string; payee: string; amount: string; dueDay: number; approvedTx?: string }
export interface BillDecision { id: string; billId?: string; source: "bill" | "invoice"; label: string; amount: string; decision: "pay" | "ask-phone" | "reject"; reason: string; txHash?: string; requestId?: string; at: number }
export interface BillBook { account: string; bills: Bill[]; decisions: BillDecision[]; spentToday: string; due: string[]; rule?: { perPayment: string; perDay: string } }

export type BillChange =
  | { kind: "add"; name: string; payee: string; amount: string; dueDay: number }
  | { kind: "remove"; id: string }
  | { kind: "approve"; id: string; txHash: string }
  | { kind: "run"; invoices?: { id: string; text: string }[] };

const changeMessage = (account: string, change: object, at: number) =>
  `Bulkhead bills change\naccount: ${account.toLowerCase()}\nat: ${at}\n${JSON.stringify(change)}`;

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({ error: "The server sent something we couldn't read." }));
  if (!r.ok) throw new Error(j.error ?? "The request was refused.");
  return j as T;
}

export const getBills = (account: string) => fetch(`/api/bills?account=${account}`).then((r) => json<BillBook>(r));

export async function changeBills(account: string, change: BillChange): Promise<BillBook> {
  const at = Date.now();
  const signature = await privateKeyToAccount(current().privateKey as `0x${string}`).signMessage({ message: changeMessage(account, change, at) });
  return json<BillBook>(await fetch("/api/bills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account, at, change, signature }) }));
}

/** Waits for the phone to settle a request, and returns its transaction hash. */
export async function waitForPhone(requestId: string, onTick?: (secondsLeft: number) => void): Promise<string> {
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    const r = await fetch(`/api/requests?id=${requestId}`).then((x) => x.json());
    if (r.status === "approved" && r.txHash) return r.txHash;
    if (r.status === "refused") throw new Error("Your phone refused it.");
    if (r.status === "expired") throw new Error("The request expired before your phone approved it.");
    onTick?.(Math.round((until - Date.now()) / 1000));
    await new Promise((s) => setTimeout(s, 3000));
  }
  throw new Error("The request expired before your phone approved it.");
}
