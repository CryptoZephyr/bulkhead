// Checks a phone (Safety key, ML-DSA-87) signature against the account's on-chain key, using
// QoreChain's precompiles the same way contracts/contracts/lib/QorePrecompiles.sol does.
// Fails closed: an inactive precompile (empty answer), an unregistered or unproven key, or any
// error means "not signed".
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from "viem";
import accountAbi from "../src/chain/abi/BulkheadAccount.json" with { type: "json" };
import { pub } from "./relayer.js";
import { pilotScheduleDigest, pilotReopenDigest, type PilotSettingsJson } from "../src/chain/pilotSchedule.js";

export const PQC_VERIFY = "0x0000000000000000000000000000000000000a01" as const;
export const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000a02" as const;

const keyStatusAbi = [{ type: "function", name: "pqcKeyStatus", stateMutability: "view", inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "registered", type: "bool" }, { name: "algorithmId", type: "uint8" }, { name: "pubkey", type: "bytes" }, { name: "proven", type: "bool" }] }] as const;
const verifyAbi = [{ type: "function", name: "pqcVerify", stateMutability: "view",
  inputs: [{ name: "pubkey", type: "bytes" }, { name: "sig", type: "bytes" }, { name: "message", type: "bytes" }], outputs: [{ name: "ok", type: "bool" }] }] as const;

/** The proven ML-DSA key of an address, or null. Throws if the precompile is inactive. */
export async function provenKeyOf(addr: Address): Promise<Hex | null> {
  const r = await pub.call({ to: PQC_KEY_STATUS, data: encodeFunctionData({ abi: keyStatusAbi, functionName: "pqcKeyStatus", args: [addr] }) });
  if (!r.data || r.data === "0x") throw new Error("The key status precompile is inactive.");
  const [registered, , pubkey, proven] = decodeFunctionResult({ abi: keyStatusAbi, functionName: "pqcKeyStatus", data: r.data });
  return registered && proven && pubkey.length > 2 ? pubkey : null;
}

/** pqcVerify(pubkey, sig, message). Throws if the precompile is inactive. */
export async function pqcVerifyOnChain(pubkey: Hex, sig: Hex, message: Hex): Promise<boolean> {
  const r = await pub.call({ to: PQC_VERIFY, data: encodeFunctionData({ abi: verifyAbi, functionName: "pqcVerify", args: [pubkey, sig, message] }) });
  if (!r.data || r.data.length !== 66) throw new Error("The signature precompile is inactive.");
  return decodeFunctionResult({ abi: verifyAbi, functionName: "pqcVerify", data: r.data }) === true;
}

/** Whether the account's phone signed this schedule. Any failure is false. */
export async function phoneSignedSchedule(account: Address, s: PilotSettingsJson, nonce: bigint, deadline: bigint, phoneSig: Hex): Promise<boolean> {
  try { return await phoneSigned(account, pilotScheduleDigest(account, s, nonce, deadline), phoneSig); } catch { return false; }
}

/** Whether the account's phone signed the reopening of the wall closed by the trip at `trippedAt` (ms). Any failure is false. */
export async function phoneSignedReopen(account: Address, trippedAt: number, nonce: bigint, deadline: bigint, phoneSig: Hex): Promise<boolean> {
  try { return await phoneSigned(account, pilotReopenDigest(account, trippedAt, nonce, deadline), phoneSig); } catch { return false; }
}

/** Whether the account's phone (its on-chain Safety key) signed this 32-byte digest. Any failure is false. */
export async function phoneSigned(account: Address, digest: Hex, phoneSig: Hex): Promise<boolean> {
  try {
    if (!/^0x[0-9a-fA-F]+$/.test(phoneSig) || !/^0x[0-9a-fA-F]{64}$/.test(digest)) return false;
    const safety = (await pub.readContract({ address: account, abi: accountAbi, functionName: "safety" })) as Address;
    if (/^0x0{40}$/i.test(safety)) return false;
    const key = await provenKeyOf(safety);
    if (!key) return false;
    return await pqcVerifyOnChain(key, phoneSig, digest);
  } catch {
    return false;
  }
}
