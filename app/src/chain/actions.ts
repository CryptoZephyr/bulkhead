// The only way screens change anything on chain. Laptop actions (pay, tighten, seal, break-glass)
// are signed by the everyday key in this browser inside a window scoped to the account.
// Widening goes to the phone (requestWiden) and is never signed here.
import { createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Step } from "../ui/Button";
import accountAbi from "./abi/BulkheadAccount.json";
import { pub, readAccount } from "./account";
import { qorechainTestnet } from "./config";
import { current, openScopedWindow, windowLeft } from "./wallet";
import { pairing } from "./device";
import { sendToPhone, type Intent } from "./requests";
import { REST } from "./config";

export const NOT_WIRED = "This action is not connected to the chain yet.";

export interface PolicyInput { perTxCap: bigint; periodCap: bigint; floor: bigint }

/** A check that runs before sending, so the app never trips a wall by accident (section 16.4). */
export type PayCheck =
  | { ok: true }
  | { ok: false; reason: "over-per-payment" | "over-period" | "below-floor" | "unknown-payee" | "sealed" | "paused"; limit?: bigint };

export interface Actions {
  checkPayment(account: Address, asset: Address, to: Address, amount: bigint): Promise<PayCheck>;
  pay(account: Address, asset: Address, to: Address, amount: bigint, step: Step): Promise<{ txHash: string }>;
  tighten(account: Address, asset: Address, policy: PolicyInput, step: Step): Promise<{ txHash: string }>;
  seal(account: Address, step: Step): Promise<{ txHash: string }>;
  /** Sends a widening request to the paired phone. Returns a request id the phone view looks up. */
  requestWiden(account: Address, intent: Intent, step: Step): Promise<{ requestId: string }>;
  breakGlass(account: Address, assets: Address[], step: Step): Promise<{ txHash: string }>;
}

async function ensureWindow(account: Address, step: Step) {
  const w = await windowLeft();
  if (w.live && w.txsLeft > 0) return;
  step("Opening a window for your account", 0.2);
  await openScopedWindow(account);
}

/** Every laptop write: window scoped to the account, gas is the estimate plus 20%, outcome read from the chain. */
async function write(account: Address, functionName: string, args: unknown[], step: Step, label: string) {
  await ensureWindow(account, step);
  const me = current();
  const wallet = createWalletClient({ chain: qorechainTestnet, transport: http(), account: privateKeyToAccount(me.privateKey as `0x${string}`) });
  step("Checking with QoreChain", 0.4);
  const gas = await pub.estimateContractGas({ address: account, abi: accountAbi, functionName, args, account: me.evm as Address });
  step(label, 0.6);
  const hash = await wallet.writeContract({ address: account, abi: accountAbi, functionName, args, gas: (gas * 12n) / 10n });
  const t0 = Date.now();
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error("The transaction failed on chain. Nothing moved.");
  step(`Confirmed in ${Math.max(1, Math.round((Date.now() - t0) / 1000))} s`, 1);
  return { txHash: hash };
}

export const actions: Actions = {
  async checkPayment(account, asset, _to, amount) {
    const a = await readAccount(account, asset);
    if (a.sealed) return { ok: false, reason: "sealed" };
    if (a.block < a.throttledUntil) return { ok: false, reason: "paused" };
    if (amount > a.asset.perTxCap) return { ok: false, reason: "over-per-payment", limit: a.asset.perTxCap };
    if (amount > a.asset.blastRadius) {
      return a.asset.balance - amount < a.asset.floor ? { ok: false, reason: "below-floor", limit: a.asset.floor } : { ok: false, reason: "over-period", limit: a.asset.periodCap };
    }
    return { ok: true };
  },

  async pay(account, asset, to, amount, step) {
    // Check first: the app never trips a wall by accident. Tripwires are for stolen keys.
    const c = await actions.checkPayment(account, asset, to, amount);
    if (!c.ok) throw new Error("This payment would break a wall, so it needs your phone.");
    const before = await readAccount(account, asset);
    const r = await write(account, "spend", [asset, to, amount], step, "Sending to QoreChain");
    const after = await readAccount(account, asset);
    if (after.sealed && !before.sealed) throw new Error("The payment broke a wall and the account sealed itself. Nothing was sent.");
    return r;
  },

  tighten: (account, asset, p, step) => write(account, "tightenPolicy", [asset, p], step, "Tightening on QoreChain"),
  seal: (account, step) => write(account, "seal", [], step, "Sealing on QoreChain"),
  breakGlass: (account, assets, step) => write(account, "breakGlass", [assets], step, "Sending everything to your recovery account"),

  async requestWiden(account, intent, step) {
    // Sealed to the phone's ML-KEM key, so the server only ever holds ciphertext.
    const p = pairing();
    if (!p || p.account.toLowerCase() !== account.toLowerCase()) throw new Error("Pair your phone first. Widening a wall needs it.");
    step("Encrypting the request for your phone", 0.4);
    const requestId = await sendToPhone(REST, p.phoneQor, { v: 1, account, from: "laptop", intent, createdAt: Date.now() });
    step("Waiting for your phone", 1);
    return { requestId };
  },
};
