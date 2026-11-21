// Which account the screens show: the user's own once setup has paired one, the demo account until then.
import type { Address } from "viem";
import { pairing } from "./device";
import { DEPLOYMENT } from "./config";

export function myAccount(): { address: Address; isDemo: boolean } {
  const p = pairing();
  return p ? { address: p.account, isDemo: false } : { address: DEPLOYMENT.demoAccount as Address, isDemo: true };
}
