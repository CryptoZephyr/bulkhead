// Funding from QoreX on the native lane: assets arrive in the account without any EVM window
// (measured). QoreX can't sign EVM transactions yet, so it's used only to fund.
//   QOR:  MsgSend to the account's qor1 address.
//   fUSD: MsgConvertCoin turns the user's fUSD bank coins into the account's ERC-20 balance (measured, round 21).
import { getQorexNative, hasCapability } from "@qorechain/qorex-types";
import { evmToQor } from "@qorechain/sdk";
import type { Address } from "viem";
import { CHAIN_ID, TOKENS } from "./config";

// Minimal protobuf writer for the two messages (no extra dependency).
const varint = (n: number) => { const o: number[] = []; while (n > 127) { o.push((n & 127) | 128); n >>>= 7; } o.push(n); return o; };
const str = (field: number, s: string) => { const b = [...new TextEncoder().encode(s)]; return [(field << 3) | 2, ...varint(b.length), ...b]; };
const sub = (field: number, bytes: number[]) => [(field << 3) | 2, ...varint(bytes.length), ...bytes];
const coin = (denom: string, amount: string) => [...str(1, denom), ...str(2, amount)];

export function isQorexAvailable() {
  const q = getQorexNative();
  return !!q && hasCapability(q, "signAndBroadcast");
}

export async function fundFromQorex(account: Address, asset: "QOR" | "fUSD", baseUnits: bigint, step: (l: string, p: number) => void): Promise<string> {
  const q = getQorexNative();
  if (!q || !hasCapability(q, "signAndBroadcast")) throw new Error("QoreX isn't installed in this browser. Install it, then try again.");
  step("Connecting to QoreX", 0.15);
  await q.enable(CHAIN_ID);
  const from = (await q.getKey(CHAIN_ID)).bech32Address;
  const value = asset === "QOR"
    ? [...str(1, from), ...str(2, evmToQor(account)), ...sub(3, coin("uqor", (baseUnits / 1_000_000_000_000n).toString()))]
    : [...sub(1, coin(`erc20:${TOKENS.fUSD.address}`, baseUnits.toString())), ...str(2, account), ...str(3, from)];
  const typeUrl = asset === "QOR" ? "/cosmos.bank.v1beta1.MsgSend" : "/cosmos.evm.erc20.v1.MsgConvertCoin";
  step("Confirm in QoreX", 0.4);
  // MsgConvertCoin runs the token's EVM code and needs about 420,000 gas (measured); QoreX defaults to 400,000.
  const r = await q.signAndBroadcast({ chainId: CHAIN_ID, messages: [{ typeUrl, value: Uint8Array.from(value) }], gasLimit: asset === "fUSD" ? 700_000 : 200_000 });
  if (r.code !== 0) throw new Error(`QoreX sent it, but the chain refused it (code ${r.code}).`);
  if (r.shield === "downgraded") throw new Error("QoreX reports this transaction went out without its post-quantum signature. Check QoreX before funding again.");
  step("Funds on the way", 1);
  return r.txHash;
}
