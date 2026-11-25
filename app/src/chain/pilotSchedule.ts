// The exact bytes the phone signs to approve a looser pilot schedule. Shared by the phone and the
// server (functions/pilot.ts via server/phoneSig.ts), so both build the same digest. Pure: viem only.
import { encodeAbiParameters, hexToBytes, keccak256, stringToHex, type Address, type Hex } from "viem";

export interface PilotSettingsJson { tzOffsetMin: number; quietStart: string; quietEnd: string; restPerTx: string; restPeriod: string; dayPerTx: string; dayPeriod: string }

export const PILOT_SCHEDULE_DOMAIN = "bulkhead-pilot-schedule-v1";
export const PILOT_SCHEDULE_CHAIN_ID = 9800n;
/** The server refuses an approval whose deadline is further ahead than this. */
export const PILOT_SCHEDULE_MAX_AHEAD_MS = 15 * 60_000;

/** Canonical JSON: fixed key order, the four amounts as decimal strings. */
export function canonicalSettings(s: PilotSettingsJson): string {
  return JSON.stringify({
    tzOffsetMin: Number(s.tzOffsetMin), quietStart: String(s.quietStart), quietEnd: String(s.quietEnd),
    restPerTx: BigInt(s.restPerTx).toString(), restPeriod: BigInt(s.restPeriod).toString(),
    dayPerTx: BigInt(s.dayPerTx).toString(), dayPeriod: BigInt(s.dayPeriod).toString(),
  });
}

export const settingsHash = (s: PilotSettingsJson): Hex => keccak256(stringToHex(canonicalSettings(s)));

/** keccak256(abi.encode("bulkhead-pilot-schedule-v1", 9800, account, settingsHash, nonce, deadline)). Deadline is unix seconds. */
export function pilotScheduleDigest(account: Address, s: PilotSettingsJson, nonce: bigint, deadline: bigint): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }],
    [PILOT_SCHEDULE_DOMAIN, PILOT_SCHEDULE_CHAIN_ID, account, settingsHash(s), nonce, deadline],
  ));
}

/** The 32 digest bytes, which are what the ML-DSA-87 key signs. */
export const pilotScheduleDigestBytes = (account: Address, s: PilotSettingsJson, nonce: bigint, deadline: bigint): Uint8Array =>
  hexToBytes(pilotScheduleDigest(account, s, nonce, deadline));
