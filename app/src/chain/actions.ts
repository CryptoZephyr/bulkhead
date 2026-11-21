// The only way screens change anything on chain. The lead implements these with the SDK
// (everyday key in the browser, scoped windows, the relayer for Safety-key actions).
// Screens call them and show the real steps through the `step` callback. Until wired,
// each one throws NOT_WIRED so a screen shows a clear failure state instead of faking success.
import type { Address } from "viem";
import type { Step } from "../ui/Button";

export const NOT_WIRED = "This action is not connected to the chain yet.";

export interface PolicyInput { perTxCap: bigint; periodCap: bigint; floor: bigint }

/** A check that runs before sending, so the app never trips a wall by accident (section 16.4). */
export type PayCheck =
  | { ok: true }
  | { ok: false; reason: "over-per-payment" | "over-period" | "below-floor" | "unknown-payee" | "sealed" | "paused"; limit?: bigint };

export interface Actions {
  checkPayment(account: Address, asset: Address, to: Address, amount: bigint): Promise<PayCheck>;
  pay(account: Address, asset: Address, to: Address, amount: bigint, step: Step): Promise<{ txHash: string }>;
  tighten(account: Address, asset: Address, policy: PolicyInput, step: Step): Promise<{ txHash: string }>;
  seal(account: Address, step: Step): Promise<{ txHash: string }>;
  /** Sends a widening request to the paired phone. Returns a request id the phone view looks up. */
  requestWiden(account: Address, kind: "SetPolicy" | "AddPayee" | "Unseal" | "SetRecovery", data: unknown, step: Step): Promise<{ requestId: string }>;
  breakGlass(account: Address, assets: Address[], step: Step): Promise<{ txHash: string }>;
}

const notWired = async () => { throw new Error(NOT_WIRED); };

export const actions: Actions = {
  checkPayment: notWired,
  pay: notWired,
  tighten: notWired,
  seal: notWired,
  requestWiden: notWired,
  breakGlass: notWired,
};
