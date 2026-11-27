// Replay guard for laptop-signed changes (/api/pilot, /api/bills). The EIP-191 message carries its
// time and has a 5-minute window, but no nonce: without this, the same signed body could be sent
// again inside that window. Each signature is claimed once, for longer than the window.
import { keccak256, type Hex } from "viem";

export const REPLAYED = "This change was already used. Try again.";
export const SIGNATURE_TTL_S = 600;

/** True the first time this signature is seen, false after. */
export async function firstUse(signature: Hex, once: (k: string, ttlSeconds: number) => Promise<boolean>): Promise<boolean> {
  return once(`bh:used:${keccak256(signature)}`, SIGNATURE_TTL_S);
}
