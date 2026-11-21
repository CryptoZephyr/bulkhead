// Bills: the regular payments the bill agent makes for one Bulkhead account.
// Every money decision here is deterministic code. The model is never asked whether to pay.
//   - A bill's payee is approved only by the phone: the first payment to that payee is a Spend from the
//     Bulkhead account that the phone signs (ML-DSA-87). We accept the approval only after reading that
//     transaction's Spent(asset, payee, amount, withApproval=true) event from the account on chain.
//   - Once approved, the agent pays the bill each month on its due day, from its own capped account,
//     through decide() in policy.ts. The chain's spending rule caps it again.
//   - Changes to the bill list must be signed by the account's laptop key (the account's everyday key).
import { readLatest, writeVersion } from "./blobjson.js";
import { decodeEventLog, parseAbi, type Address, type Hex } from "viem";

export interface Bill {
  id: string;
  name: string;
  payee: string;        // lowercase 0x
  amount: string;       // fUSD base units
  dueDay: number;       // 1..28
  approvedTx?: string;  // the phone-signed Spend that approved the payee
  createdAt: number;
}

export interface BillDecision {
  id: string;
  key: string;          // bill id + month, or the invoice id: never paid twice
  billId?: string;
  source: "bill" | "invoice";
  label: string;
  amount: string;
  decision: "pay" | "ask-phone" | "reject";
  reason: string;
  txHash?: string;
  requestId?: string;
  at: number;
}

export interface BillBook {
  account: string;
  bills: Bill[];
  decisions: BillDecision[];
}

export interface BillStore {
  get(account: string): Promise<BillBook>;
  put(book: BillBook): Promise<void>;
}

export class BadBill extends Error {}

const ADDR = /^0x[0-9a-f]{40}$/;
export const empty = (account: string): BillBook => ({ account: account.toLowerCase(), bills: [], decisions: [] });

export class MemoryBills implements BillStore {
  private m = new Map<string, BillBook>();
  async get(a: string) { return structuredClone(this.m.get(a.toLowerCase()) ?? empty(a)); }
  async put(b: BillBook) { this.m.set(b.account, structuredClone(b)); }
}

/** Vercel Blob, one JSON object per account. Holds payees and amounts only: no keys, nothing that can move money. */
export class BlobBills implements BillStore {
  async get(a: string): Promise<BillBook> { return (await readLatest<BillBook>(`bills/${a.toLowerCase()}`)) ?? empty(a); }
  async put(b: BillBook) { await writeVersion(`bills/${b.account}`, b); }
}

/** The exact text the laptop key signs for a change. The server rebuilds it, so a signature can't be reused for another change. */
export function changeMessage(account: string, change: object, at: number) {
  return `Bulkhead bills change\naccount: ${account.toLowerCase()}\nat: ${at}\n${JSON.stringify(change)}`;
}

export function addBill(book: BillBook, input: { name?: string; payee?: string; amount?: string; dueDay?: number }, now = Date.now()): Bill {
  const name = (input.name ?? "").trim();
  const payee = (input.payee ?? "").trim().toLowerCase();
  if (!name || name.length > 40) throw new BadBill("Give the bill a name of up to 40 characters.");
  if (!ADDR.test(payee)) throw new BadBill("The payee must be a 0x address.");
  if (payee === book.account) throw new BadBill("A bill can't pay your own account.");
  if (!/^\d{1,12}$/.test(input.amount ?? "") || BigInt(input.amount!) <= 0n) throw new BadBill("The amount must be more than zero.");
  const day = Number(input.dueDay);
  if (!Number.isInteger(day) || day < 1 || day > 28) throw new BadBill("The due day must be between 1 and 28.");
  if (book.bills.length >= 20) throw new BadBill("You can have up to 20 bills.");
  const bill: Bill = { id: crypto.randomUUID(), name, payee, amount: input.amount!, dueDay: day, createdAt: now };
  book.bills.push(bill);
  return bill;
}

export function removeBill(book: BillBook, id: string) {
  const n = book.bills.length;
  book.bills = book.bills.filter((b) => b.id !== id);
  if (book.bills.length === n) throw new BadBill("No such bill.");
}

const spentAbi = parseAbi(["event Spent(address indexed asset, address indexed to, uint256 amount, bool withApproval)"]);

/** Accepts a payee approval only if the receipt shows the account itself paid that payee with the phone's approval. */
export function approvalFromReceipt(book: BillBook, bill: Bill, token: string, logs: { address: string; topics: Hex[]; data: Hex }[]): boolean {
  for (const l of logs) {
    if (l.address.toLowerCase() !== book.account) continue;
    try {
      const e = decodeEventLog({ abi: spentAbi, topics: l.topics as [Hex, ...Hex[]], data: l.data });
      if (e.eventName === "Spent" && e.args.withApproval && e.args.asset.toLowerCase() === token.toLowerCase() && e.args.to.toLowerCase() === bill.payee) return true;
    } catch { /* another event */ }
  }
  return false;
}

export const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7);
export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Approved bills whose due day has come this month and that the agent hasn't paid this month. */
export function dueBills(book: BillBook, now = Date.now()): Bill[] {
  const month = monthKey(now), today = new Date(now).getUTCDate();
  const paid = new Set(book.decisions.filter((d) => d.decision === "pay" && d.billId && monthKey(d.at) === month).map((d) => d.billId));
  return book.bills.filter((b) => b.approvedTx && b.dueDay <= today && !paid.has(b.id));
}

/** Approved payees for decide(): only payees whose approval was read from the chain. */
export function approvedPayees(book: BillBook): Record<string, string> {
  return Object.fromEntries(book.bills.filter((b) => b.approvedTx).map((b) => [b.payee, b.name]));
}

/** What the agent has paid today for this account, from its own recorded payments. */
export function spentToday(book: BillBook, now = Date.now()): bigint {
  const d = dayKey(now);
  return book.decisions.filter((x) => x.decision === "pay" && dayKey(x.at) === d).reduce((s, x) => s + BigInt(x.amount), 0n);
}

/** Keys already paid: a bill once a month, an invoice once. */
export function handledKeys(book: BillBook): Set<string> {
  return new Set(book.decisions.filter((d) => d.decision === "pay").map((d) => d.key));
}

export const billKey = (b: Bill, now: number) => `${b.id}:${monthKey(now)}`;

export function record(book: BillBook, d: Omit<BillDecision, "id" | "at">, now = Date.now()): BillDecision {
  const full = { ...d, id: crypto.randomUUID(), at: now };
  book.decisions.unshift(full);
  book.decisions = book.decisions.slice(0, 100);
  return full;
}

export type { Address };
