// POST /api/agent { invoices: [{ id, text }] }: runs the bill agent once. Anything the policy sends
// to the phone becomes a Spend request from the Bulkhead account, sealed to the phone's ML-KEM key.
// Configuration comes only from the environment; the agent's rule is fixed here, not by the model.
import Anthropic from "@anthropic-ai/sdk";
import { sealToAddresses } from "@qorechain/qoreseal/network";
import { envelopeToText } from "@qorechain/qoreseal";
import { runAgent, REST, CHAIN } from "../server/agent.js";
import { submit, defaultStore, type Store } from "../server/queue.js";
import type { Rule } from "../server/policy.js";

export const config = { runtime: "nodejs", maxDuration: 60 };

const FUSD = "0x97143b771d34ddb9130b807b135ae675a5a963ca";
const fmt = (n: bigint) => (Number(n) / 1e6).toFixed(2);
const handled = new Set<string>();
let spentDay = "", spent = 0n;
let store: Store | null = null;

async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "Not allowed." }, { status: 405 });
  const e = process.env;
  const need = ["SERV_API_KEY", "AGENT_OWNER_MNEMONIC", "AGENT_KEY_HEX", "RELAYER_MNEMONIC", "AGENT_PAYEES", "BULKHEAD_ACCOUNT", "PHONE_QOR"];
  const missing = need.filter((k) => !e[k]);
  if (missing.length) return Response.json({ error: `The agent is not configured: ${missing.join(", ")}.` }, { status: 503 });
  let body: { invoices?: { id: string; text: string }[] };
  try { body = await req.json(); } catch { return Response.json({ error: "Bad JSON." }, { status: 400 }); }
  const invoices = (body.invoices ?? []).filter((i) => typeof i.id === "string" && typeof i.text === "string" && i.text.length < 5000).slice(0, 20);
  const today = new Date().toISOString().slice(0, 10);
  if (today !== spentDay) { spentDay = today; spent = 0n; }
  const rule: Rule = { token: FUSD, perPayment: 10_000_000n, perDay: 25_000_000n, payees: JSON.parse(e.AGENT_PAYEES!) };
  const client = new Anthropic({ baseURL: "https://inference-api.openserv.ai", apiKey: null, authToken: e.SERV_API_KEY });
  const decisions = await runAgent(client, { rule, agentAccountIndex: Number(e.AGENT_ACCOUNT_INDEX ?? 0), ownerMnemonic: e.AGENT_OWNER_MNEMONIC!, agentKeyHex: e.AGENT_KEY_HEX!, relayerMnemonic: e.RELAYER_MNEMONIC! },
    invoices, spent, handled, { fUSD: { address: FUSD, decimals: 6 } }, fmt);
  store ??= defaultStore();
  const out = [];
  for (const d of decisions) {
    if (d.paid) spent += d.paid.moved;
    let requestId: string | undefined;
    if (d.verdict.decision === "ask-phone" && d.extracted && /^0x[0-9a-fA-F]{40}$/.test(d.extracted.payee_address.trim())) {
      const amount = BigInt(Math.round(Number(d.extracted.amount) * 1e6));
      const plain = { v: 1, account: e.BULKHEAD_ACCOUNT, from: "agent", intent: { kind: "Spend", asset: FUSD, to: d.extracted.payee_address.trim(), amount: String(amount) }, createdAt: Date.now() };
      const env = await sealToAddresses({ rest: REST, chainId: CHAIN, purpose: "bulkhead-request-v1", mode: "mlkem", recipients: [{ address: e.PHONE_QOR! }], plaintext: new TextEncoder().encode(JSON.stringify(plain)) });
      requestId = (await submit(store, { account: e.BULKHEAD_ACCOUNT, phone: e.PHONE_QOR, envelope: envelopeToText(env) })).id;
    }
    out.push({ invoice: d.invoice.id, decision: d.verdict.decision, reason: d.verdict.reason, txHash: d.paid?.txHash, moved: d.paid ? fmt(d.paid.moved) : undefined, requestId });
  }
  return Response.json({ decisions: out, spentToday: fmt(spent) });
}

// Vercel calls the method exports.
export const GET = handler;
export const POST = handler;
export default handler;
