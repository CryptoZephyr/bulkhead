// Bills API for one Bulkhead account.
//   GET  /api/bills?account=0x...              -> the account's bills and the agent's decisions
//   POST /api/bills { account, at, change, signature }
//        change: { kind: "add", name, payee, amount, dueDay } | { kind: "remove", id }
//              | { kind: "approve", id, txHash }  (the phone-signed first payment to the payee)
//              | { kind: "run", invoices?: [{ id, text }] }
//        signature: the account's laptop key signing changeMessage(account, change, at).
//   GET  /api/bills?cron=1                     -> the daily run: pays every due, approved bill.
// The agent pays from its own capped account. decide() makes every money decision.
import Anthropic from "@anthropic-ai/sdk";
import { hasStore, setOnce } from "../server/blobjson.js";
import { firstUse, REPLAYED } from "../server/replay.js";
import { createPublicClient, http, verifyMessage, type Address, type Hex } from "viem";
import { evmToQor } from "@qorechain/sdk";
import { sealToAddresses } from "@qorechain/qoreseal/network";
import { envelopeToText } from "@qorechain/qoreseal";
import { extract, toProposal, payFromAgent, REST, CHAIN, type AgentEnv } from "../server/agent.js";
import { decide, type Rule } from "../server/policy.js";
import { submit, defaultStore } from "../server/queue.js";
import { BlobBills, MemoryBills, BadBill, addBill, removeBill, approvalFromReceipt, changeMessage, dueBills, approvedPayees,
  spentToday, handledKeys, billKey, record, type BillBook, type BillStore } from "../server/bills.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

const FUSD = "0x97143b771d34ddb9130b807b135ae675a5a963ca";
const PER_PAYMENT = 10_000_000n, PER_DAY = 25_000_000n;
const fmt = (n: bigint) => (Number(n) / 1e6).toFixed(2);
const pub = createPublicClient({ transport: http("https://evm-testnet.qore.host") });
const accountAbi = [
  { type: "function", name: "everyday", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "safety", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;
const ADDR = /^0x[0-9a-fA-F]{40}$/;

let bills: BillStore | null = null;
const store = () => (bills ??= hasStore() ? new BlobBills() : new MemoryBills());

function agentEnv(rule: Rule): AgentEnv | null {
  const e = process.env;
  if (!e.AGENT_OWNER_MNEMONIC || !e.AGENT_KEY_HEX || !e.RELAYER_MNEMONIC) return null;
  return { rule, agentAccountIndex: Number(e.AGENT_ACCOUNT_INDEX ?? 0), ownerMnemonic: e.AGENT_OWNER_MNEMONIC, agentKeyHex: e.AGENT_KEY_HEX, relayerMnemonic: e.RELAYER_MNEMONIC };
}
const ruleFor = (book: BillBook): Rule => ({ token: FUSD, perPayment: PER_PAYMENT, perDay: PER_DAY, payees: approvedPayees(book) });

/** Pays every due, approved bill for one account. Bill amounts come from the owner, so no model is involved. */
async function payDue(book: BillBook, now = Date.now()) {
  const rule = ruleFor(book), env = agentEnv(rule);
  for (const b of dueBills(book, now)) {
    const key = billKey(b, now);
    const v = decide(rule, { invoiceId: key, payee: b.payee, amount: BigInt(b.amount), token: FUSD }, spentToday(book, now), handledKeys(book), fmt);
    if (v.decision !== "pay") { if (!book.decisions.some((d) => d.key === key && d.decision === v.decision)) record(book, { key, billId: b.id, source: "bill", label: b.name, amount: b.amount, ...v }, now); continue; }
    if (!env) { record(book, { key, billId: b.id, source: "bill", label: b.name, amount: b.amount, decision: "reject", reason: "The agent isn't configured on this server, so nothing was paid." }, now); continue; }
    try {
      const paid = await payFromAgent(env, b.payee as Address, BigInt(b.amount));
      if (paid.moved === BigInt(b.amount)) record(book, { key, billId: b.id, source: "bill", label: b.name, amount: b.amount, decision: "pay", reason: v.reason, txHash: paid.txHash }, now);
      else record(book, { key: `${key}:blocked:${now}`, billId: b.id, source: "bill", label: b.name, amount: b.amount, decision: "reject", reason: `The chain blocked this payment (${fmt(paid.moved)} moved). Top up the agent or renew its key.`, txHash: paid.txHash }, now);
    } catch (e) {
      record(book, { key: `${key}:failed:${now}`, billId: b.id, source: "bill", label: b.name, amount: b.amount, decision: "reject", reason: `The payment didn't go through: ${(e as Error).message}` }, now);
    }
  }
}

/** Pasted invoices: the model only reads the fields; decide() and the chain do the rest. Unknown payees go to the phone. */
async function readInvoices(book: BillBook, invoices: { id: string; text: string }[]) {
  const e = process.env;
  if (!e.SERV_API_KEY) throw new BadBill("Reading invoices isn't configured on this server.");
  const client = new Anthropic({ baseURL: "https://inference-api.openserv.ai", apiKey: null, authToken: e.SERV_API_KEY });
  const rule = ruleFor(book), env = agentEnv(rule);
  const safety = (await pub.readContract({ address: book.account as Address, abi: accountAbi, functionName: "safety" })) as Address;
  for (const inv of invoices) {
    let x;
    try { x = await extract(client, inv); } catch (err) { record(book, { key: inv.id, source: "invoice", label: `Invoice ${inv.id}`, amount: "0", decision: "reject", reason: `Couldn't read this invoice: ${(err as Error).message}` }); continue; }
    const p = toProposal(inv, x, { fUSD: { address: FUSD, decimals: 6 } });
    const v = decide(rule, p, spentToday(book), handledKeys(book), fmt);
    const base = { key: inv.id, source: "invoice" as const, label: `Invoice ${inv.id}`, amount: String(p.amount) };
    if (v.decision === "pay" && env) {
      const paid = await payFromAgent(env, p.payee as Address, p.amount);
      record(book, paid.moved === p.amount ? { ...base, ...v, txHash: paid.txHash } : { ...base, decision: "reject", reason: `The chain blocked this payment (${fmt(paid.moved)} moved).`, txHash: paid.txHash });
    } else if (v.decision === "ask-phone" && ADDR.test(p.payee)) {
      const plain = { v: 1, account: book.account, from: "agent", intent: { kind: "Spend", asset: FUSD, to: p.payee, amount: String(p.amount) }, createdAt: Date.now() };
      const envl = await sealToAddresses({ rest: REST, chainId: CHAIN, purpose: "bulkhead-request-v1", mode: "mlkem", recipients: [{ address: evmToQor(safety) }], plaintext: new TextEncoder().encode(JSON.stringify(plain)) });
      const q = await submit(defaultStore(), { account: book.account, phone: evmToQor(safety), envelope: envelopeToText(envl) });
      record(book, { ...base, ...v, requestId: q.id });
    } else record(book, { ...base, ...(v.decision === "pay" ? { decision: "reject" as const, reason: "The agent isn't configured on this server." } : v) });
  }
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  try {
    if (req.method === "GET" && url.searchParams.get("cron")) {
      if (!(store() instanceof BlobBills)) return Response.json({ ran: 0 });
      const { folders } = await import("../server/blobjson.js");
      let ran = 0;
      for (const a of await folders("bills")) { const book = await store().get(a); if (dueBills(book).length) { await payDue(book); await store().put(book); ran++; } }
      return Response.json({ ran });
    }
    if (req.method === "GET") {
      const account = url.searchParams.get("account") ?? "";
      if (!ADDR.test(account)) throw new BadBill("account must be a 0x address.");
      const book = await store().get(account);
      return Response.json({ ...book, rule: { perPayment: fmt(PER_PAYMENT), perDay: fmt(PER_DAY) }, spentToday: fmt(spentToday(book)), due: dueBills(book).map((b) => b.id) });
    }
    if (req.method !== "POST") return Response.json({ error: "Not allowed." }, { status: 405 });

    const body = (await req.json()) as { account?: string; at?: number; change?: { kind?: string; [k: string]: unknown }; signature?: Hex };
    const account = (body.account ?? "").toLowerCase();
    if (!ADDR.test(account) || !body.change || typeof body.at !== "number") throw new BadBill("Send account, at, change and signature.");
    if (Math.abs(Date.now() - body.at) > 5 * 60_000) throw new BadBill("This change is too old. Try again.");
    const laptop = (await pub.readContract({ address: account as Address, abi: accountAbi, functionName: "everyday" })) as Address;
    const ok = await verifyMessage({ address: laptop, message: changeMessage(account, body.change, body.at), signature: body.signature ?? "0x" }).catch(() => false);
    if (!ok) return Response.json({ error: "This change wasn't signed by the account's laptop key." }, { status: 401 });
    // Single-use signatures. No store (local runs): no replay guard.
    if (hasStore() && !(await firstUse(body.signature!, setOnce))) throw new BadBill(REPLAYED);

    const book = await store().get(account);
    const c = body.change;
    if (c.kind === "add") addBill(book, c as never);
    else if (c.kind === "remove") removeBill(book, String(c.id));
    else if (c.kind === "approve") {
      const bill = book.bills.find((b) => b.id === c.id);
      if (!bill) throw new BadBill("No such bill.");
      const receipt = await pub.getTransactionReceipt({ hash: String(c.txHash) as Hex }).catch(() => null);
      if (!receipt || receipt.status !== "success" || !approvalFromReceipt(book, bill, FUSD, receipt.logs)) throw new BadBill("That transaction isn't a phone-approved payment from your account to this payee.");
      bill.approvedTx = String(c.txHash);
      record(book, { key: `${bill.id}:${new Date().toISOString().slice(0, 7)}:approval`, billId: bill.id, source: "bill", label: bill.name, amount: bill.amount, decision: "ask-phone", reason: "Your phone paid this payee and approved them for the agent.", txHash: bill.approvedTx });
    } else if (c.kind === "run") {
      await payDue(book);
      const inv = Array.isArray(c.invoices) ? (c.invoices as { id: string; text: string }[]).filter((i) => typeof i?.id === "string" && typeof i?.text === "string" && i.text.length < 5000).slice(0, 5) : [];
      if (inv.length) await readInvoices(book, inv);
    } else throw new BadBill("Unknown change.");
    await store().put(book);
    return Response.json({ ...book, spentToday: fmt(spentToday(book)), due: dueBills(book).map((b) => b.id) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof BadBill || e instanceof SyntaxError ? 400 : 502 });
  }
}

export const GET = handler;
export const POST = handler;
export default handler;
