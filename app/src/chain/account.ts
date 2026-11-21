// Reads a Bulkhead account straight from the EVM RPC (it allows browsers). Numbers only from chain state.
import { createPublicClient, http, formatUnits, parseAbi, type Address } from "viem";
import accountAbi from "./abi/BulkheadAccount.json";
import { qorechainTestnet } from "./config";

export const pub = createPublicClient({ chain: qorechainTestnet, transport: http() });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export type Trip = "None" | "OverTxCap" | "OverPeriodCap" | "BelowFloor" | "UnknownPayee";
const TRIPS: Trip[] = ["None", "OverTxCap", "OverPeriodCap", "BelowFloor", "UnknownPayee"];

export interface AssetView {
  balance: bigint;
  perTxCap: bigint;
  periodCap: bigint;
  floor: bigint;
  blastRadius: bigint;
}

export interface AccountView {
  address: Address;
  sealed: boolean;
  throttledUntil: bigint;
  lastTrip: Trip;
  block: bigint;
  asset: AssetView;
}

export async function readAccount(address: Address, asset: Address): Promise<AccountView> {
  const c = { address, abi: accountAbi } as const;
  const [sealed, throttledUntil, lastTrip, policy, blastRadius, block, balance] = await Promise.all([
    pub.readContract({ ...c, functionName: "sealed_" }) as Promise<boolean>,
    pub.readContract({ ...c, functionName: "throttledUntil" }) as Promise<bigint>,
    pub.readContract({ ...c, functionName: "lastTrip" }) as Promise<number>,
    pub.readContract({ ...c, functionName: "policy", args: [asset] }) as Promise<[bigint, bigint, bigint]>,
    pub.readContract({ ...c, functionName: "blastRadius", args: [asset] }) as Promise<bigint>,
    pub.getBlockNumber(),
    asset === "0x0000000000000000000000000000000000000000"
      ? pub.getBalance({ address })
      : (pub.readContract({ address: asset, abi: erc20, functionName: "balanceOf", args: [address] }) as Promise<bigint>),
  ]);
  return {
    address, sealed, throttledUntil, lastTrip: TRIPS[lastTrip] ?? "None", block,
    asset: { balance, perTxCap: policy[0], periodCap: policy[1], floor: policy[2], blastRadius },
  };
}

export async function readTokenBalance(token: Address, holder: Address): Promise<bigint> {
  return pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [holder] }) as Promise<bigint>;
}

/** Real units only: fUSD to 2 places, QOR to 4. */
export function fmt(amount: bigint, decimals: number, places: number): string {
  const n = Number(formatUnits(amount, decimals));
  return n.toLocaleString("en-GB", { minimumFractionDigits: places, maximumFractionDigits: places });
}
