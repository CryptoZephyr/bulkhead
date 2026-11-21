// Network and deployment record. Addresses come from docs/DEPLOYMENTS.md, never from screenshots.
import { defineChain } from "viem";

export const CHAIN_ID = "qorechain-diana";
export const EVM_RPC = "https://evm-testnet.qore.host";
// The public REST API sends no CORS headers (measured), so browsers go through our gateway.
export const REST = (import.meta.env.VITE_GATEWAY as string | undefined) ?? "/api/rest";
export const EXPLORER_TX = "https://explore.qore.network/tx/";

export const qorechainTestnet = defineChain({
  id: 9800,
  name: "QoreChain testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [EVM_RPC] } },
});

export const DEPLOYMENT = {
  factory: "0x3df113cf4a7ddb5d22eed33f8de430d531026355",
  demoAccount: "0x1c548456DE8683d816409eceBd19D3C4BAD75a5E",
} as const;

export const NATIVE = "0x0000000000000000000000000000000000000000" as const;

export const TOKENS = {
  fUSD: { address: "0x97143B771D34ddb9130b807b135Ae675A5a963CA", decimals: 6, symbol: "fUSD", places: 2 },
  QOR: { address: NATIVE, decimals: 18, symbol: "QOR", places: 4 },
} as const;
