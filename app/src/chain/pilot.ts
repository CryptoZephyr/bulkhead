// Client for /api/pilot. Changes are signed by the laptop key; the server checks it is this account's.
import { privateKeyToAccount } from "viem/accounts";
import { current } from "./wallet";

import type { PilotSettingsJson } from "./pilotSchedule";
export type { PilotSettingsJson };
export interface PilotLog { at: number; kind: "schedule" | "request" | "refused" | "settings" | "tripwire" | "reopen"; reason: string; txHash?: string; blastRadius?: string }
export interface PilotView {
  account: string; pilotAddress: string | null; added: boolean; saved: boolean; quietNow: boolean; settings: PilotSettingsJson;
  chain: { block: string; ceiling: { perTx: string; period: string }; effective: { perTx: string; period: string }; blastRadius: string; sealed: boolean; live: { until: string } };
  log: PilotLog[];
  /** A looser schedule waiting for the phone. */
  pendingSettings: { settings: PilotSettingsJson; at: number } | null;
  /** Set when the tripwire closed the wall. Only the phone reopens it. */
  tripped: { at: number; reason: string } | null;
}

const msg = (account: string, change: object, at: number) => `Bulkhead pilot change\naccount: ${account.toLowerCase()}\nat: ${at}\n${JSON.stringify(change)}`;

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== "object") throw new Error("The pilot service isn't answering right now.");
  if (!r.ok || j.error) throw new Error(j.error ?? "The request was refused.");
  return j as T;
}

export const getPilot = (account: string) => fetch(`/api/pilot?account=${account}`).then((r) => json<PilotView>(r));
export const tickPilot = (account: string) => fetch("/api/pilot?tick=1", { method: "POST", body: JSON.stringify({ account }) }).then((r) => json<{ changed: boolean; reason: string }>(r));

export async function changePilot(account: string, change: object): Promise<{ ok: boolean; reason: string; changed?: boolean; needsPhone?: boolean; read?: { amount: string; untilLocal: string } }> {
  const at = Date.now();
  const signature = await privateKeyToAccount(current().privateKey as `0x${string}`).signMessage({ message: msg(account, change, at) });
  return json(await fetch("/api/pilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account, at, change, signature }) }));
}

const HM = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
/** Whether a local minute of the day falls in quiet hours (same rule as the server). */
export function quietAt(s: PilotSettingsJson, minute: number) {
  const a = HM(s.quietStart), b = HM(s.quietEnd);
  return a < b ? minute >= a && minute < b : minute >= a || minute < b;
}
