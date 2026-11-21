// The bill agent's key is linked to the agent's own chain account for a limited time (the chain caps a
// session's lifetime). Renewing re-links the same key with the same spending rule and a fresh expiry.
// The rule is fixed here in code, never by the model: fUSD only, 10 per payment, 25 per day, only fUSD.transfer.
import { ed25519 } from "@noble/curves/ed25519.js";
import { deriveUnifiedAccount, EthNativeSigner, signAuthenticatorLinkEd25519, linkAuthenticatorMsgs, revokeAuthenticatorMsg, fetchAuthenticators } from "@qorechain/sdk";
import { REST, CHAIN } from "./agent.ts";

export const FUSD = "0x97143b771d34ddb9130b807b135ae675a5a963ca";
export const RULE = { perPayment: 10_000_000n, perDay: 25_000_000n };
export const SESSION_SECONDS = 3600;

export interface KeyStatus { linked: boolean; expiresAt: number | null; secondsLeft: number | null }

export async function agentKeyStatus(ownerMnemonic: string, index: number, agentKeyHex: string, now = Date.now()): Promise<KeyStatus> {
  const owner = await deriveUnifiedAccount(ownerMnemonic, index);
  const pk = Buffer.from(ed25519.getPublicKey(Buffer.from(agentKeyHex.replace(/^0x/, ""), "hex"))).toString("hex");
  const list = await fetchAuthenticators({ rest: REST, address: owner.cosmos });
  const mine = list.filter((a) => a.pubkeyHex.toLowerCase() === pk && !a.revoked).sort((a, b) => Number(b.expiryUnix - a.expiryUnix))[0];
  if (!mine) return { linked: false, expiresAt: null, secondsLeft: null };
  const expiresAt = Number(mine.expiryUnix) * 1000;
  return { linked: expiresAt > now, expiresAt, secondsLeft: Math.max(0, Math.round((expiresAt - now) / 1000)) };
}

async function broadcast(tx: Uint8Array) {
  const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_bytes: Buffer.from(tx).toString("base64"), mode: "BROADCAST_MODE_SYNC" }) });
  const t = (await r.json()).tx_response;
  if (t.code !== 0) return { code: t.code, transactionHash: t.txhash, rawLog: t.raw_log };
  for (let i = 0; i < 30; i++) {
    await new Promise((s) => setTimeout(s, 1500));
    const g = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${t.txhash}`);
    if (g.ok) { const x = (await g.json()).tx_response; return { code: x.code, transactionHash: x.txhash, rawLog: x.raw_log }; }
  }
  return { code: -1, transactionHash: t.txhash, rawLog: "timeout" };
}

/** Revokes the current link (if any) and links the same key again with a fresh expiry, in one transaction. */
export async function renewAgentKey(ownerMnemonic: string, index: number, agentKeyHex: string): Promise<{ txHash: string; expiresAt: number }> {
  const owner = await deriveUnifiedAccount(ownerMnemonic, index);
  const sk = Uint8Array.from(Buffer.from(agentKeyHex.replace(/^0x/, ""), "hex"));
  const pk = ed25519.getPublicKey(sk);
  const status = await agentKeyStatus(ownerMnemonic, index, agentKeyHex);
  const list = await fetchAuthenticators({ rest: REST, address: owner.cosmos });
  const existing = list.some((a) => a.pubkeyHex.toLowerCase() === Buffer.from(pk).toString("hex") && !a.revoked);
  const expiryUnix = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const proof = signAuthenticatorLinkEd25519({ chainId: CHAIN, account: owner.cosmos, privateKey: sk });
  const denom = `erc20/${FUSD}`;
  const msgs = [
    ...(existing ? [revokeAuthenticatorMsg({ owner: owner.cosmos, scheme: "ed25519", pubkey: pk })] : []),
    ...linkAuthenticatorMsgs({ owner: owner.cosmos, chainId: CHAIN, ...proof, permissions: ["evm"], expiryUnix, label: "bulkhead bill agent",
      spendingRule: { id: `bill-agent-${expiryUnix}`, enabled: true, perTxLimit: "1", dailyLimit: "1", allowedDenoms: [denom],
        denomLimits: [{ denom, perTxLimit: String(RULE.perPayment), dailyLimit: String(RULE.perDay) }], allowedEvmCalls: [`${FUSD}/0xa9059cbb`] } }),
  ];
  void status;
  const a = (await (await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${owner.cosmos}`)).json()).account;
  const base = a.base_account ?? a;
  const r = await new EthNativeSigner(owner, { signMode: "hybrid", rest: REST }).signAndBroadcast({ broadcastTx: broadcast }, { accountNumber: BigInt(base.account_number), sequence: BigInt(base.sequence ?? 0), chainId: CHAIN, messages: msgs, memo: "", fee: { amount: [{ denom: "uqor", amount: "200000" }], gas: "1000000" } });
  if (r.code !== 0) throw new Error(`The chain refused the renewal (code ${r.code}): ${(r as { rawLog?: string }).rawLog ?? ""}`.slice(0, 300));
  return { txHash: r.transactionHash, expiresAt: expiryUnix * 1000 };
}
