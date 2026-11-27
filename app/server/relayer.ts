// Relayer: submits Safety-key-signed actions and factory deployments, paying gas itself.
// It cannot change what it carries: every action is checked by the account against the
// Safety key's ML-DSA-87 signature on chain. It refuses anything that is not one of these
// calls on the factory or on an account the factory deployed, and it simulates first.
import { createPublicClient, createWalletClient, decodeFunctionData, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deriveUnifiedAccount, EthNativeSigner, openEvmWindowMsg, type UnifiedAccount } from "@qorechain/sdk";
import accountAbi from "../src/chain/abi/BulkheadAccount.json" with { type: "json" };
import factoryAbi from "../src/chain/abi/BulkheadFactory.json" with { type: "json" };

export const REST = "https://api-testnet.qore.host";
export const EVM_RPC = "https://evm-testnet.qore.host";
export const CHAIN = "qorechain-diana";
const chain = { id: 9800, name: "QoreChain testnet", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [EVM_RPC] } } } as const;
export const pub = createPublicClient({ chain, transport: http() });

export const ACCOUNT_CALLS = new Set(["spendWithApproval", "breakGlassWithApproval", "queueLoosen", "executeLoosen", "sealWithApproval", "cancelSafetyChangeWithApproval", "setPilotWithApproval", "confirmSafety"]);
export const FACTORY_CALLS = new Set(["deploy"]);

export class Refused extends Error {}

/** Which call this is, or a refusal. Pure, so it is unit-tested. */
export async function classify(to: Address, data: Hex, factory: Address, isAccount: (a: Address) => Promise<boolean>): Promise<string> {
  if (to.toLowerCase() === factory.toLowerCase()) {
    let functionName: string;
    try { functionName = decodeFunctionData({ abi: factoryAbi, data }).functionName; } catch { throw new Refused("Unknown call."); }
    if (!FACTORY_CALLS.has(functionName)) throw new Refused(`The relayer doesn't send ${functionName} to the factory.`);
    return functionName;
  }
  if (!(await isAccount(to))) throw new Refused("That address is not a Bulkhead account.");
  let fn: string;
  try { fn = decodeFunctionData({ abi: accountAbi, data }).functionName; } catch { throw new Refused("Unknown call."); }
  if (!ACCOUNT_CALLS.has(fn)) throw new Refused(`The relayer doesn't send ${fn}. Only the owner's own keys can.`);
  return fn;
}

let relayerAccount: UnifiedAccount | null = null;
async function relayerKey(mnemonic: string) {
  relayerAccount ??= await deriveUnifiedAccount(mnemonic, 0);
  return relayerAccount;
}

const broadcaster = {
  async broadcastTx(tx: Uint8Array) {
    const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_bytes: Buffer.from(tx).toString("base64"), mode: "BROADCAST_MODE_SYNC" }) });
    const t = (await r.json()).tx_response;
    if (t.code !== 0) return { code: t.code, transactionHash: t.txhash, rawLog: t.raw_log };
    for (let i = 0; i < 30; i++) {
      await new Promise((s) => setTimeout(s, 1500));
      const g = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${t.txhash}`);
      if (g.ok) { const x = (await g.json()).tx_response; return { code: x.code, transactionHash: x.txhash, rawLog: x.raw_log }; }
    }
    return { code: -1, transactionHash: t.txhash, rawLog: "timeout" };
  },
};

/** A one-transaction window scoped to exactly the target. */
export async function openWindowFor(me: UnifiedAccount, target: Address) {
  const r = await (await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${me.cosmos}`)).json();
  const a = r.account.base_account ?? r.account;
  const signer = new EthNativeSigner(me, { signMode: "hybrid", rest: REST });
  const msg = openEvmWindowMsg({ sender: me.cosmos, blocks: 120, maxTxs: 1, maxValue: "3000000", allowedTargets: [target.toLowerCase()] });
  const res = await signer.signAndBroadcast(broadcaster, { accountNumber: BigInt(a.account_number), sequence: BigInt(a.sequence ?? 0), chainId: CHAIN, messages: [msg], memo: "", fee: { amount: [{ denom: "uqor", amount: "80000" }], gas: "400000" } });
  if (res.code !== 0) throw new Error(`Relayer window refused (code ${res.code}).`);
  await new Promise((s) => setTimeout(s, 4000));
}

/** FACTORY_ADDRESS may list several factories, newest first: "0xv3,0xv2". Accounts from any of them are served. */
export async function relay(req: { to: Address; data: Hex }, env: { mnemonic: string; factory: string }) {
  const factories = env.factory.split(",").map((f) => f.trim() as Address).filter(Boolean);
  const isAccount = async (a: Address) => {
    for (const f of factories) if ((await pub.readContract({ address: f, abi: factoryAbi, functionName: "isAccount", args: [a] })) as boolean) return true;
    return false;
  };
  const target = factories.find((f) => f.toLowerCase() === req.to.toLowerCase()) ?? factories[0];
  const fn = await classify(req.to, req.data, target, isAccount);
  const me = await relayerKey(env.mnemonic);
  // Simulate before spending anything: a forged signature fails here and costs nothing.
  let gas: bigint;
  try { gas = await pub.estimateGas({ account: me.evm as Address, to: req.to, data: req.data }); }
  catch (e) { throw new Refused(`The chain would refuse this: ${(e as Error).message.split("\n")[0].slice(0, 160)}`); }
  await openWindowFor(me, req.to);
  const wallet = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(me.privateKey as Hex) });
  const hash = await wallet.sendTransaction({ to: req.to, data: req.data, gas: (gas * 12n) / 10n });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return { fn, txHash: hash, status: r.status };
}
