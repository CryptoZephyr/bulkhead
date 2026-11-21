// Requests from the laptop (or the bill agent) to the phone, and how the phone turns them into a signed call.
// The phone never trusts the laptop's words: it rebuilds the exact call from the structured intent,
// reads the current values from the chain itself, and shows only what it computed.
import { encodeAbiParameters, encodeFunctionData, toHex, type Address, type Hex } from "viem";
import { pqcSign, type UnifiedAccount } from "@qorechain/sdk";
import { sealToAddresses } from "@qorechain/qoreseal/network";
import { open, envelopeFromText, envelopeToText, deriveSealKeys } from "@qorechain/qoreseal";
import accountAbi from "./abi/BulkheadAccount.json";
import { pub, readAccount, fmt } from "./account";
import { CHAIN_ID, NATIVE, TOKENS } from "./config";

export const PURPOSE = "bulkhead-request-v1";

export type Intent =
  | { kind: "SetPolicy"; asset: Address; perTxCap: string; periodCap: string; floor: string }
  | { kind: "AddPayee"; payee: Address }
  | { kind: "Unseal" }
  | { kind: "SetRecovery"; recovery: Address }
  | { kind: "Spend"; asset: Address; to: Address; amount: string }   // over the walls, immediate
  | { kind: "BreakGlass"; assets: Address[] };                        // immediate

export interface RequestBody { v: 1; account: Address; from: "laptop" | "agent"; intent: Intent; createdAt: number }

const LOOSEN = { SetPolicy: 0, AddPayee: 1, DisablePayeeList: 2, Unseal: 3, AddSentinel: 4, SetRecovery: 5 } as const;
const policyTuple = [{ type: "address" }, { type: "tuple", components: [{ name: "perTxCap", type: "uint256" }, { name: "periodCap", type: "uint256" }, { name: "floor", type: "uint256" }] }] as const;

/** The digest kind and data bytes the account checks the signature against. Mirrors BulkheadAccount. */
export function encodeIntent(i: Intent): { kindId: number; data: Hex } {
  switch (i.kind) {
    case "SetPolicy": return { kindId: 16 + LOOSEN.SetPolicy, data: encodeAbiParameters(policyTuple, [i.asset, { perTxCap: BigInt(i.perTxCap), periodCap: BigInt(i.periodCap), floor: BigInt(i.floor) }]) };
    case "AddPayee": return { kindId: 16 + LOOSEN.AddPayee, data: encodeAbiParameters([{ type: "address" }], [i.payee]) };
    case "Unseal": return { kindId: 16 + LOOSEN.Unseal, data: "0x" };
    case "SetRecovery": return { kindId: 16 + LOOSEN.SetRecovery, data: encodeAbiParameters([{ type: "address" }], [i.recovery]) };
    case "Spend": return { kindId: 0, data: encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [i.asset, i.to, BigInt(i.amount)]) };
    case "BreakGlass": return { kindId: 1, data: encodeAbiParameters([{ type: "address[]" }], [i.assets]) };
  }
}

function tokenOf(asset: Address) {
  return asset.toLowerCase() === NATIVE ? TOKENS.QOR : TOKENS.fUSD;
}

/** What the phone shows: computed from the intent and the chain, never from laptop text. */
export async function describe(account: Address, i: Intent): Promise<{ title: string; now?: string; after?: string; delayed: boolean; check: string }> {
  const short = `${account.slice(0, 6)}…${account.slice(-4)}`;
  switch (i.kind) {
    case "SetPolicy": {
      const t = tokenOf(i.asset), a = await readAccount(account, i.asset);
      const f = (n: bigint) => fmt(n, t.decimals, t.places);
      return { title: "Change Everyday's walls", now: `${f(a.asset.perTxCap)} per payment, ${f(a.asset.periodCap)} a day, ${f(a.asset.floor)} floor`,
        after: `${f(BigInt(i.perTxCap))} per payment, ${f(BigInt(i.periodCap))} a day, ${f(BigInt(i.floor))} floor`, delayed: true,
        check: `The call sets the ${t.symbol} policy on ${short}. Nothing else.` };
    }
    case "AddPayee": return { title: "Add an approved payee", after: i.payee, delayed: true, check: `The call adds ${i.payee} as a payee on ${short}. Nothing else.` };
    case "Unseal": return { title: "Unseal the account", now: "Sealed", after: "Open", delayed: true, check: `The call unseals ${short}. Nothing else.` };
    case "SetRecovery": return { title: "Change the recovery account", after: i.recovery, delayed: true, check: `The call sets the recovery account of ${short}. Nothing else.` };
    case "Spend": { const t = tokenOf(i.asset); return { title: `Send ${fmt(BigInt(i.amount), t.decimals, t.places)} ${t.symbol}`, after: `to ${i.to}`, delayed: false, check: `The call moves ${fmt(BigInt(i.amount), t.decimals, t.places)} ${t.symbol} from ${short} to ${i.to}. Nothing else.` }; }
    case "BreakGlass": return { title: "Send everything to the recovery account", delayed: false, check: `The call moves every listed asset from ${short} to its pinned recovery account. Nothing else.` };
  }
}

/** Laptop or agent: seal the request to the phone's on-chain ML-KEM key and queue it. Returns the request id. */
export async function sendToPhone(rest: string, phoneQor: string, body: RequestBody): Promise<string> {
  const env = await sealToAddresses({ rest, chainId: CHAIN_ID, purpose: PURPOSE, mode: "mlkem", recipients: [{ address: phoneQor }], plaintext: new TextEncoder().encode(JSON.stringify(body)) });
  const r = await fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: body.account, phone: phoneQor, envelope: envelopeToText(env) }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "The request could not be queued.");
  return j.id;
}

/** Phone: open a queued envelope with its own keys. Throws if it was not sealed to this phone or was altered. */
export function openRequest(envelopeText: string, mnemonic: string, index = 0): RequestBody {
  const plain = open({ chainId: CHAIN_ID, purpose: PURPOSE, envelope: envelopeFromText(envelopeText), keys: deriveSealKeys({ mnemonic, index }) });
  const body = JSON.parse(new TextDecoder().decode(plain)) as RequestBody;
  if (body.v !== 1) throw new Error("Unknown request version.");
  return body;
}

/** Phone: sign with the Safety key (ML-DSA-87) and build the exact calldata the relayer will send. */
export async function signIntent(phone: UnifiedAccount, account: Address, i: Intent): Promise<Hex> {
  const { kindId, data } = encodeIntent(i);
  const nonce = BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const digest = (await pub.readContract({ address: account, abi: accountAbi, functionName: "digest", args: [kindId, data, nonce, deadline] })) as Hex;
  const sig = toHex(pqcSign(phone.pqc.secretKey, Uint8Array.from(digest.slice(2).match(/../g)!.map((h) => parseInt(h, 16)))));
  if (i.kind === "Spend") return encodeFunctionData({ abi: accountAbi, functionName: "spendWithApproval", args: [i.asset, i.to, BigInt(i.amount), nonce, deadline, sig] });
  if (i.kind === "BreakGlass") return encodeFunctionData({ abi: accountAbi, functionName: "breakGlassWithApproval", args: [i.assets, nonce, deadline, sig] });
  return encodeFunctionData({ abi: accountAbi, functionName: "queueLoosen", args: [kindId - 16, data, nonce, deadline, sig] });
}
