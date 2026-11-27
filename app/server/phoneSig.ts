// Checks a phone (Safety key, ML-DSA-87) signature against the account's on-chain key, using
// QoreChain's precompiles the same way contracts/contracts/lib/QorePrecompiles.sol does.
// Fails closed: an inactive precompile (empty answer), an unregistered or unproven key, or any
// error means "not signed". The chain reads are injectable so tests run without a network.
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex } from "viem";
import accountAbi from "../src/chain/abi/BulkheadAccount.json" with { type: "json" };
import { pilotScheduleDigest, pilotReopenDigest, refuseDigest, type PilotSettingsJson } from "../src/chain/pilotSchedule.js";

export const PQC_VERIFY = "0x0000000000000000000000000000000000000a01" as const;
export const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000a02" as const;

export const keyStatusAbi = [{ type: "function", name: "pqcKeyStatus", stateMutability: "view", inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "registered", type: "bool" }, { name: "algorithmId", type: "uint8" }, { name: "pubkey", type: "bytes" }, { name: "proven", type: "bool" }] }] as const;
export const verifyAbi = [{ type: "function", name: "pqcVerify", stateMutability: "view",
  inputs: [{ name: "pubkey", type: "bytes" }, { name: "sig", type: "bytes" }, { name: "message", type: "bytes" }], outputs: [{ name: "ok", type: "bool" }] }] as const;

/** The two chain reads phoneSig needs. */
export interface PqcChain {
  /** eth_call: the raw answer data (or undefined). */
  call(to: Address, data: Hex): Promise<Hex | undefined>;
  /** The account's Safety (phone) address. */
  safetyOf(account: Address): Promise<Address>;
}

/** The testnet, through relayer.ts's public client. Imported lazily so tests never load it. */
export const liveChain: PqcChain = {
  async call(to, data) { const { pub } = await import("./relayer.js"); return (await pub.call({ to, data })).data; },
  async safetyOf(account) { const { pub } = await import("./relayer.js"); return (await pub.readContract({ address: account, abi: accountAbi, functionName: "safety" })) as Address; },
};

/** The proven ML-DSA key of an address, or null. Throws if the precompile is inactive. */
export async function provenKeyOf(addr: Address, chain: PqcChain = liveChain): Promise<Hex | null> {
  const data = await chain.call(PQC_KEY_STATUS, encodeFunctionData({ abi: keyStatusAbi, functionName: "pqcKeyStatus", args: [addr] }));
  if (!data || data === "0x") throw new Error("The key status precompile is inactive.");
  const [registered, , pubkey, proven] = decodeFunctionResult({ abi: keyStatusAbi, functionName: "pqcKeyStatus", data });
  return registered && proven && pubkey.length > 2 ? pubkey : null;
}

/** pqcVerify(pubkey, sig, message). Throws if the precompile is inactive. */
export async function pqcVerifyOnChain(pubkey: Hex, sig: Hex, message: Hex, chain: PqcChain = liveChain): Promise<boolean> {
  const data = await chain.call(PQC_VERIFY, encodeFunctionData({ abi: verifyAbi, functionName: "pqcVerify", args: [pubkey, sig, message] }));
  if (!data || data.length !== 66) throw new Error("The signature precompile is inactive.");
  return decodeFunctionResult({ abi: verifyAbi, functionName: "pqcVerify", data }) === true;
}

/** Whether the account's phone signed this schedule. Any failure is false. */
export async function phoneSignedSchedule(account: Address, s: PilotSettingsJson, nonce: bigint, deadline: bigint, phoneSig: Hex, chain: PqcChain = liveChain): Promise<boolean> {
  try { return await phoneSigned(account, pilotScheduleDigest(account, s, nonce, deadline), phoneSig, chain); } catch { return false; }
}

/** Whether the account's phone signed the reopening of the wall closed by the trip at `trippedAt` (ms). Any failure is false. */
export async function phoneSignedReopen(account: Address, trippedAt: number, nonce: bigint, deadline: bigint, phoneSig: Hex, chain: PqcChain = liveChain): Promise<boolean> {
  try { return await phoneSigned(account, pilotReopenDigest(account, trippedAt, nonce, deadline), phoneSig, chain); } catch { return false; }
}

/** Whether the account's phone refused the queued request `requestId`. Any failure is false. */
export async function phoneSignedRefuse(account: Address, requestId: string, nonce: bigint, deadline: bigint, phoneSig: Hex, chain: PqcChain = liveChain): Promise<boolean> {
  try { return await phoneSigned(account, refuseDigest(account, requestId, nonce, deadline), phoneSig, chain); } catch { return false; }
}

/** Whether the account's phone (its on-chain Safety key) signed this 32-byte digest. Any failure is false. */
export async function phoneSigned(account: Address, digest: Hex, phoneSig: Hex, chain: PqcChain = liveChain): Promise<boolean> {
  try {
    if (!/^0x([0-9a-fA-F]{2})+$/.test(phoneSig) || !/^0x[0-9a-fA-F]{64}$/.test(digest)) return false;
    const safety = await chain.safetyOf(account);
    if (!/^0x[0-9a-fA-F]{40}$/.test(safety) || /^0x0{40}$/i.test(safety)) return false;
    const key = await provenKeyOf(safety, chain);
    if (!key) return false;
    return await pqcVerifyOnChain(key, phoneSig, digest, chain);
  } catch {
    return false;
  }
}
