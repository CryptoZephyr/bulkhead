// The laptop's everyday key. It lives only in this browser, encrypted at rest with the user's
// password (PBKDF2-SHA256 600k iterations, AES-GCM). It can spend inside the walls and tighten
// them. It can never widen a wall: that needs the Safety key on the phone.
import { deriveUnifiedAccount, generateMnemonic, EthNativeSigner, openEvmWindowMsg, type UnifiedAccount } from "@qorechain/sdk";
import { REST, CHAIN_ID } from "./config";

const STORE = "bh-everyday-key";
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function hasStoredKey(): boolean {
  try { return !!localStorage.getItem(STORE); } catch { return false; }
}

export async function createEverydayKey(password: string): Promise<UnifiedAccount> {
  if (password.length < 10) throw new Error("Use a password of at least 10 characters.");
  const mnemonic = generateMnemonic(256);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(password, salt), enc.encode(mnemonic)));
  localStorage.setItem(STORE, JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  return deriveUnifiedAccount(mnemonic, 0);
}

let unlocked: UnifiedAccount | null = null;

export async function unlock(password: string): Promise<UnifiedAccount> {
  const raw = localStorage.getItem(STORE);
  if (!raw) throw new Error("No laptop key on this browser yet.");
  const { salt, iv, ct } = JSON.parse(raw);
  let mnemonic: string;
  try {
    mnemonic = dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await keyFrom(password, unb64(salt)), unb64(ct)));
  } catch { throw new Error("That password doesn't open the laptop key."); }
  unlocked = await deriveUnifiedAccount(mnemonic, 0);
  return unlocked;
}

export function current(): UnifiedAccount {
  if (!unlocked) throw new Error("Unlock your laptop key first.");
  return unlocked;
}

export function lock() { unlocked = null; }

/** Broadcasts already-signed native transactions through our gateway. */
const broadcaster = {
  async broadcastTx(tx: Uint8Array) {
    const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx_bytes: b64(tx), mode: "BROADCAST_MODE_SYNC" }) });
    const t = (await r.json()).tx_response;
    if (!t || t.code !== 0) return { code: t?.code ?? -1, transactionHash: t?.txhash ?? "", rawLog: t?.raw_log };
    for (let i = 0; i < 30; i++) {
      await new Promise((s) => setTimeout(s, 1500));
      const g = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${t.txhash}`);
      if (g.ok) { const x = (await g.json()).tx_response; return { code: x.code, transactionHash: x.txhash, rawLog: x.raw_log }; }
    }
    return { code: -1, transactionHash: t.txhash, rawLog: "Timed out waiting for the block." };
  },
};

async function sequence(addr: string) {
  const r = await (await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${addr}`)).json();
  const a = r.account?.base_account ?? r.account;
  if (!a) throw new Error("This key has no QOR yet, so it can't pay gas. Top up from QoreX first.");
  return { accountNumber: BigInt(a.account_number), sequence: BigInt(a.sequence ?? 0) };
}

/** Opens a short EVM window scoped to the Bulkhead account only. Never lists a token. */
export async function openScopedWindow(accountAddress: string, opts = { blocks: 300, maxTxs: 3, maxValueUqor: "600000" }) {
  const me = current();
  const signer = new EthNativeSigner(me, { signMode: "hybrid", rest: REST });
  const s = await sequence(me.cosmos);
  const msg = openEvmWindowMsg({ sender: me.cosmos, blocks: opts.blocks, maxTxs: opts.maxTxs, maxValue: opts.maxValueUqor, allowedTargets: [accountAddress.toLowerCase()] });
  const r = await signer.signAndBroadcast(broadcaster, { ...s, chainId: CHAIN_ID, messages: [msg], memo: "", fee: { amount: [{ denom: "uqor", amount: "80000" }], gas: "400000" } });
  if (r.code !== 0) throw new Error(`The chain refused to open the window (code ${r.code}).`);
  return r.transactionHash;
}

export async function windowLeft(): Promise<{ live: boolean; txsLeft: number }> {
  const me = current();
  const r = await (await fetch(`${REST}/qorechain/pqc/v1/evm_window/${me.cosmos}`)).json();
  return { live: !!r.live, txsLeft: Number(r.max_txs ?? 0) - Number(r.used_txs ?? 0) };
}
