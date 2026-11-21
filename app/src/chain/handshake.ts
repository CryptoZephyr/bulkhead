// Bulkhead Handshake: pair a phone without typing or pasting its address.
//   Laptop: throwaway ML-KEM-1024 + X25519 keys, a session id, and a QR whose link commits to those keys.
//   Phone:  opens the link, checks the keys against the commitment, signs a QoreSeal recipient card with
//           its ML-DSA-87 and classical keys, and seals it to the laptop's throwaway key.
//   Laptop: opens the reply and checks the card against the keys the chain holds for that phone.
//   Both:   show four words derived from the whole exchange. The owner confirms they match, which
//           catches anyone who replaced the reply in between, our own server included.
import { generateSealKeys, seal, open, deriveSealKeys, signRecipientCard, verifyRecipientCard, envelopeToText, envelopeFromText, type RecipientCard, type SealKeyPair } from "@qorechain/qoreseal";
import { fetchMlkemPublicKey } from "@qorechain/qoreseal/network";
import { classicalKeyFromPrivate } from "@qorechain/qoresign";
import { evmToQor, fetchPqcStatus, pqcStatusPublicKey, type UnifiedAccount } from "@qorechain/sdk";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { Address } from "viem";
import { REST, CHAIN_ID } from "./config";

const PURPOSE = "bulkhead-pair-v1";
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

/** 16-byte commitment to the laptop's throwaway keys, carried in the QR. */
const commitOf = (kem: Uint8Array, x: Uint8Array) => hex(sha3_256(new Uint8Array([...kem, ...x]))).slice(0, 32);

/** Four words from the whole exchange: session, laptop keys, and the exact card the phone signed. */
export function wordsFor(sid: string, commit: string, card: RecipientCard): string[] {
  const h = sha3_256(enc.encode(`bulkhead-pair-words-v1|${sid}|${commit}|${JSON.stringify(card)}`));
  const out: string[] = [];
  for (let i = 0; i < 4; i++) out.push(wordlist[((h[i * 2] << 8) | h[i * 2 + 1]) % 2048]);
  return out;
}

async function j<T>(r: Response): Promise<T> {
  const x = await r.json().catch(() => null);
  if (!x) throw new Error("The pairing service isn't answering right now.");
  if (!r.ok || x.error) throw new Error(x.error ?? "Pairing was refused.");
  return x as T;
}

export interface LaptopSession { sid: string; commit: string; link: string; keys: SealKeyPair }

export async function startHandshake(origin = location.origin): Promise<LaptopSession> {
  const keys = generateSealKeys(), sid = crypto.randomUUID();
  await j(await fetch("/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sid, kem: b64(keys.mlkemPublicKey), x25519: b64(keys.x25519PublicKey) }) }));
  const commit = commitOf(keys.mlkemPublicKey, keys.x25519PublicKey);
  return { sid, commit, keys, link: `${origin}/#/phone?pair=${sid}.${commit}` };
}

export interface VerifiedPhone { phoneEvm: Address; phoneQor: string; words: string[] }

/** Laptop: waits for the reply, opens it and checks the card against the phone's keys on chain. */
export async function awaitPhone(s: LaptopSession, isCancelled: () => boolean): Promise<VerifiedPhone> {
  while (!isCancelled()) {
    const { envelope } = await j<{ envelope: string | null }>(await fetch(`/api/pair?sid=${s.sid}&reply=1`));
    if (envelope) {
      const body = JSON.parse(dec.decode(open({ chainId: CHAIN_ID, purpose: PURPOSE, envelope: envelopeFromText(envelope), keys: s.keys, aad: enc.encode(s.sid) }))) as { sid: string; phoneEvm: Address; card: RecipientCard };
      if (body.sid !== s.sid) throw new Error("The reply is for another session. Start again.");
      const phoneQor = evmToQor(body.phoneEvm);
      const pq = pqcStatusPublicKey(await fetchPqcStatus({ rest: REST, address: phoneQor }));
      if (!pq) throw new Error("That phone has no post-quantum key on chain yet. Finish setup on the phone first.");
      const kem = await fetchMlkemPublicKey({ rest: REST, address: phoneQor });
      try { verifyRecipientCard({ card: body.card, chainId: CHAIN_ID, address: phoneQor, pqPublicKey: pq, mlkemPublicKey: kem }); }
      catch { throw new Error("The phone's card doesn't match its keys on chain. Don't pair it."); }
      return { phoneEvm: body.phoneEvm, phoneQor, words: wordsFor(s.sid, s.commit, body.card) };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Pairing was cancelled.");
}

/** Phone: answers a pairing link. Returns the words to show. */
export async function answerHandshake(pairParam: string, phone: UnifiedAccount, mnemonic: string): Promise<string[]> {
  const [sid, commit] = pairParam.split(".");
  if (!sid || !/^[0-9a-f]{32}$/.test(commit ?? "")) throw new Error("This pairing link is incomplete. Scan the code again.");
  const k = await j<{ kem: string; x25519: string }>(await fetch(`/api/pair?sid=${sid}`));
  const kem = unb64(k.kem), x = unb64(k.x25519);
  if (commitOf(kem, x) !== commit) throw new Error("The laptop's keys don't match the code you scanned. Don't continue.");
  const seals = deriveSealKeys({ mnemonic, index: 0 });
  const ck = classicalKeyFromPrivate(Uint8Array.from((phone.privateKey.replace(/^0x/, "").match(/../g) ?? []).map((h) => parseInt(h, 16))), "eth_secp256k1");
  const card = signRecipientCard({ chainId: CHAIN_ID, address: phone.cosmos, keys: seals, classicalKey: ck, pqKey: { secretKey: phone.pqc.secretKey } });
  const envelope = envelopeToText(seal({ chainId: CHAIN_ID, purpose: PURPOSE, recipients: [{ mlkemPublicKey: kem, x25519PublicKey: x }], plaintext: enc.encode(JSON.stringify({ sid, phoneEvm: phone.evm, card })), aad: enc.encode(sid) }));
  await j(await fetch(`/api/pair?sid=${sid}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ envelope }) }));
  return wordsFor(sid, commit, card);
}
