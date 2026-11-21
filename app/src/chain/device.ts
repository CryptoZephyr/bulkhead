// The phone's Safety key (ML-DSA-87) and the laptop's pairing record.
// The Safety key lives only on the phone, encrypted at rest with the phone password.
import { deriveUnifiedAccount, generateMnemonic, EthNativeSigner, buildRegisterPqcKeyMsg, signProofOfPossession, fetchPqcStatus, evmToQor, msg, type UnifiedAccount } from "@qorechain/sdk";
import { deriveSealKeys } from "@qorechain/qoreseal";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import type { Address } from "viem";
import { REST, CHAIN_ID } from "./config";

const SAFETY = "bh-safety-key", PAIRED = "bh-paired";
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aes(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export interface SafetyKey { account: UnifiedAccount; mnemonic: string }
let safety: SafetyKey | null = null;

export function hasSafetyKey() { try { return !!localStorage.getItem(SAFETY); } catch { return false; } }

export async function createSafetyKey(password: string): Promise<SafetyKey> {
  if (password.length < 10) throw new Error("Use a password of at least 10 characters.");
  const mnemonic = generateMnemonic(256);
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(password, salt), enc.encode(mnemonic)));
  localStorage.setItem(SAFETY, JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));
  safety = { account: await deriveUnifiedAccount(mnemonic, 0), mnemonic };
  return safety;
}

export async function unlockSafetyKey(password: string): Promise<SafetyKey> {
  const raw = localStorage.getItem(SAFETY);
  if (!raw) throw new Error("No Safety key on this phone yet.");
  const { salt, iv, ct } = JSON.parse(raw);
  let mnemonic: string;
  try { mnemonic = dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aes(password, unb64(salt)), unb64(ct))); }
  catch { throw new Error("That password doesn't open the Safety key."); }
  safety = { account: await deriveUnifiedAccount(mnemonic, 0), mnemonic };
  return safety;
}

export function currentSafety(): SafetyKey {
  if (!safety) throw new Error("Unlock your Safety key first.");
  return safety;
}

/** What still has to happen on chain before this phone can guard an account. */
export async function phoneReadiness(a: UnifiedAccount): Promise<{ funded: boolean; pqProven: boolean; kemRegistered: boolean }> {
  const bal = await (await fetch(`${REST}/cosmos/bank/v1beta1/balances/${a.cosmos}`)).json();
  const funded = (bal.balances ?? []).some((b: { denom: string; amount: string }) => b.denom === "uqor" && BigInt(b.amount) > 200_000n);
  const pq = await fetchPqcStatus({ rest: REST, address: a.cosmos }).catch(() => ({ registered: false }) as { registered: boolean });
  const kem = await fetchKemKey({ rest: REST, address: a.cosmos }).then((k) => !!k.registered && !!k.publicKey?.length).catch(() => false);
  // The account requires a proven key, so "registered" alone isn't enough.
  const proven = !!pq.registered && (pq as { proven?: boolean }).proven !== false;
  return { funded, pqProven: proven, kemRegistered: kem };
}

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
    return { code: -1, transactionHash: t.txhash, rawLog: "Timed out." };
  },
};

async function sequence(addr: string) {
  const r = await (await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${addr}`)).json();
  const a = r.account?.base_account ?? r.account;
  if (!a) throw new Error("This phone's account has no QOR yet. Send it a little QOR for gas first.");
  return { accountNumber: BigInt(a.account_number), sequence: BigInt(a.sequence ?? 0) };
}

/** Registers the Safety key with proof of possession (the account requires "proven"), then the ML-KEM key requests are sealed to. */
export async function registerPhoneKeys(k: SafetyKey, step: (label: string, p: number) => void) {
  const ready = await phoneReadiness(k.account);
  if (!ready.funded) throw new Error("This phone's account needs a little QOR for gas first.");
  if (!ready.pqProven) {
    step("Registering your post-quantum key", 0.3);
    const pop = signProofOfPossession({ chainId: CHAIN_ID, account: k.account.cosmos, keypair: k.account.pqc });
    const signer = new EthNativeSigner(k.account, { signMode: "classical", rest: REST });
    const r = await signer.signAndBroadcast(broadcaster, { ...(await sequence(k.account.cosmos)), chainId: CHAIN_ID, messages: [buildRegisterPqcKeyMsg(k.account.cosmos, { pqcKeypair: k.account.pqc, proofOfPossession: pop })], memo: "", fee: { amount: [{ denom: "uqor", amount: "80000" }], gas: "400000" } });
    if (r.code !== 0) throw new Error(`The chain refused the key registration (code ${r.code}).`);
  }
  if (!ready.kemRegistered) {
    step("Registering your encryption key", 0.7);
    const keys = deriveSealKeys({ mnemonic: k.mnemonic, index: 0 });
    const signer = new EthNativeSigner(k.account, { signMode: "hybrid", rest: REST });
    const r = await signer.signAndBroadcast(broadcaster, { ...(await sequence(k.account.cosmos)), chainId: CHAIN_ID, messages: [msg.pqc.registerKemKey({ sender: k.account.cosmos, algorithmId: 2, publicKey: Uint8Array.from(keys.mlkemPublicKey) as never })], memo: "", fee: { amount: [{ denom: "uqor", amount: "80000" }], gas: "400000" } });
    if (r.code !== 0) throw new Error(`The chain refused the encryption key (code ${r.code}).`);
  }
}

// ---- laptop side: which phone guards which account

export interface Pairing { account: Address; phoneEvm: Address; phoneQor: string }

export function pairing(): Pairing | null {
  try { const r = localStorage.getItem(PAIRED); return r ? JSON.parse(r) : null; } catch { return null; }
}

export function savePairing(account: Address, phoneEvm: Address) {
  const p: Pairing = { account, phoneEvm, phoneQor: evmToQor(phoneEvm) };
  localStorage.setItem(PAIRED, JSON.stringify(p));
  return p;
}
